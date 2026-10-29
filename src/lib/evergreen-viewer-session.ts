import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { DERIVED_KEY_ROTATIONS } from "@/lib/derived-key-rotation";
import {
  EVERGREEN_SCHEDULE_MODES,
  getEvergreenPlaybackState,
  getEvergreenSessionStart,
  type EvergreenPlaybackState,
  type EvergreenSchedule,
  type EvergreenScheduleMode,
} from "@/lib/evergreen-webinar";
import {
  resolveLiveRuntime,
  type LiveRuntimeCandidate,
  type LiveRuntimeResolution,
  type LiveRuntimeState,
} from "@/lib/live-runtime-state";
import { deriveSensitiveDataKey } from "@/lib/sensitive-data";

/**
 * Per-visitor evergreen session (常青 Webinar 場次).
 *
 * The session start is computed only on the server from the Live's saved
 * schedule and the server clock, then kept in an httpOnly cookie signed with
 * a derived key. The cookie binds vendorId + liveId + a fingerprint of the
 * schedule, so it cannot be moved to another live or tenant, survives
 * refreshes, and is dropped when the merchant changes the schedule. A client
 * can only delete the cookie, which assigns the session any new visitor would
 * get at that moment; it can never choose an earlier start, so it cannot skip
 * the waiting room or reach later offers sooner.
 */

const TOKEN_VERSION = "eg1";
const KEY_PURPOSE = DERIVED_KEY_ROTATIONS.evergreenViewerSession.current;
const COOKIE_PREFIX = "celebratedeal_eg_";
export const EVERGREEN_SESSION_COOKIE_MAX_AGE_SECONDS = 30 * 24 * 60 * 60;
const MAX_TOKEN_LENGTH = 1_024;
const MAX_IDENTIFIER_LENGTH = 128;
const PAYLOAD_PATTERN = /^[A-Za-z0-9_-]{1,900}$/u;
const SIGNATURE_PATTERN = /^[A-Za-z0-9_-]{43}$/u;
const FINGERPRINT_PATTERN = /^[0-9a-f]{32}$/u;
/** A legitimately issued start is never further than two days from its issue time. */
const MAX_START_DISTANCE_MS = 2 * 24 * 60 * 60 * 1_000;
const CLOCK_SKEW_MS = 60_000;
const DEFAULT_TIMEZONE = "Asia/Taipei";

export type EvergreenLiveRecord = {
  id: string;
  vendorId: string;
  status: string;
  streamMode: string;
  isEvergreen: boolean;
  evergreenScheduleMode: string;
  evergreenIntervalMinutes: number;
  evergreenDailyTimes: string[];
  evergreenSessionStartAt: Date | null;
  replayEnabled: boolean;
  replayAvailableUntil: Date | null;
  video: { durationSec: number | null } | null;
};

/** Prisma select for every field the evergreen session needs. */
export const EVERGREEN_LIVE_SELECT = {
  id: true,
  vendorId: true,
  status: true,
  streamMode: true,
  isEvergreen: true,
  evergreenScheduleMode: true,
  evergreenIntervalMinutes: true,
  evergreenDailyTimes: true,
  evergreenSessionStartAt: true,
  replayEnabled: true,
  replayAvailableUntil: true,
} as const;

export type ActiveEvergreenSchedule = EvergreenSchedule & {
  timezone: string;
  /** Merchant anchor: every visitor shares this start (overrides the mode). */
  sharedStartAt: Date | null;
};

export type EvergreenViewerSession = {
  schedule: ActiveEvergreenSchedule;
  /** False while the visitor has no signed session yet (read-only preview). */
  assigned: boolean;
  sessionStartAt: Date;
  playback: EvergreenPlaybackState;
  runtimeState: LiveRuntimeState;
  /** A visitor whose own session ended may ask for the next one. */
  canRejoin: boolean;
  /** Present only when a new signed cookie must be written. */
  issuedToken: string | null;
};

function isIdentifier(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= MAX_IDENTIFIER_LENGTH;
}

function validTimezone(value: string | null | undefined) {
  if (!value) return null;
  try {
    new Intl.DateTimeFormat("en", { timeZone: value }).format(0);
    return value;
  } catch {
    return null;
  }
}

