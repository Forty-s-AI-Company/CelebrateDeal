import { createHash } from "node:crypto";
import { DERIVED_KEY_ROTATIONS, expiryFitsPreRotationIssue, signWithRotation, verifyWithRotation } from "@/lib/derived-key-rotation";
import { SERVER_CLOCK_SKEW_SECONDS } from "@/lib/server-clock-skew";

export const FORM_SUBMISSION_CHAT_SESSION_COOKIE = "celebratedeal_form_submission_chat_session";
export const FORM_SUBMISSION_CHAT_SESSION_TTL_SECONDS = 30 * 24 * 60 * 60;

const TOKEN_VERSION = "fss1";
// Rotated after #485 (tier 3): the cookie lives 30 days, so the legacy key
// still verifies until its hard stop in derived-key-purposes.ts.
const TOKEN_KEY = DERIVED_KEY_ROTATIONS.formSubmissionChatSession;
const MAX_TOKEN_LENGTH = 320;
const SUBMISSION_ID = /^[A-Za-z0-9_-]{1,128}$/u;
const EXPIRY_SECONDS = /^\d{1,12}$/u;
const TOKEN_SIGNATURE = /^[A-Za-z0-9_-]{43}$/u;

export type FormSubmissionChatSessionClaim = {
  submissionId: string;
  expiresAt: Date;
};

export type FormSubmissionChatSessionCookieOptions = {
  httpOnly: true;
  sameSite: "lax";
  secure: boolean;
  path: "/";
  maxAge: number;
};

function nowSeconds(now: Date) {
  const value = Math.floor(now.getTime() / 1_000);
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error("Invalid chat session clock.");
  }
  return value;
}

function signedValue(submissionId: string, expiresAtSeconds: number) {
  if (!SUBMISSION_ID.test(submissionId) || !Number.isSafeInteger(expiresAtSeconds) || expiresAtSeconds <= 0) {
    throw new Error("Invalid chat session binding.");
  }
  return `${TOKEN_VERSION}.${submissionId}.${expiresAtSeconds}`;
}

export function createFormSubmissionChatSessionToken(input: {
  submissionId: string;
  now?: Date;
}) {
  const current = input.now ?? new Date();
  const expiresAtSeconds = nowSeconds(current) + FORM_SUBMISSION_CHAT_SESSION_TTL_SECONDS;
  const value = signedValue(input.submissionId, expiresAtSeconds);
  return `${value}.${signWithRotation(TOKEN_KEY, value)}`;
}

export function verifyFormSubmissionChatSessionToken(
  token: string,
  now = new Date(),
): FormSubmissionChatSessionClaim | null {
  if (typeof token !== "string" || token.length === 0 || token.length > MAX_TOKEN_LENGTH) return null;

  const [tokenVersion, submissionId, expiresAtRaw, suppliedSignature, extra] = token.split(".");
  if (
    tokenVersion !== TOKEN_VERSION
    || !submissionId
    || !SUBMISSION_ID.test(submissionId)
    || !expiresAtRaw
    || !EXPIRY_SECONDS.test(expiresAtRaw)
    || !suppliedSignature
    || !TOKEN_SIGNATURE.test(suppliedSignature)
    || extra !== undefined
  ) return null;

  const expiresAtSeconds = Number(expiresAtRaw);
  const currentSeconds = nowSeconds(now);
  // expiresAt - TTL is the issue time: tolerate SERVER_CLOCK_SKEW_SECONDS of
  // "issued in the future" between instances, never a later expiry.
  if (
    !Number.isSafeInteger(expiresAtSeconds)
    || expiresAtSeconds <= currentSeconds
    || expiresAtSeconds > currentSeconds + FORM_SUBMISSION_CHAT_SESSION_TTL_SECONDS + SERVER_CLOCK_SKEW_SECONDS
  ) return null;

  const value = signedValue(submissionId, expiresAtSeconds);
  // A legacy-key cookie is accepted only if it could have been issued before the rotation.
  if (!verifyWithRotation(TOKEN_KEY, value, suppliedSignature, now,
    () => expiryFitsPreRotationIssue(expiresAtSeconds * 1_000, FORM_SUBMISSION_CHAT_SESSION_TTL_SECONDS * 1_000))) return null;

  return { submissionId, expiresAt: new Date(expiresAtSeconds * 1_000) };
}

/**
 * A4-03 MAJOR-A: limiter identity for a chat speaker. A correctly signed,
 * unexpired chat-session cookie names one registration (submission) without a
 * database read; a client cannot mint one, and each new submission is itself
 * behind the registration limits. Returns null (caller falls back to the
 * trusted IP) for a missing or invalid token. Callers keep a looser per-IP
 * limit as well.
 */
export function chatSpeakerRateLimitIdentity(token: string | null | undefined, now = new Date()) {
  if (!token) return null;
  const claim = verifyFormSubmissionChatSessionToken(token, now);
  if (!claim) return null;
  return `chat-speaker:${createHash("sha256").update(`${TOKEN_VERSION}:limit:${claim.submissionId}`).digest("hex").slice(0, 32)}`;
}

export function formSubmissionChatSessionCookieOptions(secure: boolean): FormSubmissionChatSessionCookieOptions {
  return {
    httpOnly: true,
    sameSite: "lax",
    secure,
    path: "/",
    maxAge: FORM_SUBMISSION_CHAT_SESSION_TTL_SECONDS,
  };
}
