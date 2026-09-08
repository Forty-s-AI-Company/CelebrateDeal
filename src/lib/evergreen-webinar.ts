export const EVERGREEN_SCHEDULE_MODES = ["just_in_time", "recurring_daily", "on_demand"] as const;

export type EvergreenScheduleMode = (typeof EVERGREEN_SCHEDULE_MODES)[number];
export type EvergreenRoomState = "waiting_countdown" | "playing" | "ended";

export type EvergreenSchedule = {
  mode: EvergreenScheduleMode;
  durationSeconds: number;
  /** IANA timezone used by recurring_daily, for example Asia/Taipei. */
  timezone?: string;
  /** Fixed cohort start. JIT callers should persist this when the viewer enters. */
  sessionStartAt?: Date | string;
  intervalMinutes?: 5 | 15 | 30;
  dailyTimes?: string[];
};

export type EvergreenPlaybackState = {
  roomState: EvergreenRoomState;
  offsetSeconds: number;
  sessionStartAt: Date;
  sessionEndAt: Date;
  countdownSeconds: number;
};

export type EvergreenTimelineEvent = {
  id: string;
  triggerSec: number;
};

const DAILY_TIME_PATTERN = /^(?:[01]\d|2[0-3]):[0-5]\d$/u;

function validDate(value: Date | string | undefined, label: string) {
  if (value === undefined) return null;
  const date = value instanceof Date ? new Date(value.getTime()) : new Date(value);
  if (!Number.isFinite(date.getTime())) throw new Error(`${label} must be a valid date`);
  return date;
}

function assertDuration(durationSeconds: number) {
  if (!Number.isInteger(durationSeconds) || durationSeconds <= 0 || durationSeconds > 86_400) {
    throw new Error("durationSeconds must be an integer between 1 and 86400");
  }
}

/** Returns the next aligned JIT cohort, never more than intervalMinutes away. */
export function getNextJustInTimeStart(serverTime: Date | string, intervalMinutes = 15) {
  if (![5, 15, 30].includes(intervalMinutes)) throw new Error("intervalMinutes must be 5, 15, or 30");
  const now = validDate(serverTime, "serverTime")!;
  const intervalMs = intervalMinutes * 60_000;
  return new Date(Math.ceil((now.getTime() + 1) / intervalMs) * intervalMs);
}

function timezoneParts(date: Date, timezone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  return Object.fromEntries(parts.map((part) => [part.type, part.value]));
}

/** Converts local wall-clock parts to an instant without depending on the host timezone. */
function zonedDate(year: number, month: number, day: number, hour: number, minute: number, timezone: string) {
  let guess = Date.UTC(year, month - 1, day, hour, minute);
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const parts = timezoneParts(new Date(guess), timezone);
    const represented = Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), Number(parts.hour), Number(parts.minute));
    const desired = Date.UTC(year, month - 1, day, hour, minute);
    const correction = desired - represented;
    guess += correction;
    if (correction === 0) return new Date(guess);
  }
  const result = new Date(guess);
  const parts = timezoneParts(result, timezone);
  if (Number(parts.year) !== year || Number(parts.month) !== month || Number(parts.day) !== day || Number(parts.hour) !== hour || Number(parts.minute) !== minute) {
    throw new Error("daily time does not exist in the configured timezone");
  }
  return result;
}

function recurringStart(schedule: EvergreenSchedule, now: Date) {
  const timezone = schedule.timezone ?? "UTC";
  const dailyTimes = [...new Set(schedule.dailyTimes ?? [])].sort();
  if (!dailyTimes.length || dailyTimes.some((value) => !DAILY_TIME_PATTERN.test(value))) {
    throw new Error("recurring_daily requires valid HH:mm dailyTimes");
  }
  // Validate the IANA identifier before calculating candidates.
  try { timezoneParts(now, timezone); } catch { throw new Error("timezone must be a valid IANA timezone"); }
  const local = timezoneParts(now, timezone);
  const noon = Date.UTC(Number(local.year), Number(local.month) - 1, Number(local.day), 12);
  const candidates: Date[] = [];
  for (const dayOffset of [-1, 0, 1]) {
    const day = new Date(noon + dayOffset * 86_400_000);
    for (const time of dailyTimes) {
      const [hour, minute] = time.split(":").map(Number);
      candidates.push(zonedDate(day.getUTCFullYear(), day.getUTCMonth() + 1, day.getUTCDate(), hour!, minute!, timezone));
    }
  }
  const latestActive = candidates
    .filter((start) => start <= now && now.getTime() < start.getTime() + schedule.durationSeconds * 1_000)
    .sort((a, b) => b.getTime() - a.getTime())[0];
  if (latestActive) return latestActive;
  const next = candidates.filter((start) => start > now).sort((a, b) => a.getTime() - b.getTime())[0];
  if (!next) throw new Error("unable to calculate recurring session");
  return next;
}

