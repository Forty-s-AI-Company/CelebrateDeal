import { createHash } from "node:crypto";
import { DERIVED_KEY_ROTATIONS, signWithRotation, verifyWithRotation } from "@/lib/derived-key-rotation";

/**
 * Attendance-only cookie (Q-17), set by a personal watch link
 * (/api/live-watch-link) instead of the full registration cookie.
 *
 * It says only "this browser was sent here by registration S of Live L of
 * vendor V" and is read by exactly one place: the attendance recorder of
 * /api/live-admission (live-registration-attendance.ts). It grants nothing
 * else: no chat or private chat identity, no LINE binding, no checkout
 * association, no fixed-session schedule. Those keep reading only the
 * registration cookie (FORM_SUBMISSION_CHAT_SESSION_COOKIE), whose name, key
 * and format differ, so a forwarded or planted watch link can at most record
 * someone's viewing under that registration.
 *
 * One cookie per Live (the name is a hash of the Live id, like the evergreen
 * session cookie), so links of several Lives do not overwrite each other.
 * Path is /api/live-admission, the only route that reads it, so it travels
 * with no other request. It expires together with the link that set it.
 */

const VERSION = "lat1";
const KEY = DERIVED_KEY_ROTATIONS.liveAttendance;
const COOKIE_PREFIX = "celebratedeal_la_";
export const LIVE_ATTENDANCE_COOKIE_PATH = "/api/live-admission";
/** Same cap as the watch link: a cookie never outlives the link that set it. */
export const LIVE_ATTENDANCE_MAX_LIFETIME_SECONDS = 400 * 24 * 60 * 60;
const MAX_TOKEN_LENGTH = 600;
const PAYLOAD = /^[A-Za-z0-9_-]{1,520}$/u;
const SIGNATURE = /^[A-Za-z0-9_-]{43}$/u;
const ID = /^[A-Za-z0-9_-]{1,128}$/u;

export type LiveAttendanceClaim = {
  vendorId: string;
  liveId: string;
  submissionId: string;
  expiresAt: Date;
};

type Claims = { v: string; l: string; s: string; e: number };

export type LiveAttendanceCookieOptions = {
  httpOnly: true;
  sameSite: "lax";
  secure: boolean;
  path: typeof LIVE_ATTENDANCE_COOKIE_PATH;
  maxAge: number;
};

function seconds(value: Date) {
  const result = Math.floor(value.getTime() / 1_000);
  if (!Number.isSafeInteger(result) || result <= 0) throw new Error("Invalid attendance cookie clock.");
  return result;
}

/** The cookie name for one Live (null for an id that is not a plain id). */
export function liveAttendanceCookieName(liveId: string) {
  if (!ID.test(liveId)) return null;
  return `${COOKIE_PREFIX}${createHash("sha256").update(`live-attendance-cookie:${liveId}`).digest("hex").slice(0, 24)}`;
}

export function createLiveAttendanceToken(claim: LiveAttendanceClaim) {
  if (!ID.test(claim.vendorId) || !ID.test(claim.liveId) || !ID.test(claim.submissionId)) {
    throw new Error("Invalid attendance cookie binding.");
  }
  const claims: Claims = { v: claim.vendorId, l: claim.liveId, s: claim.submissionId, e: seconds(claim.expiresAt) };
  const value = `${VERSION}.${Buffer.from(JSON.stringify(claims), "utf8").toString("base64url")}`;
  return `${value}.${signWithRotation(KEY, value)}`;
}

/** The claim of a genuine, unexpired attendance cookie, or null. */
export function verifyLiveAttendanceToken(token: string | null | undefined, now = new Date()): LiveAttendanceClaim | null {
  if (typeof token !== "string" || token.length === 0 || token.length > MAX_TOKEN_LENGTH) return null;
  const [version, payload, signature, extra] = token.split(".");
  if (version !== VERSION || !payload || !PAYLOAD.test(payload) || !signature || !SIGNATURE.test(signature) || extra !== undefined) return null;
  if (!verifyWithRotation(KEY, `${VERSION}.${payload}`, signature, now)) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object") return null;
  const claims = parsed as Partial<Claims>;
  if (
    typeof claims.v !== "string" || !ID.test(claims.v)
    || typeof claims.l !== "string" || !ID.test(claims.l)
    || typeof claims.s !== "string" || !ID.test(claims.s)
    || typeof claims.e !== "number" || !Number.isSafeInteger(claims.e)
  ) return null;
  const nowSeconds = seconds(now);
  if (claims.e <= nowSeconds || claims.e > nowSeconds + LIVE_ATTENDANCE_MAX_LIFETIME_SECONDS) return null;
  return { vendorId: claims.v, liveId: claims.l, submissionId: claims.s, expiresAt: new Date(claims.e * 1_000) };
}

/** Cookie attributes; maxAge runs to the claim's expiry (at least one second). */
export function liveAttendanceCookieOptions(secure: boolean, expiresAt: Date, now = new Date()): LiveAttendanceCookieOptions {
  return {
    httpOnly: true,
    sameSite: "lax",
    secure,
    path: LIVE_ATTENDANCE_COOKIE_PATH,
    maxAge: Math.max(1, Math.floor((expiresAt.getTime() - now.getTime()) / 1_000)),
  };
}

/**
 * Review n-1: the registration cookie reader has no header cap, so a browser
 * with many cookies must not lose attendance here only. 16 KiB is Node's
 * default limit for all request headers together, so any header that reaches
 * this code fits.
 */
export const LIVE_ATTENDANCE_COOKIE_HEADER_MAX_LENGTH = 16 * 1_024;

function readCookie(header: string | null, name: string) {
  if (!header || header.length > LIVE_ATTENDANCE_COOKIE_HEADER_MAX_LENGTH) return null;
  let found: string | null = null;
  for (const segment of header.split(";")) {
    const separator = segment.indexOf("=");
    if (separator < 0 || segment.slice(0, separator).trim() !== name) continue;
    // Two cookies of the same name (e.g. a planted one): trust neither.
    if (found !== null) return null;
    try {
      found = decodeURIComponent(segment.slice(separator + 1).trim());
    } catch {
      return null;
    }
  }
  return found;
}

/**
 * The registration this browser's attendance cookie names for exactly this
 * Live and vendor, or null. Only the attendance recorder may call this.
 */
export function liveAttendanceSubmissionIdFromRequest(
  request: Request,
  input: { vendorId: string; liveId: string; now: Date },
) {
  const name = liveAttendanceCookieName(input.liveId);
  if (!name) return null;
  const claim = verifyLiveAttendanceToken(readCookie(request.headers.get("cookie"), name), input.now);
  if (!claim || claim.vendorId !== input.vendorId || claim.liveId !== input.liveId) return null;
  return claim.submissionId;
}
