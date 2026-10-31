import { createHash, randomBytes } from "node:crypto";
import { DERIVED_KEY_ROTATIONS, signWithRotation, verifyWithRotation } from "@/lib/derived-key-rotation";

/**
 * The 「更換場次」 link in the already-registered notice (指定場次): lets the
 * registrant switch their session from a device without the registration
 * cookie. HMAC-signed with its own derived key and bound to the vendor, the
 * registration and the session it held when the notice was written; it lives
 * 24 hours and is single use (LiveSessionSwitchRedemption, keyed by
 * redemptionIdFor(nonce)). Redeeming it is a POST from the confirmation page
 * (src/lib/live-session-switch.ts), so a mail scanner's GET changes nothing.
 *
 * This file is pure (no DB) so the email writer and the GET page can use it.
 */

const VERSION = "lsw1";
const KEY = DERIVED_KEY_ROTATIONS.liveSessionSwitch;
export const LIVE_SESSION_SWITCH_TTL_SECONDS = 24 * 60 * 60;
export const LIVE_SESSION_SWITCH_MAX_TOKEN_LENGTH = 800;
const PAYLOAD = /^[A-Za-z0-9_-]{1,720}$/u;
const SIGNATURE = /^[A-Za-z0-9_-]{43}$/u;
const ID = /^[A-Za-z0-9_-]{1,128}$/u;
const NONCE = /^[A-Za-z0-9_-]{22}$/u;

export type LiveSessionSwitchClaim = {
  vendorId: string;
  submissionId: string;
  sessionId: string;
  nonce: string;
  expiresAt: Date;
};

type Claims = { v: string; s: string; l: string; n: string; e: number };

export function createLiveSessionSwitchToken(
  input: { vendorId: string; submissionId: string; sessionId: string },
  now = new Date(),
) {
  if (!ID.test(input.vendorId) || !ID.test(input.submissionId) || !ID.test(input.sessionId)) {
    throw new Error("Invalid session switch binding.");
  }
  const claims: Claims = {
    v: input.vendorId,
    s: input.submissionId,
    l: input.sessionId,
    n: randomBytes(16).toString("base64url"),
    e: Math.floor(now.getTime() / 1_000) + LIVE_SESSION_SWITCH_TTL_SECONDS,
  };
  const value = `${VERSION}.${Buffer.from(JSON.stringify(claims), "utf8").toString("base64url")}`;
  return `${value}.${signWithRotation(KEY, value)}`;
}

/** The claim of a genuine, unexpired link, or null. Says nothing about whether it was already used. */
export function verifyLiveSessionSwitchToken(token: string | null | undefined, now = new Date()): LiveSessionSwitchClaim | null {
  if (typeof token !== "string" || token.length === 0 || token.length > LIVE_SESSION_SWITCH_MAX_TOKEN_LENGTH) return null;
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
    || typeof claims.s !== "string" || !ID.test(claims.s)
    || typeof claims.l !== "string" || !ID.test(claims.l)
    || typeof claims.n !== "string" || !NONCE.test(claims.n)
    || typeof claims.e !== "number" || !Number.isSafeInteger(claims.e)
  ) return null;
  const nowSeconds = Math.floor(now.getTime() / 1_000);
  if (claims.e <= nowSeconds || claims.e > nowSeconds + LIVE_SESSION_SWITCH_TTL_SECONDS) return null;
  return { vendorId: claims.v, submissionId: claims.s, sessionId: claims.l, nonce: claims.n, expiresAt: new Date(claims.e * 1_000) };
}

/** Primary key of the redemption row: the nonce itself never reaches the database. */
export function liveSessionSwitchRedemptionId(nonce: string) {
  return createHash("sha256").update(`${VERSION}:${nonce}`, "utf8").digest("hex");
}

/** The confirmation page for a link; the token is only ever redeemed by its POST button. */
export function createLiveSessionSwitchUrl(token: string, env: NodeJS.ProcessEnv = process.env) {
  const configured = env.NEXT_PUBLIC_APP_URL?.trim();
  if (!configured) throw new Error("Public application URL is not configured.");
  const url = new URL("/live-session-switch", configured);
  if (!new Set(["https:", "http:"]).has(url.protocol)) throw new Error("Public application URL is invalid.");
  url.searchParams.set("token", token);
  return url.toString();
}
