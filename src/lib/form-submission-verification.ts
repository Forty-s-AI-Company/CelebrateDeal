import { createHmac, timingSafeEqual } from "node:crypto";
import { deriveSensitiveDataKey } from "@/lib/sensitive-data";

const TOKEN_VERSION = "fsv1";
const TOKEN_PURPOSE = "form-submission-email-verification";
const SUBMISSION_ID = /^[A-Za-z0-9_-]{1,128}$/u;
const TOKEN_SIGNATURE = /^[A-Za-z0-9_-]{43}$/u;
export const FORM_SUBMISSION_VERIFICATION_TTL_MS = 48 * 60 * 60 * 1_000;

function expiresAtSeconds(expiresAt: Date) {
  const value = Math.floor(expiresAt.getTime() / 1_000);
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error("Invalid registration verification expiry.");
  return value;
}

function signedValue(submissionId: string, expiresAt: number, version: number) {
  if (!SUBMISSION_ID.test(submissionId) || !Number.isSafeInteger(version) || version <= 0) {
    throw new Error("Invalid registration verification binding.");
  }
  return `${TOKEN_VERSION}.${submissionId}.${expiresAt}.${version}`;
}

function signature(value: string) {
  return createHmac("sha256", deriveSensitiveDataKey(TOKEN_PURPOSE)).update(value).digest("base64url");
}

export function createFormSubmissionVerificationToken(input: {
  submissionId: string;
  expiresAt: Date;
  version: number;
}) {
  const value = signedValue(input.submissionId, expiresAtSeconds(input.expiresAt), input.version);
  return `${value}.${signature(value)}`;
}

export function verifyFormSubmissionVerificationToken(token: string, now = new Date()) {
  if (token.length > 320) return null;
  const [tokenVersion, submissionId, expiresAtRaw, versionRaw, suppliedSignature, extra] = token.split(".");
  if (
    tokenVersion !== TOKEN_VERSION
    || !submissionId
    || !SUBMISSION_ID.test(submissionId)
    || !expiresAtRaw
    || !/^\d{1,12}$/u.test(expiresAtRaw)
    || !versionRaw
    || !/^\d{1,9}$/u.test(versionRaw)
    || !suppliedSignature
    || !TOKEN_SIGNATURE.test(suppliedSignature)
    || extra
  ) return null;

  const expiresAtSecondsValue = Number(expiresAtRaw);
  const version = Number(versionRaw);
  if (!Number.isSafeInteger(expiresAtSecondsValue) || !Number.isSafeInteger(version) || version <= 0) return null;
  const value = signedValue(submissionId, expiresAtSecondsValue, version);
  const expected = Buffer.from(signature(value), "utf8");
  const supplied = Buffer.from(suppliedSignature, "utf8");
  if (expected.length !== supplied.length || !timingSafeEqual(expected, supplied)) return null;

  const expiresAt = new Date(expiresAtSecondsValue * 1_000);
  if (expiresAt <= now) return null;
  return { submissionId, expiresAt, version };
}

export function createFormSubmissionVerificationUrl(token: string) {
  const configured = process.env.NEXT_PUBLIC_APP_URL?.trim();
  if (!configured) throw new Error("Public application URL is not configured.");
  const url = new URL("/verify-registration", configured);
  if (!new Set(["https:", "http:"]).has(url.protocol)) throw new Error("Public application URL is invalid.");
  url.searchParams.set("token", token);
  return url.toString();
}
