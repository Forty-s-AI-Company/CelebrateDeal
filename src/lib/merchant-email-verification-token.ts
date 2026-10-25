import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { getCanonicalAppUrl } from "@/lib/app-url";
import { DERIVED_KEY_ROTATIONS } from "@/lib/derived-key-purposes";
import { deriveSensitiveDataKey } from "@/lib/sensitive-data";

/**
 * Signed, single-purpose merchant email verification links.
 *
 * Token: `mev1.<base64url(JSON {purpose, userId, exp, jti})>.<MAC>` where
 * MAC = HMAC-SHA256(derived key, "mev1-mac:" + body + "\0" + email). The
 * address the link was sent to is bound by the MAC but never written into the
 * token, so a leaked link (logs, referrers, a forwarded mail) does not reveal
 * it. Verification therefore needs the account's current stored address: the
 * confirmation loads the user named by `userId`, recomputes the MAC with the
 * stored email and compares in constant time. A changed address invalidates
 * every older link.
 *
 * The key is derived for this purpose only. The purpose carries a random
 * suffix (repository is public): before the CSRF key-separation fix (#485)
 * the CSRF fingerprint oracle could derive a key for any guessable purpose
 * string, so a fresh, unguessable label keeps this key out of reach of
 * anything learned from a pre-#485 deployment. Invariant: never ship a new
 * purpose while any public deployment still runs pre-#485 code.
 *
 * The purpose is registered in `DERIVED_KEY_ROTATIONS`
 * (`src/lib/derived-key-purposes.ts`) with no legacy purpose: nothing was ever
 * signed under an older label.
 *
 * There is no token table. Re-opening a link is harmless (the update is
 * idempotent); `jti` only identifies a link in audit records. The token itself
 * is never stored or logged.
 */
export const MERCHANT_EMAIL_VERIFICATION_PURPOSE = "merchant_email_verification";
export const MERCHANT_EMAIL_VERIFICATION_KEY_PURPOSE = DERIVED_KEY_ROTATIONS.merchantEmailVerification.current;
export const MERCHANT_EMAIL_VERIFICATION_TTL_HOURS = 24;
export const MERCHANT_EMAIL_VERIFICATION_TTL_MS = MERCHANT_EMAIL_VERIFICATION_TTL_HOURS * 60 * 60 * 1_000;
/** Upper bound for a token read from a URL. */
export const MERCHANT_EMAIL_VERIFICATION_MAX_LENGTH = 1_024;
/** The e-mailed link opens this page, which asks for one click before the POST confirms. */
export const MERCHANT_EMAIL_VERIFICATION_PATH = "/verify-email";

const TOKEN_VERSION = "mev1";
const MAC_LABEL = "mev1-mac:";
const PAYLOAD = /^[A-Za-z0-9_-]{1,600}$/u;
const SIGNATURE = /^[A-Za-z0-9_-]{43}$/u;
const JTI = /^[A-Za-z0-9_-]{16,64}$/u;
const USER_ID = /^[A-Za-z0-9_-]{1,64}$/u;
const MAX_EMAIL_LENGTH = 320;

const VerificationPayload = z.object({
  purpose: z.literal(MERCHANT_EMAIL_VERIFICATION_PURPOSE),
  userId: z.string().regex(USER_ID),
  exp: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  jti: z.string().regex(JTI),
}).strict();

/** Structurally valid, unexpired link. Not yet authenticated: the MAC needs the stored email. */
export type MerchantEmailVerificationCandidate = {
  userId: string;
  expiresAt: Date;
  jti: string;
};

type ParsedToken = MerchantEmailVerificationCandidate & { body: string; signature: string };

function mac(body: string, email: string) {
  return createHmac("sha256", deriveSensitiveDataKey(MERCHANT_EMAIL_VERIFICATION_KEY_PURPOSE))
    .update(MAC_LABEL)
    .update(body)
    .update("\u0000")
    .update(email)
    .digest("base64url");
}

