import { resolveLiveRuntime, type LiveRuntimeResolution } from "@/lib/live-runtime-state";
import { formatZonedDateTimeLocal, parseZonedDateTimeLocal } from "@/lib/zoned-date-time";

/**
 * 指定場次 (fixed sessions): one Live with several explicit starts, for example
 * 2026/10/30 14:00 and 19:00. A registrant picks one session; from then on
 * every timing for that registrant (confirmation text, before/during-live
 * reminders, the viewer page, admission, replay window) follows that
 * session's startAt instead of the Live's shared scheduledAt.
 *
 * Pure: no database, crypto or environment access. The database side lives
 * in live-fixed-sessions-store.ts.
 *
 * Rules every caller relies on:
 * - Only a recorded (VOD) Live that is not evergreen can use fixed sessions;
 *   each session replays the same video at its own start.
 * - Live.scheduledAt of a fixed-session Live is the latest non-cancelled
 *   session start, so shared listings, hide-expired and replay-deadline
 *   validation keep treating the Live as open until its last session.
 * - A session that has registrations is never deleted: removing it in the
 *   studio cancels it (no playback, no reminders) and keeps the registrations.
 */

export const LIVE_SESSION_MODES = ["single", "fixed_sessions"] as const;
export type LiveSessionMode = (typeof LIVE_SESSION_MODES)[number];

export const LIVE_SESSION_STATUSES = ["open", "closed", "cancelled"] as const;
export type LiveSessionStatus = (typeof LIVE_SESSION_STATUSES)[number];

/** Upper bound per Live; also enforced by the draft schema. */
export const MAX_FIXED_SESSIONS = 50;
export const MAX_FIXED_SESSION_CAPACITY = 100_000;
export const MAX_SESSION_REGISTRATION_CUTOFF_MINUTES = 1_440;
export const MAX_SESSION_REPLAY_WINDOW_HOURS = 8_760;
export const DEFAULT_SESSION_TIMEZONE = "Asia/Taipei";
/** Script-readable cookie with the session the server confirmed for the last registration. */
export const LIVE_SESSION_RESULT_COOKIE = "celebratedeal_live_session_result";

export type FixedSessionDraftRow = {
  startAt: string;
  capacity: string;
  status: "open" | "closed";
};

export type ParsedFixedSession = {
  startAt: Date;
  capacity: number | null;
  status: "open" | "closed";
};

export type FixedSessionValidationCode =
  | "fixed_sessions_required"
  | "fixed_sessions_too_many"
  | "fixed_session_invalid_time"
  | "fixed_session_duplicate"
  | "fixed_session_in_past"
  | "fixed_session_invalid_capacity";

export class FixedSessionValidationError extends Error {
  constructor(public readonly code: FixedSessionValidationCode, public readonly index: number | null = null) {
    super(code);
    this.name = "FixedSessionValidationError";
  }
}

export function isLiveSessionMode(value: unknown): value is LiveSessionMode {
  return typeof value === "string" && (LIVE_SESSION_MODES as readonly string[]).includes(value);
}

export function isFixedSessionLive(live: { sessionMode?: string | null } | null | undefined) {
  return live?.sessionMode === "fixed_sessions";
}

function parseCapacity(value: string, index: number) {
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (!/^\d{1,6}$/u.test(trimmed)) throw new FixedSessionValidationError("fixed_session_invalid_capacity", index);
  const capacity = Number(trimmed);
  if (capacity < 1 || capacity > MAX_FIXED_SESSION_CAPACITY) {
    throw new FixedSessionValidationError("fixed_session_invalid_capacity", index);
  }
  return capacity;
}

/**
 * Validates the studio rows and returns them sorted by start. Times are
 * wall-clock `YYYY-MM-DDTHH:mm` in `timeZone` (Asia/Taipei by default).
 *
 * `existingStartTimes` are sessions already stored for this Live: they may be
 * in the past (they already happened), every other row must start after
 * `now` when the Live is being published.
 */