function validDurationSeconds(value: number | null | undefined) {
  return typeof value === "number" && Number.isInteger(value) && value > 0 && value <= 86_400 ? value : null;
}

/**
 * Returns the schedule only when evergreen playback governs this Live:
 * an evergreen VOD that the merchant has not ended, with a usable duration.
 * Everything else keeps the regular scheduledAt lifecycle.
 */
export function evergreenScheduleForLive(
  live: EvergreenLiveRecord,
  vendorTimezone: string | null | undefined,
): ActiveEvergreenSchedule | null {
  if (!live.isEvergreen || live.streamMode !== "vod" || !["scheduled", "live"].includes(live.status)) return null;
  const durationSeconds = validDurationSeconds(live.video?.durationSec);
  if (!durationSeconds) return null;
  if (!EVERGREEN_SCHEDULE_MODES.includes(live.evergreenScheduleMode as EvergreenScheduleMode)) return null;
  const mode = live.evergreenScheduleMode as EvergreenScheduleMode;
  const intervalMinutes = [5, 15, 30].includes(live.evergreenIntervalMinutes)
    ? live.evergreenIntervalMinutes as 5 | 15 | 30
    : 15;
  const dailyTimes = [...new Set(live.evergreenDailyTimes ?? [])].sort();
  if (mode === "recurring_daily" && dailyTimes.length === 0) return null;
  const sharedStartAt = live.evergreenSessionStartAt && Number.isFinite(live.evergreenSessionStartAt.getTime())
    ? new Date(live.evergreenSessionStartAt.getTime())
    : null;
  const schedule: ActiveEvergreenSchedule = {
    mode,
    durationSeconds,
    timezone: validTimezone(vendorTimezone) ?? DEFAULT_TIMEZONE,
    intervalMinutes,
    dailyTimes,
    sharedStartAt,
  };
  try {
    // Reject a schedule the engine cannot compute (e.g. malformed daily times).
    getEvergreenSessionStart(schedule, new Date());
  } catch {
    return null;
  }
  return schedule;
}

/** Changes whenever a setting that moves the visitor's session changes. */
export function evergreenScheduleFingerprint(schedule: ActiveEvergreenSchedule) {
  return createHash("sha256").update(JSON.stringify([
    "evergreen-schedule-v1",
    schedule.mode,
    schedule.intervalMinutes ?? null,
    schedule.dailyTimes ?? [],
    schedule.sharedStartAt?.getTime() ?? null,
    schedule.timezone,
    schedule.durationSeconds,
  ])).digest("hex").slice(0, 32);
}

export function evergreenSessionCookieName(liveId: string) {
  return `${COOKIE_PREFIX}${createHash("sha256").update(`evergreen-cookie:${liveId}`).digest("hex").slice(0, 24)}`;
}

function signature(signedValue: string) {
  return createHmac("sha256", deriveSensitiveDataKey(KEY_PURPOSE)).update(signedValue).digest("base64url");
}

type TokenClaims = { v: string; l: string; s: number; f: string; i: number };

export function createEvergreenSessionToken(input: {
  vendorId: string;
  liveId: string;
  schedule: ActiveEvergreenSchedule;
  sessionStartAt: Date;
  now?: Date;
}) {
  if (!isIdentifier(input.vendorId) || !isIdentifier(input.liveId)) throw new Error("Invalid evergreen session binding.");
  const startMs = input.sessionStartAt.getTime();
  const issuedAtSeconds = Math.floor((input.now ?? new Date()).getTime() / 1_000);
  if (!Number.isSafeInteger(startMs) || !Number.isSafeInteger(issuedAtSeconds) || issuedAtSeconds <= 0) {
    throw new Error("Invalid evergreen session time.");
  }
  const claims: TokenClaims = {
    v: input.vendorId,
    l: input.liveId,
    s: startMs,
    f: evergreenScheduleFingerprint(input.schedule),
    i: issuedAtSeconds,
  };
  const payload = Buffer.from(JSON.stringify(claims), "utf8").toString("base64url");
  const signedValue = `${TOKEN_VERSION}.${payload}`;
  return `${signedValue}.${signature(signedValue)}`;
}

