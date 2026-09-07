import { createHmac, timingSafeEqual } from "node:crypto";
import { deriveSensitiveDataKey } from "@/lib/sensitive-data";

export const FORM_SUBMISSION_LINE_BINDING_COOKIE = "celebratedeal_form_submission_line_binding";
export const FORM_SUBMISSION_LINE_BINDING_TTL_SECONDS = 30 * 60;

const TOKEN_VERSION = "fsl1";
const TOKEN_PURPOSE = "form-submission-line-binding";
const SUBMISSION_ID = /^[A-Za-z0-9_-]{1,128}$/u;
const SIGNATURE = /^[A-Za-z0-9_-]{43}$/u;

function signedValue(submissionId: string, expiresAtSeconds: number) {
  if (!SUBMISSION_ID.test(submissionId) || !Number.isSafeInteger(expiresAtSeconds) || expiresAtSeconds <= 0) {
    throw new Error("Invalid LINE binding session.");
  }
  return `${TOKEN_VERSION}.${submissionId}.${expiresAtSeconds}`;
}

function signature(value: string) {
  return createHmac("sha256", deriveSensitiveDataKey(TOKEN_PURPOSE)).update(value).digest("base64url");
}

/** Creates a short-lived capability that can bind only the registration just submitted. */
export function createFormSubmissionLineBindingToken(submissionId: string, now = new Date()) {
  const expiresAtSeconds = Math.floor(now.getTime() / 1_000) + FORM_SUBMISSION_LINE_BINDING_TTL_SECONDS;
  const value = signedValue(submissionId, expiresAtSeconds);
  return `${value}.${signature(value)}`;
}

export function verifyFormSubmissionLineBindingToken(token: string, now = new Date()) {
  if (!token || token.length > 320) return null;
  const [version, submissionId, expiresAtRaw, suppliedSignature, extra] = token.split(".");
  if (version !== TOKEN_VERSION || !submissionId || !SUBMISSION_ID.test(submissionId)
    || !expiresAtRaw || !/^\d{1,12}$/u.test(expiresAtRaw) || !suppliedSignature
    || !SIGNATURE.test(suppliedSignature) || extra !== undefined) return null;
  const expiresAtSeconds = Number(expiresAtRaw);
  const nowSeconds = Math.floor(now.getTime() / 1_000);
  if (!Number.isSafeInteger(expiresAtSeconds) || expiresAtSeconds <= nowSeconds
    || expiresAtSeconds > nowSeconds + FORM_SUBMISSION_LINE_BINDING_TTL_SECONDS) return null;
  const expected = Buffer.from(signature(signedValue(submissionId, expiresAtSeconds)), "utf8");
  const supplied = Buffer.from(suppliedSignature, "utf8");
  if (expected.length !== supplied.length || !timingSafeEqual(expected, supplied)) return null;
  return { submissionId, expiresAt: new Date(expiresAtSeconds * 1_000) };
}

export function formSubmissionLineBindingCookieOptions(secure: boolean) {
  return {
    httpOnly: true as const,
    sameSite: "lax" as const,
    secure,
    path: "/",
    maxAge: FORM_SUBMISSION_LINE_BINDING_TTL_SECONDS,
  };
}