export function parseFixedSessionRows(
  rows: readonly FixedSessionDraftRow[],
  input: {
    timeZone: string;
    now: Date;
    requireFuture: boolean;
    existingStartTimes?: ReadonlySet<number>;
  },
): ParsedFixedSession[] {
  if (rows.length === 0) throw new FixedSessionValidationError("fixed_sessions_required");
  if (rows.length > MAX_FIXED_SESSIONS) throw new FixedSessionValidationError("fixed_sessions_too_many");
  const seen = new Set<number>();
  const parsed = rows.map((row, index) => {
    let startAt: Date;
    try {
      startAt = parseZonedDateTimeLocal(row.startAt.trim(), input.timeZone);
    } catch {
      throw new FixedSessionValidationError("fixed_session_invalid_time", index);
    }
    const key = startAt.getTime();
    if (seen.has(key)) throw new FixedSessionValidationError("fixed_session_duplicate", index);
    seen.add(key);
    if (input.requireFuture && key <= input.now.getTime() && !input.existingStartTimes?.has(key)) {
      throw new FixedSessionValidationError("fixed_session_in_past", index);
    }
    return { startAt, capacity: parseCapacity(row.capacity, index), status: row.status === "closed" ? "closed" as const : "open" as const };
  });
  return parsed.sort((left, right) => left.startAt.getTime() - right.startAt.getTime());
}

/** The Live.scheduledAt of a fixed-session Live: its latest non-cancelled start. */
export function fixedSessionScheduledAt(sessions: readonly { startAt: Date; status?: string }[]) {
  const starts = sessions
    .filter((session) => session.status !== "cancelled")
    .map((session) => session.startAt.getTime());
  return starts.length > 0 ? new Date(Math.max(...starts)) : null;
}

/** Studio rows for stored sessions (cancelled ones are not editable rows). */
export function fixedSessionDraftRows(
  sessions: readonly { startAt: Date; capacity: number | null; status: string }[],
  timeZone: string,
): FixedSessionDraftRow[] {
  return [...sessions]
    .filter((session) => session.status !== "cancelled")
    .sort((left, right) => left.startAt.getTime() - right.startAt.getTime())
    .map((session) => ({
      startAt: formatZonedDateTimeLocal(session.startAt, timeZone),
      capacity: session.capacity === null ? "" : String(session.capacity),
      status: session.status === "closed" ? "closed" as const : "open" as const,
    }));
}

export type FixedSessionRecord = {
  id: string;
  startAt: Date;
  capacity: number | null;
  registeredCount: number;
  status: string;
};

export type FixedSessionLiveRules = {
  sessionRegistrationCutoffMinutes: number;
};

/** The last instant a session still accepts registrations (exclusive). */
export function fixedSessionRegistrationClosesAt(session: Pick<FixedSessionRecord, "startAt">, live: FixedSessionLiveRules) {
  const cutoff = Number.isInteger(live.sessionRegistrationCutoffMinutes)
    ? Math.min(MAX_SESSION_REGISTRATION_CUTOFF_MINUTES, Math.max(0, live.sessionRegistrationCutoffMinutes))
    : 0;
  return new Date(session.startAt.getTime() + cutoff * 60_000);
}

export type FixedSessionRegistrationState = "open" | "full" | "closed" | "cancelled" | "past";

export function fixedSessionRegistrationState(
  session: FixedSessionRecord,
  live: FixedSessionLiveRules,
  now: Date,
): FixedSessionRegistrationState {
  if (session.status === "cancelled") return "cancelled";
  if (session.status !== "open") return "closed";
  if (now.getTime() >= fixedSessionRegistrationClosesAt(session, live).getTime()) return "past";
  if (session.capacity !== null && session.registeredCount >= session.capacity) return "full";
  return "open";
}

export type FixedSessionReplayRules = {
  replayEnabled: boolean;
  replayAvailableUntil: Date | null;
  sessionReplayWindowHours: number | null;
};

/**
 * Each session's own replay deadline, following the Live's replay rules:
 * no replay when replay is off; otherwise the per-session window after the
 * session ends, never past the Live's absolute replayAvailableUntil.
 * `null` means no deadline.
 */