function parseClaims(payload: string): TokenClaims | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  const claims = parsed as Record<string, unknown>;
  if (Object.keys(claims).sort().join(",") !== "f,i,l,s,v") return null;
  if (!isIdentifier(claims.v) || !isIdentifier(claims.l)) return null;
  if (typeof claims.f !== "string" || !FINGERPRINT_PATTERN.test(claims.f)) return null;
  if (typeof claims.s !== "number" || !Number.isSafeInteger(claims.s)) return null;
  if (typeof claims.i !== "number" || !Number.isSafeInteger(claims.i) || claims.i <= 0) return null;
  return claims as TokenClaims;
}

/**
 * Returns the signed session start only for an authentic, unexpired token
 * issued for exactly this vendor, live and current schedule.
 */
export function verifyEvergreenSessionToken(
  token: string | null | undefined,
  input: { vendorId: string; liveId: string; schedule: ActiveEvergreenSchedule; now?: Date },
): Date | null {
  if (typeof token !== "string" || token.length === 0 || token.length > MAX_TOKEN_LENGTH) return null;
  const [version, payload, suppliedSignature, extra] = token.split(".");
  if (
    version !== TOKEN_VERSION
    || !payload
    || !PAYLOAD_PATTERN.test(payload)
    || !suppliedSignature
    || !SIGNATURE_PATTERN.test(suppliedSignature)
    || extra !== undefined
  ) return null;
  const expected = Buffer.from(signature(`${TOKEN_VERSION}.${payload}`), "utf8");
  const supplied = Buffer.from(suppliedSignature, "utf8");
  if (expected.length !== supplied.length || !timingSafeEqual(expected, supplied)) return null;

  const claims = parseClaims(payload);
  if (!claims) return null;
  if (claims.v !== input.vendorId || claims.l !== input.liveId) return null;
  const fingerprint = Buffer.from(evergreenScheduleFingerprint(input.schedule), "utf8");
  const claimed = Buffer.from(claims.f, "utf8");
  if (fingerprint.length !== claimed.length || !timingSafeEqual(fingerprint, claimed)) return null;
  const nowMs = (input.now ?? new Date()).getTime();
  const issuedAtMs = claims.i * 1_000;
  if (issuedAtMs > nowMs + CLOCK_SKEW_MS) return null;
  if (nowMs - issuedAtMs >= EVERGREEN_SESSION_COOKIE_MAX_AGE_SECONDS * 1_000) return null;
  if (Math.abs(claims.s - issuedAtMs) > MAX_START_DISTANCE_MS) return null;
  return new Date(claims.s);
}

function replayOpen(live: Pick<EvergreenLiveRecord, "replayEnabled" | "replayAvailableUntil">, now: Date) {
  return live.replayEnabled === true
    && (live.replayAvailableUntil === null || now.getTime() < live.replayAvailableUntil.getTime());
}

/** Maps the visitor's own session onto the shared four-state lifecycle. */
export function evergreenRuntimeState(
  playback: EvergreenPlaybackState,
  live: Pick<EvergreenLiveRecord, "replayEnabled" | "replayAvailableUntil">,
  now: Date,
): LiveRuntimeState {
  if (playback.roomState === "waiting_countdown") return "waiting";
  if (playback.roomState === "playing") return "playing";
  return replayOpen(live, now) ? "replay" : "unavailable";
}

export type EvergreenSessionIntent = "read" | "claim" | "rejoin";

/**
 * Resolves the visitor's session. `read` never assigns (Server Components
 * cannot write cookies); `claim` assigns once and keeps an existing session;
 * `rejoin` replaces only a session that has already ended.
 */
