import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { getCanonicalAppUrl } from "@/lib/app-url";
import { DERIVED_KEY_ROTATIONS } from "@/lib/derived-key-purposes";
import { deriveSensitiveDataKey } from "@/lib/sensitive-data";

/**
 * Signed, single-purpose links of the login email change.
 *
 * - Change link (`aec1`), e-mailed to the NEW address: completes the change.
 * - Revert link (`aer1`), e-mailed to the PREVIOUS address in the security
 *   notice: "不是我操作，還原 Email". Before the change completes it cancels
 *   the pending change; afterwards it restores the previous address.
 *
 * Token: `<version>.<base64url(JSON {purpose, userId, exp, jti})>.<MAC>` where
 * MAC = HMAC-SHA256(derived key, "<version>-mac:" + body + "\0" + address),
 * the same shape as merchant email verification links (`mev1`). The address
 * the link was sent to is bound by the MAC but never written into the token,
 * so a leaked link does not reveal it; verification recomputes the MAC with
 * the address stored on the `UserEmailChangeRequest` row.
 *
 * Unlike `mev1` links these are also stored: the request row keeps the
 * SHA-256 of each whole token (`accountEmailChangeTokenHash`), which makes a
 * link single-use, revocable, and the only way to find its row. Tokens are
 * never stored or logged; audit rows carry `jti` only.
 *
 * Each kind has its own key purpose with a random suffix (see
 * `derived-key-purposes.ts`), registered without a legacy purpose.
 */

type LinkKind = {
  version: string;
  purpose: string;
  /** Derives this kind's key; a literal call per kind keeps the purpose visible to the registry scan. */
  key: () => Buffer;
};

export const ACCOUNT_EMAIL_CHANGE_PURPOSE = "account_email_change";
export const ACCOUNT_EMAIL_CHANGE_KEY_PURPOSE = DERIVED_KEY_ROTATIONS.accountEmailChange.current;
export const ACCOUNT_EMAIL_CHANGE_TTL_MINUTES = 60;
export const ACCOUNT_EMAIL_CHANGE_TTL_MS = ACCOUNT_EMAIL_CHANGE_TTL_MINUTES * 60 * 1_000;
/** The change link opens this page, which asks for one click before the POST completes the change. */
export const ACCOUNT_EMAIL_CHANGE_PATH = "/verify-email-change";

export const ACCOUNT_EMAIL_REVERT_PURPOSE = "account_email_revert";
export const ACCOUNT_EMAIL_REVERT_KEY_PURPOSE = DERIVED_KEY_ROTATIONS.accountEmailRevert.current;
/** How long after a completed change the previous address can restore itself. */
export const ACCOUNT_EMAIL_REVERT_TTL_DAYS = 7;
export const ACCOUNT_EMAIL_REVERT_TTL_MS = ACCOUNT_EMAIL_REVERT_TTL_DAYS * 24 * 60 * 60 * 1_000;
/** The revert link opens this page, which asks for one click before the POST acts. */
export const ACCOUNT_EMAIL_REVERT_PATH = "/revert-email-change";

/** Upper bound for a token read from a URL or a form. */
export const ACCOUNT_EMAIL_CHANGE_MAX_LENGTH = 1_024;
/** Same bound as registration and the CHECK constraints on the request table. */
export const LOGIN_EMAIL_MAX_LENGTH = 320;

const CHANGE_LINK: LinkKind = { version: "aec1", purpose: ACCOUNT_EMAIL_CHANGE_PURPOSE, key: () => deriveSensitiveDataKey(ACCOUNT_EMAIL_CHANGE_KEY_PURPOSE) };
const REVERT_LINK: LinkKind = { version: "aer1", purpose: ACCOUNT_EMAIL_REVERT_PURPOSE, key: () => deriveSensitiveDataKey(ACCOUNT_EMAIL_REVERT_KEY_PURPOSE) };

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

function payloadSchema(kind: LinkKind) {
  return z.object({
    purpose: z.literal(kind.purpose),
    userId: z.string().regex(USER_ID),
    exp: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
    jti: z.string().regex(JTI),
  }).strict();
}

/** Structurally valid, unexpired link. Not yet authenticated: the MAC needs the stored address. */
export type AccountEmailLinkCandidate = {
  userId: string;
  expiresAt: Date;
  jti: string;
};
export type AccountEmailChangeCandidate = AccountEmailLinkCandidate;

type ParsedToken = AccountEmailLinkCandidate & { body: string; signature: string };

function mac(kind: LinkKind, body: string, email: string) {
  return createHmac("sha256", kind.key())
    .update(`${kind.version}-mac:`)
    .update(body)
    .update("\u0000")
    .update(email)
    .digest("base64url");
}