/** Throws when the input is invalid or the signing secret is not configured. */
export function createMerchantEmailVerificationToken(input: { userId: string; email: string; now?: Date; ttlMs?: number }) {
  if (!USER_ID.test(input.userId)) throw new Error("Invalid merchant email verification user.");
  // Account emails are stored trimmed and lowercased; bind exactly what is stored.
  if (!z.string().max(MAX_EMAIL_LENGTH).email().safeParse(input.email).success) {
    throw new Error("Invalid merchant email verification email.");
  }
  const ttlMs = input.ttlMs ?? MERCHANT_EMAIL_VERIFICATION_TTL_MS;
  if (!Number.isFinite(ttlMs) || ttlMs <= 0) throw new Error("Invalid merchant email verification lifetime.");
  const exp = Math.floor(((input.now ?? new Date()).getTime() + ttlMs) / 1_000);
  const jti = randomBytes(18).toString("base64url");
  const payload = { purpose: MERCHANT_EMAIL_VERIFICATION_PURPOSE, userId: input.userId, exp, jti };
  const body = `${TOKEN_VERSION}.${Buffer.from(JSON.stringify(payload), "utf8").toString("base64url")}`;
  return { token: `${body}.${mac(body, input.email)}`, expiresAt: new Date(exp * 1_000), jti };
}

function parseToken(token: unknown, now: Date): ParsedToken | null {
  if (typeof token !== "string" || token.length === 0 || token.length > MERCHANT_EMAIL_VERIFICATION_MAX_LENGTH) return null;
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [version, payloadPart, signature] = parts as [string, string, string];
  if (version !== TOKEN_VERSION || !PAYLOAD.test(payloadPart) || !SIGNATURE.test(signature)) return null;
  let decoded: unknown;
  try {
    decoded = JSON.parse(Buffer.from(payloadPart, "base64url").toString("utf8"));
  } catch {
    return null;
  }
  const parsed = VerificationPayload.safeParse(decoded);
  if (!parsed.success) return null;
  const expiresAt = new Date(parsed.data.exp * 1_000);
  if (Number.isNaN(expiresAt.getTime()) || expiresAt <= now) return null;
  return { userId: parsed.data.userId, expiresAt, jti: parsed.data.jti, body: `${version}.${payloadPart}`, signature };
}

/**
 * Bounded, strict parse of the payload and expiry only. Used to pick the user
 * whose stored email completes the MAC check, and by the confirm page to
 * decide whether to show the button. Never sufficient on its own.
 */
export function readMerchantEmailVerificationToken(token: unknown, now = new Date()): MerchantEmailVerificationCandidate | null {
  const parsed = parseToken(token, now);
  return parsed ? { userId: parsed.userId, expiresAt: parsed.expiresAt, jti: parsed.jti } : null;
}

/**
 * Authenticates the link against `email`, the current stored address of the
 * user the token names. Null for anything malformed, tampered, expired,
 * issued for another purpose or address, or unverifiable because the secret
 * is missing.
 */
export function verifyMerchantEmailVerificationToken(token: unknown, email: string, now = new Date()): MerchantEmailVerificationCandidate | null {
  const parsed = parseToken(token, now);
  if (!parsed) return null;
  let expected: Buffer;
  try {
    expected = Buffer.from(mac(parsed.body, email), "utf8");
  } catch {
    return null;
  }
  const supplied = Buffer.from(parsed.signature, "utf8");
  if (expected.length !== supplied.length || !timingSafeEqual(expected, supplied)) return null;
  return { userId: parsed.userId, expiresAt: parsed.expiresAt, jti: parsed.jti };
}

export function merchantEmailVerificationUrl(token: string, env: NodeJS.ProcessEnv = process.env) {
  const url = new URL(MERCHANT_EMAIL_VERIFICATION_PATH, getCanonicalAppUrl(env));
  url.searchParams.set("token", token);
  return url.toString();
}