export function fixedSessionReplayAvailableUntil(
  session: Pick<FixedSessionRecord, "startAt">,
  live: FixedSessionReplayRules,
  durationSeconds: number,
) {
  if (!live.replayEnabled) return null;
  const absolute = live.replayAvailableUntil?.getTime() ?? Number.POSITIVE_INFINITY;
  const hours = live.sessionReplayWindowHours;
  const window = typeof hours === "number" && Number.isInteger(hours) && hours > 0
    ? session.startAt.getTime() + durationSeconds * 1_000 + hours * 3_600_000
    : Number.POSITIVE_INFINITY;
  const until = Math.min(absolute, window);
  return Number.isFinite(until) ? new Date(until) : null;
}

export type FixedSessionRuntimeLive = FixedSessionReplayRules & {
  status: string;
  endedAt: Date | null;
  video: { durationSec: number | null } | null;
};

/**
 * The shared four-state lifecycle for one session: the regular VOD rules
 * with the session's startAt as the schedule and its own replay deadline.
 * A cancelled session never plays.
 */
export function resolveFixedSessionRuntime(
  live: FixedSessionRuntimeLive,
  session: Pick<FixedSessionRecord, "startAt" | "status">,
  now: Date,
): LiveRuntimeResolution {
  if (session.status === "cancelled" || !["scheduled", "live", "ended"].includes(live.status)) {
    return { state: "unavailable", playbackStartSeconds: null };
  }
  const durationSeconds = live.video?.durationSec ?? 0;
  const ended = live.status === "ended";
  return resolveLiveRuntime({
    streamMode: "vod",
    scheduledAt: session.startAt,
    // The Live lifecycle is shared; only an explicit "ended" stops sessions.
    status: ended ? "ended" : "scheduled",
    startedAt: null,
    endedAt: ended ? live.endedAt : null,
    // A deadline at or before this session's natural end leaves no replay.
    replayAvailableUntil: fixedSessionReplayAvailableUntil(session, live, durationSeconds),
    replayEnabled: live.replayEnabled,
    video: live.video,
  }, now);
}

/**
 * The session a viewer without a registered session follows: the one playing
 * now, else the next upcoming one, else the most recent one (for replay).
 * Cancelled sessions are never chosen.
 */
export function pickPublicFixedSession<T extends Pick<FixedSessionRecord, "startAt" | "status">>(
  sessions: readonly T[],
  durationSeconds: number,
  now: Date,
): T | null {
  const active = [...sessions]
    .filter((session) => session.status !== "cancelled")
    .sort((left, right) => left.startAt.getTime() - right.startAt.getTime());
  const nowMs = now.getTime();
  const playing = active.filter((session) => session.startAt.getTime() <= nowMs && nowMs < session.startAt.getTime() + durationSeconds * 1_000);
  if (playing.length > 0) return playing[playing.length - 1]!;
  const upcoming = active.find((session) => session.startAt.getTime() > nowMs);
  if (upcoming) return upcoming;
  return active.length > 0 ? active[active.length - 1]! : null;
}

export type PublicFixedSession = {
  id: string;
  startAt: string;
  /** HH:mm in the grouping timezone. */
  timeLabel: string;
  /** null = unlimited. */
  capacity: number | null;
  remaining: number | null;
  full: boolean;
};

export type PublicFixedSessionDay = {
  /** YYYY-MM-DD in the grouping timezone. */
  date: string;
  /** e.g. 10月30日（週五） */
  label: string;
  sessions: PublicFixedSession[];
};

const WEEKDAYS = ["日", "一", "二", "三", "四", "五", "六"] as const;

function dayLabel(date: string) {
  const [year, month, day] = date.split("-").map(Number);
  const weekday = new Date(Date.UTC(year!, month! - 1, day!)).getUTCDay();
  return `${month}月${day}日（週${WEEKDAYS[weekday]}）`;
}

/**
 * Sessions a registrant can still pick, grouped by local date and sorted.
 * Full sessions stay listed (with `full: true`) so the picker can show them
 * as unavailable; closed, cancelled and past ones are left out.
 */
