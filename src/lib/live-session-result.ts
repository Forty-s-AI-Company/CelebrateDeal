import { DERIVED_KEY_ROTATIONS, signWithRotation, verifyWithRotation } from "@/lib/derived-key-rotation";
import { LIVE_SESSION_RESULT_COOKIE } from "@/lib/live-fixed-sessions";

/**
 * The fixed session (指定場次) the server confirmed for this browser's last
 * registration, for the funnel thank-you page. HttpOnly (no page script,
 * including a merchant's custom JS, can read or plant it), Path=/lp (the only
 * pages that read it), 30 minutes, and HMAC-signed with a derived key bound
 * to the Live so it can neither be forged nor moved to another Live.
 */

const VERSION = "lsr1";
const KEY = DERIVED_KEY_ROTATIONS.liveSessionResult;
export const LIVE_SESSION_RESULT_TTL_SECONDS = 30 * 60;
export const LIVE_SESSION_RESULT_COOKIE_PATH = "/lp";
const MAX_TOKEN_LENGTH = 1_200;
const PAYLOAD = /^[A-Za-z0-9_-]{1,1000}$/u;
const SIGNATURE = /^[A-Za-z0-9_-]{43}$/u;

export type LiveSessionResult = { liveId: string; id: string; startAt: string; label: string };

type Claims = { l: string; i: string; s: string; b: string; e: number };

export function createLiveSessionResultToken(result: LiveSessionResult, now = new Date()) {
  const claims: Claims = {
    l: result.liveId,
    i: result.id,
    s: result.startAt,
    b: result.label,
    e: Math.floor(now.getTime() / 1_000) + LIVE_SESSION_RESULT_TTL_SECONDS,
  };
  const value = `${VERSION}.${Buffer.from(JSON.stringify(claims), "utf8").toString("base64url")}`;
  return `${value}.${signWithRotation(KEY, value)}`;
}

/** The confirmed session for exactly `liveId`, or null for a missing, forged, expired or other-Live cookie. */
export function verifyLiveSessionResultToken(token: string | null | undefined, liveId: string, now = new Date()): LiveSessionResult | null {
  if (typeof token !== "string" || token.length === 0 || token.length > MAX_TOKEN_LENGTH) return null;
  const [version, payload, signature, extra] = token.split(".");
  if (version !== VERSION || !payload || !PAYLOAD.test(payload) || !signature || !SIGNATURE.test(signature) || extra !== undefined) return null;
  if (!verifyWithRotation(KEY, `${VERSION}.${payload}`, signature, now)) return null;
  let claims: unknown;
  try {
    claims = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  } catch {
    return null;
  }
  if (!claims || typeof claims !== "object") return null;
  const value = claims as Partial<Claims>;
  if (typeof value.l !== "string" || typeof value.i !== "string" || typeof value.s !== "string" || typeof value.b !== "string" || typeof value.e !== "number") return null;
  const nowSeconds = Math.floor(now.getTime() / 1_000);
  if (value.e <= nowSeconds || value.e > nowSeconds + LIVE_SESSION_RESULT_TTL_SECONDS) return null;
  if (value.l !== liveId) return null;
  return { liveId: value.l, id: value.i, startAt: value.s, label: value.b };
}

export function liveSessionResultCookieOptions(secure: boolean) {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure,
    path: LIVE_SESSION_RESULT_COOKIE_PATH,
    maxAge: LIVE_SESSION_RESULT_TTL_SECONDS,
  };
}

/** For a Server Component: reads the cookie from `cookies()` and verifies it for this Live. */
export function confirmedLiveSessionFromCookies(
  jar: { get(name: string): { value: string } | undefined },
  liveId: string | null | undefined,
  now = new Date(),
) {
  if (!liveId) return null;
  return verifyLiveSessionResultToken(jar.get(LIVE_SESSION_RESULT_COOKIE)?.value, liveId, now);
}