export function resolveEvergreenViewerSession(input: {
  live: EvergreenLiveRecord;
  vendorTimezone: string | null | undefined;
  token: string | null | undefined;
  intent: EvergreenSessionIntent;
  now?: Date;
}): EvergreenViewerSession | null {
  const now = input.now ?? new Date();
  const schedule = evergreenScheduleForLive(input.live, input.vendorTimezone);
  if (!schedule) return null;
  const engineSchedule: EvergreenSchedule = { ...schedule, sessionStartAt: schedule.sharedStartAt ?? undefined };
  if (schedule.sharedStartAt) {
    // A merchant anchor is one shared session: nothing per visitor to sign.
    const playback = getEvergreenPlaybackState(engineSchedule, now);
    return {
      schedule,
      assigned: true,
      sessionStartAt: playback.sessionStartAt,
      playback,
      runtimeState: evergreenRuntimeState(playback, input.live, now),
      canRejoin: false,
      issuedToken: null,
    };
  }
  const binding = { vendorId: input.live.vendorId, liveId: input.live.id, schedule, now };
  const signedStart = verifyEvergreenSessionToken(input.token, binding);

  let sessionStartAt = signedStart;
  let issuedToken: string | null = null;
  if (signedStart && input.intent === "rejoin") {
    const current = getEvergreenPlaybackState({ ...engineSchedule, sessionStartAt: signedStart }, now);
    if (current.roomState === "ended") sessionStartAt = null;
  }
  if (!sessionStartAt && input.intent !== "read") {
    sessionStartAt = getEvergreenSessionStart(engineSchedule, now);
    issuedToken = createEvergreenSessionToken({ ...binding, sessionStartAt });
  }
  const assigned = sessionStartAt !== null;
  const effectiveStart = sessionStartAt ?? getEvergreenSessionStart(engineSchedule, now);
  const playback = getEvergreenPlaybackState({ ...engineSchedule, sessionStartAt: effectiveStart }, now);
  return {
    schedule,
    assigned,
    sessionStartAt: effectiveStart,
    playback,
    runtimeState: assigned ? evergreenRuntimeState(playback, input.live, now) : "waiting",
    canRejoin: assigned && playback.roomState === "ended",
    issuedToken,
  };
}

/**
 * The lifecycle a viewer-facing server path (admission, playback source)
 * must use. Evergreen Lives follow only the visitor's signed session: without
 * one the visitor is still in the waiting room and gets no admission or media.
 * Other Lives keep the shared scheduledAt lifecycle unchanged.
 */
export function resolveViewerLiveRuntime(
  live: LiveRuntimeCandidate & EvergreenLiveRecord,
  input: { vendorTimezone: string | null | undefined; evergreenToken: string | null | undefined; now: Date },
): LiveRuntimeResolution & { evergreen: EvergreenViewerSession | null } {
  const evergreen = resolveEvergreenViewerSession({
    live,
    vendorTimezone: input.vendorTimezone,
    token: input.evergreenToken,
    intent: "read",
    now: input.now,
  });
  if (!evergreen) return { ...resolveLiveRuntime(live, input.now), evergreen: null };
  if (!evergreen.assigned) return { state: "waiting", playbackStartSeconds: null, evergreen };
  return {
    state: evergreen.runtimeState,
    playbackStartSeconds: evergreen.runtimeState === "playing" ? evergreen.playback.offsetSeconds : null,
    evergreen,
  };
}

function readCookieValue(header: string | null, name: string) {
  if (!header) return null;
  for (const segment of header.split(";").slice(0, 100)) {
    const separator = segment.indexOf("=");
    if (separator < 0 || segment.slice(0, separator).trim() !== name) continue;
    const value = segment.slice(separator + 1).trim();
    try {
      return decodeURIComponent(value);
    } catch {
      return null;
    }
  }
  return null;
}

export function evergreenSessionTokenFromRequest(request: Request, liveId: string) {
  const value = readCookieValue(request.headers.get("cookie"), evergreenSessionCookieName(liveId));
  return value && value.length <= MAX_TOKEN_LENGTH ? value : null;
}

export function evergreenSessionCookieOptions(request: Request) {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: new URL(request.url).protocol === "https:",
    path: "/",
    maxAge: EVERGREEN_SESSION_COOKIE_MAX_AGE_SECONDS,
  };
}

/** Client-safe projection; never includes the token. */
export function publicEvergreenSession(session: EvergreenViewerSession, now: Date) {
  return {
    assigned: session.assigned,
    mode: session.schedule.mode,
    timezone: session.schedule.timezone,
    roomState: session.playback.roomState,
    runtimeState: session.runtimeState,
    sessionStartAt: session.sessionStartAt.toISOString(),
    sessionEndAt: session.playback.sessionEndAt.toISOString(),
    offsetSeconds: session.playback.offsetSeconds,
    serverNow: now.toISOString(),
    canRejoin: session.canRejoin,
  };
}

export type PublicEvergreenSession = ReturnType<typeof publicEvergreenSession>;
