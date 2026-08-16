import { createHmac, timingSafeEqual } from "node:crypto";
import { deriveSensitiveDataKey } from "@/lib/sensitive-data";

export const FORM_SUBMISSION_CHAT_SESSION_COOKIE = "celebratedeal_form_submission_chat_session";
export const FORM_SUBMISSION_CHAT_SESSION_TTL_SECONDS = 30 * 24 * 60 * 60;

const TOKEN_VERSION = "fss1";
const TOKEN_PURPOSE = "form-submission-chat-session";
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

function signature(value: string) {
  return createHmac("sha256", deriveSensitiveDataKey(TOKEN_PURPOSE))
    .update(value)
    .digest("base64url");
}

export function createFormSubmissionChatSessionToken(input: {
  submissionId: string;
  now?: Date;
}) {
  const current = input.now ?? new Date();
  const expiresAtSeconds = nowSeconds(current) + FORM_SUBMISSION_CHAT_SESSION_TTL_SECONDS;
  const value = signedValue(input.submissionId, expiresAtSeconds);
  return `${value}.${signature(value)}`;
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
  if (
    !Number.isSafeInteger(expiresAtSeconds)
    || expiresAtSeconds <= currentSeconds
    || expiresAtSeconds > currentSeconds + FORM_SUBMISSION_CHAT_SESSION_TTL_SECONDS
  ) return null;

  const value = signedValue(submissionId, expiresAtSeconds);
  const expected = Buffer.from(signature(value), "utf8");
  const supplied = Buffer.from(suppliedSignature, "utf8");
  if (expected.length !== supplied.length || !timingSafeEqual(expected, supplied)) return null;

  return { submissionId, expiresAt: new Date(expiresAtSeconds * 1_000) };
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