/** SHA-256 (hex) of the whole token: what the request row stores for either link. */
export function accountEmailChangeTokenHash(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

function createLink(kind: LinkKind, input: { userId: string; email: string; now?: Date; ttlMs: number }) {
  if (!USER_ID.test(input.userId)) throw new Error("Invalid account email link user.");
  // Bind exactly what is stored: the normalized address.
  if (normalizeLoginEmail(input.email) !== input.email) throw new Error("Invalid account email link address.");
  if (!Number.isFinite(input.ttlMs) || input.ttlMs <= 0) throw new Error("Invalid account email link lifetime.");
  const exp = Math.floor(((input.now ?? new Date()).getTime() + input.ttlMs) / 1_000);
  const jti = randomBytes(18).toString("base64url");
  const payload = { purpose: kind.purpose, userId: input.userId, exp, jti };
  const body = `${kind.version}.${Buffer.from(JSON.stringify(payload), "utf8").toString("base64url")}`;
  const token = `${body}.${mac(kind, body, input.email)}`;
  return { token, tokenHash: accountEmailChangeTokenHash(token), expiresAt: new Date(exp * 1_000), jti };
}

function parseLink(kind: LinkKind, token: unknown, now: Date): ParsedToken | null {
  if (typeof token !== "string" || token.length === 0 || token.length > ACCOUNT_EMAIL_CHANGE_MAX_LENGTH) return null;
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [version, payloadPart, signature] = parts as [string, string, string];
  if (version !== kind.version || !PAYLOAD.test(payloadPart) || !SIGNATURE.test(signature)) return null;
  let decoded: unknown;
  try {
    decoded = JSON.parse(Buffer.from(payloadPart, "base64url").toString("utf8"));
  } catch {
    return null;
  }
  const parsed = payloadSchema(kind).safeParse(decoded);
  if (!parsed.success) return null;
  const expiresAt = new Date(parsed.data.exp * 1_000);
  if (Number.isNaN(expiresAt.getTime()) || expiresAt <= now) return null;
  return { userId: parsed.data.userId, expiresAt, jti: parsed.data.jti, body: `${version}.${payloadPart}`, signature };
}

function readLink(kind: LinkKind, token: unknown, now: Date): AccountEmailLinkCandidate | null {
  const parsed = parseLink(kind, token, now);
  return parsed ? { userId: parsed.userId, expiresAt: parsed.expiresAt, jti: parsed.jti } : null;
}

function verifyLink(kind: LinkKind, token: unknown, email: string, now: Date): AccountEmailLinkCandidate | null {
  const parsed = parseLink(kind, token, now);
  if (!parsed) return null;
  let expected: Buffer;
  try {
    expected = Buffer.from(mac(kind, parsed.body, email), "utf8");
  } catch {
    return null;
  }
  const supplied = Buffer.from(parsed.signature, "utf8");
  if (expected.length !== supplied.length || !timingSafeEqual(expected, supplied)) return null;
  return { userId: parsed.userId, expiresAt: parsed.expiresAt, jti: parsed.jti };
}

function linkUrl(path: string, token: string, env: NodeJS.ProcessEnv) {
  const url = new URL(path, getCanonicalAppUrl(env));
  url.searchParams.set("token", token);
  return url.toString();
}

/** Throws when the input is invalid or the signing secret is not configured. */
export function createAccountEmailChangeToken(input: { userId: string; newEmail: string; now?: Date; ttlMs?: number }) {
  return createLink(CHANGE_LINK, { userId: input.userId, email: input.newEmail, now: input.now, ttlMs: input.ttlMs ?? ACCOUNT_EMAIL_CHANGE_TTL_MS });
}

/**
 * Bounded, strict parse of the payload and expiry only. Lets the pages decide
 * whether to show the button and the confirmation skip the database for
 * garbage. Never sufficient on its own.
 */
export function readAccountEmailChangeToken(token: unknown, now = new Date()) {
  return readLink(CHANGE_LINK, token, now);
}

/**
 * Authenticates a change link against `newEmail`, the address stored on the
 * request its hash found. Null for anything malformed, tampered, expired,
 * issued for another purpose or address, or unverifiable because the secret
 * is missing.
 */
export function verifyAccountEmailChangeToken(token: unknown, newEmail: string, now = new Date()) {
  return verifyLink(CHANGE_LINK, token, newEmail, now);
}

export function accountEmailChangeUrl(token: string, env: NodeJS.ProcessEnv = process.env) {
  return linkUrl(ACCOUNT_EMAIL_CHANGE_PATH, token, env);
}

/**
 * Revert link for the previous address. Its signed lifetime covers the
 * request window plus the revert window; the row's `revertExpiresAt` is what
 * actually decides (the request expiry until the change completes, then
 * seven days from completion).
 */
export function createAccountEmailRevertToken(input: { userId: string; previousEmail: string; now?: Date; ttlMs?: number }) {
  return createLink(REVERT_LINK, {
    userId: input.userId,
    email: input.previousEmail,
    now: input.now,
    ttlMs: input.ttlMs ?? ACCOUNT_EMAIL_CHANGE_TTL_MS + ACCOUNT_EMAIL_REVERT_TTL_MS,
  });
}

export function readAccountEmailRevertToken(token: unknown, now = new Date()) {
  return readLink(REVERT_LINK, token, now);
}

/** Authenticates a revert link against `previousEmail`, the address stored on its request row. */
export function verifyAccountEmailRevertToken(token: unknown, previousEmail: string, now = new Date()) {
  return verifyLink(REVERT_LINK, token, previousEmail, now);
}

export function accountEmailRevertUrl(token: string, env: NodeJS.ProcessEnv = process.env) {
  return linkUrl(ACCOUNT_EMAIL_REVERT_PATH, token, env);
}