export function getEvergreenPlaybackState(schedule: EvergreenSchedule, serverTime: Date | string): EvergreenPlaybackState {
  assertDuration(schedule.durationSeconds);
  const now = validDate(serverTime, "serverTime")!;
  const fixedStart = validDate(schedule.sessionStartAt, "sessionStartAt");
  const sessionStartAt = fixedStart ?? (schedule.mode === "just_in_time"
    ? getNextJustInTimeStart(now, schedule.intervalMinutes ?? 15)
    : schedule.mode === "recurring_daily"
      ? recurringStart(schedule, now)
      : now);
  const sessionEndAt = new Date(sessionStartAt.getTime() + schedule.durationSeconds * 1_000);
  if (now < sessionStartAt) {
    return { roomState: "waiting_countdown", offsetSeconds: 0, sessionStartAt, sessionEndAt, countdownSeconds: Math.ceil((sessionStartAt.getTime() - now.getTime()) / 1_000) };
  }
  if (now >= sessionEndAt) {
    return { roomState: "ended", offsetSeconds: schedule.durationSeconds, sessionStartAt, sessionEndAt, countdownSeconds: 0 };
  }
  return { roomState: "playing", offsetSeconds: (now.getTime() - sessionStartAt.getTime()) / 1_000, sessionStartAt, sessionEndAt, countdownSeconds: 0 };
}

/** Selects events crossed since the last accepted heartbeat; callers dedupe by event id. */
export function getTriggeredEvergreenEvents<T extends EvergreenTimelineEvent>(events: T[], previousOffsetSeconds: number, offsetSeconds: number) {
  const lower = Math.max(0, previousOffsetSeconds);
  const upper = Math.max(lower, offsetSeconds);
  return events.filter((event) => Number.isFinite(event.triggerSec) && event.triggerSec > lower && event.triggerSec <= upper)
    .sort((a, b) => a.triggerSec - b.triggerSec || a.id.localeCompare(b.id));
}

export type WatchProgressSample = {
  previousOffsetSeconds: number;
  reportedOffsetSeconds: number;
  elapsedWallSeconds: number;
  claimedWatchSeconds: number;
  playbackRate?: number;
  previewMode?: boolean;
};

/** Fail-closed anti-cheat check for public playback heartbeats. */
export function validateEvergreenWatchProgress(sample: WatchProgressSample) {
  const values = [sample.previousOffsetSeconds, sample.reportedOffsetSeconds, sample.elapsedWallSeconds, sample.claimedWatchSeconds];
  if (values.some((value) => !Number.isFinite(value) || value < 0)) return { accepted: false as const, reason: "invalid_number" as const };
  const playbackRate = sample.playbackRate ?? 1;
  if (!sample.previewMode && playbackRate !== 1) return { accepted: false as const, reason: "playback_rate" as const };
  const mediaDelta = sample.reportedOffsetSeconds - sample.previousOffsetSeconds;
  if (mediaDelta < 0) return { accepted: false as const, reason: "rewind" as const };
  const allowance = Math.max(2, sample.elapsedWallSeconds * (sample.previewMode ? Math.max(1, playbackRate) : 1) + 2);
  if (mediaDelta > allowance || sample.claimedWatchSeconds > sample.elapsedWallSeconds + 2) {
    return { accepted: false as const, reason: "time_jump" as const };
  }
  return { accepted: true as const, watchSeconds: Math.min(sample.claimedWatchSeconds, sample.elapsedWallSeconds) };
}
