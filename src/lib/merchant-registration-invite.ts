import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { getCanonicalAppUrl } from "@/lib/app-url";
import { deriveSensitiveDataKey } from "@/lib/sensitive-data";

/**
 * Signed, email-bound merchant registration invitations (closed beta).
 *
 * There is no invitation table: a platform admin generates a link and sends it
 * by hand. The token is `mri1.<base64url(JSON payload)>.<HMAC-SHA256>`, signed
 * with a key derived for this purpose only from the deployment secret
 * (`deriveSensitiveDataKey`, CSRF_SECRET or JOB_SECRET), so it never shares a
 * key with CSRF, MFA or other tokens. The signature is checked in constant
 * time before the payload is parsed.
 *
 * A token is not single-use; the account's unique email makes it usable for
 * one account only. Anyone holding the link can register that email, so it is
 * sent only to the invited person.
 */
export const MERCHANT_REGISTRATION_INVITE_PURPOSE = "merchant_registration";
export const MERCHANT_REGISTRATION_INVITE_TTL_DAYS = 14;
export const MERCHANT_REGISTRATION_INVITE_TTL_MS = MERCHANT_REGISTRATION_INVITE_TTL_DAYS * 24 * 60 * 60 * 1_000;
/** Upper bound for a token read from a URL or form field. */
export const MERCHANT_REGISTRATION_INVITE_MAX_LENGTH = 1_024;

const TOKEN_VERSION = "mri1";
const KEY_PURPOSE = "merchant-registration-invite";
const PAYLOAD = /^[A-Za-z0-9_-]{1,900}$/u;
const SIGNATURE = /^[A-Za-z0-9_-]{43}$/u;
const JTI = /^[A-Za-z0-9_-]{16,64}$/u;
const MAX_EMAIL_LENGTH = 320;

/** Same normalisation as the registration form (trim, then lowercase). */
export function normalizeMerchantRegistrationEmail(value: string) {
  return value.trim().toLowerCase();
}

const InvitePayload = z.object({
  purpose: z.literal(MERCHANT_REGISTRATION_INVITE_PURPOSE),
  email: z.string().max(MAX_EMAIL_LENGTH).email(),
  exp: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  jti: z.string().regex(JTI),
}).strict();

export type MerchantRegistrationInvite = {
  email: string;
  expiresAt: Date;
  jti: string;
};

function sign(value: string) {
  return createHmac("sha256", deriveSensitiveDataKey(KEY_PURPOSE)).update(value).digest("base64url");
}

/** Throws when the email is invalid or the signing secret is not configured. */
export function createMerchantRegistrationInvite(input: { email: string; now?: Date; ttlMs?: number }) {
  const email = normalizeMerchantRegistrationEmail(input.email);
  if (!z.string().max(MAX_EMAIL_LENGTH).email().safeParse(email).success) {
    throw new Error("Invalid merchant registration invite email.");
  }
  const ttlMs = input.ttlMs ?? MERCHANT_REGISTRATION_INVITE_TTL_MS;
  if (!Number.isFinite(ttlMs) || ttlMs <= 0) throw new Error("Invalid merchant registration invite lifetime.");
  const exp = Math.floor(((input.now ?? new Date()).getTime() + ttlMs) / 1_000);
  const jti = randomBytes(18).toString("base64url");
  const payload = { purpose: MERCHANT_REGISTRATION_INVITE_PURPOSE, email, exp, jti };
  const body = `${TOKEN_VERSION}.${Buffer.from(JSON.stringify(payload), "utf8").toString("base64url")}`;
  return { token: `${body}.${sign(body)}`, email, expiresAt: new Date(exp * 1_000), jti };
}

/**
 * Returns the invitation, or null for anything malformed, tampered, expired,
 * issued for another purpose or unverifiable because the secret is missing.
 */
export function verifyMerchantRegistrationInvite(token: unknown, now = new Date()): MerchantRegistrationInvite | null {
  if (typeof token !== "string" || token.length === 0 || token.length > MERCHANT_REGISTRATION_INVITE_MAX_LENGTH) return null;
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
  const parsed = InvitePayload.safeParse(decoded);
  if (!parsed.success) return null;
  // Only normalised addresses are ever signed; anything else is not ours.
  if (parsed.data.email !== normalizeMerchantRegistrationEmail(parsed.data.email)) return null;
  const expiresAt = new Date(parsed.data.exp * 1_000);
  if (Number.isNaN(expiresAt.getTime()) || expiresAt <= now) return null;
  return { email: parsed.data.email, expiresAt, jti: parsed.data.jti };
}

/** True when the submitted address is the invited one after normalisation. */
export function merchantRegistrationInviteMatchesEmail(invite: Pick<MerchantRegistrationInvite, "email">, email: string) {
  return normalizeMerchantRegistrationEmail(email) === invite.email;
}

export function merchantRegistrationInviteUrl(token: string, env: NodeJS.ProcessEnv = process.env) {
  const url = new URL("/register", getCanonicalAppUrl(env));
  url.searchParams.set("invite", token);
  return url.toString();
}
