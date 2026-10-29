import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { getCanonicalAppUrl } from "@/lib/app-url";
import { DERIVED_KEY_ROTATIONS } from "@/lib/derived-key-purposes";
import { deriveSensitiveDataKey } from "@/lib/sensitive-data";

/**
 * Signed, single-purpose links that complete a login email change. The link
 * is e-mailed to the NEW address only.
 *
 * Token: `aec1.<base64url(JSON {purpose, userId, exp, jti})>.<MAC>` where
 * MAC = HMAC-SHA256(derived key, "aec1-mac:" + body + "\0" + newEmail), the
 * same shape as merchant email verification links (`mev1`). The new address
 * is bound by the MAC but never written into the token, so a leaked link does
 * not reveal it; verification recomputes the MAC with the address stored on
 * the pending `UserEmailChangeRequest`.
 *
 * Unlike `mev1` links these are also stored: the request row keeps the
 * SHA-256 of the whole token (`accountEmailChangeTokenHash`), which makes a
 * link single-use, lets a newer request or a password change revoke it, and
 * is the only way to find the request. The token itself is never stored or
 * logged; audit rows carry `jti` only.
 *
 * The key purpose carries a random suffix (see `derived-key-purposes.ts`)
 * and is registered in `DERIVED_KEY_ROTATIONS.accountEmailChange` with no
 * legacy purpose: nothing was ever signed under an older label.
 */
export const ACCOUNT_EMAIL_CHANGE_PURPOSE = "account_email_change";
export const ACCOUNT_EMAIL_CHANGE_KEY_PURPOSE = DERIVED_KEY_ROTATIONS.accountEmailChange.current;
export const ACCOUNT_EMAIL_CHANGE_TTL_MINUTES = 60;
export const ACCOUNT_EMAIL_CHANGE_TTL_MS = ACCOUNT_EMAIL_CHANGE_TTL_MINUTES * 60 * 1_000;
/** Upper bound for a token read from a URL or a form. */
export const ACCOUNT_EMAIL_CHANGE_MAX_LENGTH = 1_024;
/** The e-mailed link opens this page, which asks for one click before the POST completes the change. */
export const ACCOUNT_EMAIL_CHANGE_PATH = "/verify-email-change";
/** Same bound as registration and the `User.email` CHECK on the request table. */
export const LOGIN_EMAIL_MAX_LENGTH = 320;

const TOKEN_VERSION = "aec1";
const MAC_LABEL = "aec1-mac:";
const PAYLOAD = /^[A-Za-z0-9_-]{1,600}$/u;
const SIGNATURE = /^[A-Za-z0-9_-]{43}$/u;
const JTI = /^[A-Za-z0-9_-]{16,64}$/u;
const USER_ID = /^[A-Za-z0-9_-]{1,64}$/u;

/** Exactly the registration rule (`registration-actions.ts`): trimmed, lowercased, an address, at most 320 characters. */
const LoginEmail = z.string().trim().toLowerCase().email().max(LOGIN_EMAIL_MAX_LENGTH);

/** The normalized address, or null when the input is not a valid login email. */
export function normalizeLoginEmail(value: unknown): string | null {
  const parsed = LoginEmail.safeParse(value);
  return parsed.success ? parsed.data : null;
}

const ChangePayload = z.object({
  purpose: z.literal(ACCOUNT_EMAIL_CHANGE_PURPOSE),
  userId: z.string().regex(USER_ID),
  exp: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  jti: z.string().regex(JTI),
}).strict();

/** Structurally valid, unexpired link. Not yet authenticated: the MAC needs the stored new address. */
export type AccountEmailChangeCandidate = {
  userId: string;
  expiresAt: Date;
  jti: string;
};

type ParsedToken = AccountEmailChangeCandidate & { body: string; signature: string };

