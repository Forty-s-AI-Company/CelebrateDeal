import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { getCanonicalAppUrl } from "@/lib/app-url";
import { deriveSensitiveDataKey } from "@/lib/sensitive-data";

/**
 * Signed, single-purpose merchant email verification links.
 *
 * Token: `mev1.<base64url(JSON {purpose, userId, email, exp, jti})>.<HMAC-SHA256>`.
 * The key is derived for this purpose only (`merchant-email-verification-v1`),
 * so it never shares a key with CSRF, MFA, registration invites or any other
 * token. The signature is compared in constant time before the payload is
 * parsed. The payload carries the address the link was sent to: the
 * confirmation updates the user only while its stored email still equals it,
 * so a changed address invalidates every older link.
 *
 * There is no token table. Re-opening a link is harmless (the update is
 * idempotent); `jti` only identifies a link in audit records. The token itself
 * is never stored or logged.
 */
export const MERCHANT_EMAIL_VERIFICATION_PURPOSE = "merchant_email_verification";
export const MERCHANT_EMAIL_VERIFICATION_TTL_HOURS = 24;
export const MERCHANT_EMAIL_VERIFICATION_TTL_MS = MERCHANT_EMAIL_VERIFICATION_TTL_HOURS * 60 * 60 * 1_000;
/** Upper bound for a token read from a URL. */
export const MERCHANT_EMAIL_VERIFICATION_MAX_LENGTH = 1_024;
/** The e-mailed link opens this page, which asks for one click before the POST confirms. */
export const MERCHANT_EMAIL_VERIFICATION_PATH = "/verify-email";

const TOKEN_VERSION = "mev1";
const KEY_PURPOSE = "merchant-email-verification-v1";
const PAYLOAD = /^[A-Za-z0-9_-]{1,900}$/u;
const SIGNATURE = /^[A-Za-z0-9_-]{43}$/u;
const JTI = /^[A-Za-z0-9_-]{16,64}$/u;
const USER_ID = /^[A-Za-z0-9_-]{1,64}$/u;
const MAX_EMAIL_LENGTH = 320;

const VerificationPayload = z.object({
  purpose: z.literal(MERCHANT_EMAIL_VERIFICATION_PURPOSE),
  userId: z.string().regex(USER_ID),
  email: z.string().max(MAX_EMAIL_LENGTH).email(),
  exp: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  jti: z.string().regex(JTI),
}).strict();

export type MerchantEmailVerificationClaim = {
  userId: string;
  email: string;
  expiresAt: Date;
  jti: string;
};

function sign(value: string) {
  return createHmac("sha256", deriveSensitiveDataKey(KEY_PURPOSE)).update(value).digest("base64url");
}

/** Throws when the input is invalid or the signing secret is not configured. */
export function createMerchantEmailVerificationToken(input: { userId: string; email: string; now?: Date; ttlMs?: number }) {
  if (!USER_ID.test(input.userId)) throw new Error("Invalid merchant email verification user.");
  // Account emails are stored trimmed and lowercased; sign exactly what is stored.
  if (!z.string().max(MAX_EMAIL_LENGTH).email().safeParse(input.email).success) {
    throw new Error("Invalid merchant email verification email.");
  }
  const ttlMs = input.ttlMs ?? MERCHANT_EMAIL_VERIFICATION_TTL_MS;
  if (!Number.isFinite(ttlMs) || ttlMs <= 0) throw new Error("Invalid merchant email verification lifetime.");
  const exp = Math.floor(((input.now ?? new Date()).getTime() + ttlMs) / 1_000);
  const jti = randomBytes(18).toString("base64url");
  const payload = { purpose: MERCHANT_EMAIL_VERIFICATION_PURPOSE, userId: input.userId, email: input.email, exp, jti };
  const body = `${TOKEN_VERSION}.${Buffer.from(JSON.stringify(payload), "utf8").toString("base64url")}`;
  return { token: `${body}.${sign(body)}`, expiresAt: new Date(exp * 1_000), jti };
}

/**
 * Returns the claim, or null for anything malformed, tampered, expired,
 * issued for another purpose or unverifiable because the secret is missing.
 * The caller still binds `userId` and `email` in its database update.
 */
export function verifyMerchantEmailVerificationToken(token: unknown, now = new Date()): MerchantEmailVerificationClaim | null {
  if (typeof token !== "string" || token.length === 0 || token.length > MERCHANT_EMAIL_VERIFICATION_MAX_LENGTH) return null;
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [version, payloadPart, suppliedSignature] = parts as [string, string, string];
  if (version !== TOKEN_VERSION || !PAYLOAD.test(payloadPart) || !SIGNATURE.test(suppliedSignature)) return null;

  let expected: Buffer;
  try {
    expected = Buffer.from(sign(`${version}.${payloadPart}`), "utf8");
  } catch {
    return null;
  }
  const supplied = Buffer.from(suppliedSignature, "utf8");
  if (expected.length !== supplied.length || !timingSafeEqual(expected, supplied)) return null;

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
  return { userId: parsed.data.userId, email: parsed.data.email, expiresAt, jti: parsed.data.jti };
}

export function merchantEmailVerificationUrl(token: string, env: NodeJS.ProcessEnv = process.env) {
  const url = new URL(MERCHANT_EMAIL_VERIFICATION_PATH, getCanonicalAppUrl(env));
  url.searchParams.set("token", token);
  return url.toString();
}