export function groupOpenFixedSessionsByDate(
  sessions: readonly FixedSessionRecord[],
  live: FixedSessionLiveRules,
  input: { now: Date; timeZone?: string },
): PublicFixedSessionDay[] {
  const timeZone = input.timeZone ?? DEFAULT_SESSION_TIMEZONE;
  const days = new Map<string, PublicFixedSession[]>();
  const listed = [...sessions]
    .filter((session) => ["open", "full"].includes(fixedSessionRegistrationState(session, live, input.now)))
    .sort((left, right) => left.startAt.getTime() - right.startAt.getTime() || left.id.localeCompare(right.id));
  for (const session of listed) {
    const local = formatZonedDateTimeLocal(session.startAt, timeZone);
    const [date, time] = local.split("T") as [string, string];
    const remaining = session.capacity === null ? null : Math.max(0, session.capacity - session.registeredCount);
    const entry: PublicFixedSession = {
      id: session.id,
      startAt: session.startAt.toISOString(),
      timeLabel: time,
      capacity: session.capacity,
      remaining,
      full: remaining === 0,
    };
    days.set(date, [...(days.get(date) ?? []), entry]);
  }
  return [...days.entries()].map(([date, entries]) => ({ date, label: dayLabel(date), sessions: entries }));
}

/** The picker's label for one session, e.g. 10月30日（週五） 14:00, in the grouping timezone. */
export function fixedSessionLabel(startAt: Date, timeZone = DEFAULT_SESSION_TIMEZONE) {
  const [date, time] = formatZonedDateTimeLocal(startAt, timeZone).split("T") as [string, string];
  return `${dayLabel(date)} ${time}`;
}

/** {{live_start_at}} for one session, in the same style as the shared start. */
export function formatFixedSessionStart(startAt: Date, timeZone = DEFAULT_SESSION_TIMEZONE) {
  return new Intl.DateTimeFormat("zh-TW", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone,
  }).format(startAt);
}

export type StudioFixedSessionSettings = {
  sessions: ParsedFixedSession[];
  sessionRegistrationCutoffMinutes: number;
  sessionReplayWindowHours: number | null;
  /** The Live.scheduledAt to store: the latest session start. */
  scheduledAt: Date;
};

/** Form control the studio focuses for each validation failure. */
export function fixedSessionInvalidField(error: FixedSessionValidationError | "cutoff" | "replay") {
  if (error === "cutoff") return "sessionRegistrationCutoffMinutes";
  if (error === "replay") return "sessionReplayWindowHours";
  return "fixedSessions";
}

/**
 * Parses the studio's 指定場次 settings. Returns null for a Live with one
 * shared start; throws FixedSessionValidationError (or a plain Error with
 * message "cutoff" / "replay") for invalid input.
 */
export function parseStudioFixedSessionSettings(
  payload: {
    sessionMode?: string;
    fixedSessions?: readonly FixedSessionDraftRow[];
    sessionRegistrationCutoffMinutes?: string;
    sessionReplayWindowHours?: string;
  },
  input: { timeZone: string; now: Date; requireFuture: boolean; existingStartTimes?: ReadonlySet<number> },
): StudioFixedSessionSettings | null {
  if (payload.sessionMode !== "fixed_sessions") return null;
  const sessions = parseFixedSessionRows(payload.fixedSessions ?? [], input);
  const cutoffText = (payload.sessionRegistrationCutoffMinutes ?? "").trim() || "0";
  const cutoff = /^\d{1,4}$/u.test(cutoffText) ? Number(cutoffText) : Number.NaN;
  if (!Number.isInteger(cutoff) || cutoff < 0 || cutoff > MAX_SESSION_REGISTRATION_CUTOFF_MINUTES) throw new Error("cutoff");
  const replayText = (payload.sessionReplayWindowHours ?? "").trim();
  const replay = replayText ? (/^\d{1,4}$/u.test(replayText) ? Number(replayText) : Number.NaN) : null;
  if (replay !== null && (!Number.isInteger(replay) || replay < 1 || replay > MAX_SESSION_REPLAY_WINDOW_HOURS)) throw new Error("replay");
  return {
    sessions,
    sessionRegistrationCutoffMinutes: cutoff,
    sessionReplayWindowHours: replay,
    scheduledAt: fixedSessionScheduledAt(sessions)!,
  };
}

/** Spreadable `liveSessions` prop for a public registration form; empty for lives without fixed sessions. */
export function liveSessionsProp<T>(page: { submissionLiveSessions?: T }): { liveSessions?: T } {
  return page.submissionLiveSessions ? { liveSessions: page.submissionLiveSessions } : {};
}
