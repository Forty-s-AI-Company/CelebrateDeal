import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { DERIVED_KEY_ROTATIONS } from "@/lib/derived-key-rotation";
import {
  evergreenScheduleForLive,
  type ActiveEvergreenSchedule,
} from "@/lib/evergreen-activation";
import {
  getEvergreenPlaybackState,
  getEvergreenSessionStart,
  type EvergreenPlaybackState,
  type EvergreenSchedule,
} from "@/lib/evergreen-webinar";
import {
  resolveLiveRuntime,
  type LiveRuntimeCandidate,
  type LiveRuntimeResolution,
  type LiveRuntimeState,
} from "@/lib/live-runtime-state";
import { deriveSensitiveDataKey } from "@/lib/sensitive-data";
import {
  isFixedSessionLive,
  resolveFixedSessionRuntime,
  type FixedSessionRecord,
  type FixedSessionReplayRules,
} from "@/lib/live-fixed-sessions";

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
/**
 * Upper bound for both the cookie and the signed token. Each evergreen Live
 * gets its own Path=/ cookie, so a long lifetime would let a visitor who browses
 * many webinars accumulate enough cookies to exceed request header limits (431).
 */
export const EVERGREEN_SESSION_COOKIE_MAX_AGE_SECONDS = 7 * 24 * 60 * 60;
/** Keeps an ended session (and its rejoin option) visible briefly without replay. */
const ENDED_SESSION_GRACE_SECONDS = 60 * 60;
const MIN_COOKIE_MAX_AGE_SECONDS = 60;
const MAX_TOKEN_LENGTH = 1_024;
const MAX_IDENTIFIER_LENGTH = 128;
const PAYLOAD_PATTERN = /^[A-Za-z0-9_-]{1,900}$/u;
const SIGNATURE_PATTERN = /^[A-Za-z0-9_-]{43}$/u;
const FINGERPRINT_PATTERN = /^[0-9a-f]{32}$/u;
/** A legitimately issued start is never further than two days from its issue time. */
const MAX_START_DISTANCE_MS = 2 * 24 * 60 * 60 * 1_000;
const CLOCK_SKEW_MS = 60_000;

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
  /** A fixed-session Live (指定場次) never runs the evergreen schedule. */
  sessionMode?: string | null;
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
  sessionMode: true,
  replayEnabled: true,
  replayAvailableUntil: true,
} as const;

export { evergreenScheduleForLive, type ActiveEvergreenSchedule };

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
  const schedule = evergreenScheduleForLive(input.live, input.vendorTimezone, now);
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
  live: LiveRuntimeCandidate & EvergreenLiveRecord & Partial<FixedSessionReplayRules> & { sessionMode?: string | null },
  input: {
    vendorTimezone: string | null | undefined;
    evergreenToken: string | null | undefined;
    now: Date;
    /**
     * The session this viewer follows on a fixed-session Live (指定場次),
     * resolved on the server by resolveViewerFixedSession. Without one the
     * viewer stays in the waiting room and gets no admission or media.
     */
    fixedSession?: Pick<FixedSessionRecord, "startAt" | "status"> | null;
  },
): LiveRuntimeResolution & { evergreen: EvergreenViewerSession | null } {
  if (isFixedSessionLive(live)) {
    if (!input.fixedSession) return { state: "waiting", playbackStartSeconds: null, evergreen: null };
    return {
      ...resolveFixedSessionRuntime({
        status: live.status,
        endedAt: live.endedAt,
        replayEnabled: live.replayEnabled === true,
        replayAvailableUntil: live.replayAvailableUntil,
        sessionReplayWindowHours: live.sessionReplayWindowHours ?? null,
        video: live.video ?? null,
      }, input.fixedSession, input.now),
      evergreen: null,
    };
  }
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

/** {{live_start_at}} for an evergreen visitor whose own session time is unknown. */
export const EVERGREEN_NEUTRAL_START_TEXT = "依你的觀看時段開始";

/**
 * {{live_start_at}} for outbound messages about an evergreen Live: the
 * visitor's own upcoming or running session in the merchant timezone, or a
 * neutral phrase when no signed session is available (or it already ended).
 * The Live's scheduledAt is never used, because it is not the visitor's start.
 */
export function evergreenRegistrationStartText(input: {
  live: EvergreenLiveRecord;
  vendorTimezone: string | null | undefined;
  token: string | null | undefined;
  now?: Date;
}) {
  const session = resolveEvergreenViewerSession({ ...input, intent: "read" });
  if (!session?.assigned || session.playback.roomState === "ended") return EVERGREEN_NEUTRAL_START_TEXT;
  return new Intl.DateTimeFormat("zh-TW", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: session.schedule.timezone,
  }).format(session.sessionStartAt);
}

/**
 * The one cookie parser for evergreen tokens: Route Handlers pass the Request
 * header and the viewer page passes `headers()`, so both see the same value.
 * It scans every segment (no count cap) and returns the first match, which is
 * the most specific one browsers send first.
 */
export function readCookieHeaderValue(header: string | null | undefined, name: string) {
  if (!header) return null;
  for (const segment of header.split(";")) {
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

export function evergreenSessionTokenFromCookieHeader(header: string | null | undefined, liveId: string) {
  const value = readCookieHeaderValue(header, evergreenSessionCookieName(liveId));
  return value && value.length <= MAX_TOKEN_LENGTH ? value : null;
}

export function evergreenSessionTokenFromRequest(request: Request, liveId: string) {
  return evergreenSessionTokenFromCookieHeader(request.headers.get("cookie"), liveId);
}

/**
 * Keeps the cookie only as long as the session can still matter: until the
 * replay window closes (or a short grace after the session ends when replay is
 * off), never longer than EVERGREEN_SESSION_COOKIE_MAX_AGE_SECONDS.
 */
export function evergreenSessionCookieMaxAgeSeconds(
  session: Pick<EvergreenViewerSession, "playback">,
  live: Pick<EvergreenLiveRecord, "replayEnabled" | "replayAvailableUntil">,
  now: Date,
) {
  const graceUntil = session.playback.sessionEndAt.getTime() + ENDED_SESSION_GRACE_SECONDS * 1_000;
  const replayUntil = live.replayEnabled === true
    ? live.replayAvailableUntil?.getTime() ?? Number.POSITIVE_INFINITY
    : Number.NEGATIVE_INFINITY;
  const keepUntil = Math.max(graceUntil, replayUntil);
  const seconds = Math.ceil((keepUntil - now.getTime()) / 1_000);
  if (!Number.isFinite(seconds)) return seconds > 0 ? EVERGREEN_SESSION_COOKIE_MAX_AGE_SECONDS : MIN_COOKIE_MAX_AGE_SECONDS;
  return Math.max(MIN_COOKIE_MAX_AGE_SECONDS, Math.min(EVERGREEN_SESSION_COOKIE_MAX_AGE_SECONDS, seconds));
}

export function evergreenSessionCookieOptions(request: Request, maxAgeSeconds: number) {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: new URL(request.url).protocol === "https:",
    path: "/",
    maxAge: Number.isFinite(maxAgeSeconds)
      ? Math.max(MIN_COOKIE_MAX_AGE_SECONDS, Math.min(EVERGREEN_SESSION_COOKIE_MAX_AGE_SECONDS, Math.floor(maxAgeSeconds)))
      : MIN_COOKIE_MAX_AGE_SECONDS,
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