function mac(body: string, newEmail: string) {
  return createHmac("sha256", deriveSensitiveDataKey(ACCOUNT_EMAIL_CHANGE_KEY_PURPOSE))
    .update(MAC_LABEL)
    .update(body)
    .update("\u0000")
    .update(newEmail)
    .digest("base64url");
}

/** SHA-256 (hex) of the whole token: what `UserEmailChangeRequest.tokenHash` stores. */
export function accountEmailChangeTokenHash(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

/** Throws when the input is invalid or the signing secret is not configured. */
export function createAccountEmailChangeToken(input: { userId: string; newEmail: string; now?: Date; ttlMs?: number }) {
  if (!USER_ID.test(input.userId)) throw new Error("Invalid account email change user.");
  // Bind exactly what will be stored: the normalized address.
  if (normalizeLoginEmail(input.newEmail) !== input.newEmail) throw new Error("Invalid account email change address.");
  const ttlMs = input.ttlMs ?? ACCOUNT_EMAIL_CHANGE_TTL_MS;
  if (!Number.isFinite(ttlMs) || ttlMs <= 0) throw new Error("Invalid account email change lifetime.");
  const exp = Math.floor(((input.now ?? new Date()).getTime() + ttlMs) / 1_000);
  const jti = randomBytes(18).toString("base64url");
  const payload = { purpose: ACCOUNT_EMAIL_CHANGE_PURPOSE, userId: input.userId, exp, jti };
  const body = `${TOKEN_VERSION}.${Buffer.from(JSON.stringify(payload), "utf8").toString("base64url")}`;
  const token = `${body}.${mac(body, input.newEmail)}`;
  return { token, tokenHash: accountEmailChangeTokenHash(token), expiresAt: new Date(exp * 1_000), jti };
}

function parseToken(token: unknown, now: Date): ParsedToken | null {
  if (typeof token !== "string" || token.length === 0 || token.length > ACCOUNT_EMAIL_CHANGE_MAX_LENGTH) return null;
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
  const parsed = ChangePayload.safeParse(decoded);
  if (!parsed.success) return null;
  const expiresAt = new Date(parsed.data.exp * 1_000);
  if (Number.isNaN(expiresAt.getTime()) || expiresAt <= now) return null;
  return { userId: parsed.data.userId, expiresAt, jti: parsed.data.jti, body: `${version}.${payloadPart}`, signature };
}

/**
 * Bounded, strict parse of the payload and expiry only. Lets the confirm page
 * decide whether to show the button and the confirmation skip the database
 * for garbage. Never sufficient on its own.
 */
export function readAccountEmailChangeToken(token: unknown, now = new Date()): AccountEmailChangeCandidate | null {
  const parsed = parseToken(token, now);
  return parsed ? { userId: parsed.userId, expiresAt: parsed.expiresAt, jti: parsed.jti } : null;
}

/**
 * Authenticates the link against `newEmail`, the address stored on the
 * pending request the token's hash found. Null for anything malformed,
 * tampered, expired, issued for another purpose or address, or unverifiable
 * because the secret is missing.
 */
export function verifyAccountEmailChangeToken(token: unknown, newEmail: string, now = new Date()): AccountEmailChangeCandidate | null {
  const parsed = parseToken(token, now);
  if (!parsed) return null;
  let expected: Buffer;
  try {
    expected = Buffer.from(mac(parsed.body, newEmail), "utf8");
  } catch {
    return null;
  }
  const supplied = Buffer.from(parsed.signature, "utf8");
  if (expected.length !== supplied.length || !timingSafeEqual(expected, supplied)) return null;
  return { userId: parsed.userId, expiresAt: parsed.expiresAt, jti: parsed.jti };
}

export function accountEmailChangeUrl(token: string, env: NodeJS.ProcessEnv = process.env) {
  const url = new URL(ACCOUNT_EMAIL_CHANGE_PATH, getCanonicalAppUrl(env));
  url.searchParams.set("token", token);
  return url.toString();
}
