import { createHmac } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { deriveSensitiveDataKey } from "@/lib/sensitive-data";
import { createFormSubmissionVerificationToken } from "@/lib/form-submission-verification";
import {
  createFormSubmissionChatSessionToken,
  FORM_SUBMISSION_CHAT_SESSION_TTL_SECONDS,
  formSubmissionChatSessionCookieOptions,
  verifyFormSubmissionChatSessionToken,
} from "@/lib/form-submission-chat-session";

afterEach(() => vi.unstubAllEnvs());

const now = new Date("2026-08-17T00:00:00.000Z");

describe("form submission chat session", () => {
  it("creates an fss1 token that round-trips for exactly thirty days", () => {
    vi.stubEnv("CSRF_SECRET", "form-chat-session-test-secret-longer-than-thirty-two-bytes");

    const token = createFormSubmissionChatSessionToken({ submissionId: "formsub_abc123", now });
    const expiresAt = new Date(
      Math.floor((now.getTime() + FORM_SUBMISSION_CHAT_SESSION_TTL_SECONDS * 1_000) / 1_000) * 1_000,
    );

    expect(token).toMatch(/^fss1\.formsub_abc123\.\d{10}\.[A-Za-z0-9_-]{43}$/u);
    expect(verifyFormSubmissionChatSessionToken(token, now)).toEqual({
      submissionId: "formsub_abc123",
      expiresAt,
    });
    expect(token).not.toContain("form-chat-session-test-secret");
  });

  it("uses a purpose separate from the email verification token", () => {
    vi.stubEnv("CSRF_SECRET", "form-chat-session-test-secret-longer-than-thirty-two-bytes");

    const emailToken = createFormSubmissionVerificationToken({
      submissionId: "formsub_abc123",
      expiresAt: new Date(now.getTime() + 60 * 60 * 1_000),
      version: 1,
    });
    expect(verifyFormSubmissionChatSessionToken(emailToken, now)).toBeNull();

    const chatToken = createFormSubmissionChatSessionToken({ submissionId: "formsub_abc123", now });
    vi.stubEnv("CSRF_SECRET", "different-chat-session-test-secret-longer-than-thirty-two");
    expect(verifyFormSubmissionChatSessionToken(chatToken, now)).toBeNull();
  });

  it("rejects forged, expired, overlong and over-future claims", () => {
    vi.stubEnv("CSRF_SECRET", "form-chat-session-test-secret-longer-than-thirty-two-bytes");

    const token = createFormSubmissionChatSessionToken({ submissionId: "formsub_abc123", now });
    expect(verifyFormSubmissionChatSessionToken(`${token.slice(0, -1)}x`, now)).toBeNull();
    expect(verifyFormSubmissionChatSessionToken(token, new Date(now.getTime() + 30 * 24 * 60 * 60 * 1_000))).toBeNull();
    expect(verifyFormSubmissionChatSessionToken(`fss1.${"a".repeat(129)}.1784332800.${"a".repeat(43)}`, now)).toBeNull();
    expect(verifyFormSubmissionChatSessionToken(`fss1.formsub_abc.1234567890123.${"a".repeat(43)}`, now)).toBeNull();
    const overlongToken = token.padEnd(321, "x");
    expect(overlongToken.length).toBeGreaterThan(320);
    expect(verifyFormSubmissionChatSessionToken(overlongToken, now)).toBeNull();

    const futureSeconds = Math.floor(now.getTime() / 1_000) + FORM_SUBMISSION_CHAT_SESSION_TTL_SECONDS + 1;
    const futureValue = `fss1.formsub_abc123.${futureSeconds}`;
    const futureSignature = createHmac("sha256", deriveSensitiveDataKey("form-submission-chat-session"))
      .update(futureValue)
      .digest("base64url");
    expect(verifyFormSubmissionChatSessionToken(`${futureValue}.${futureSignature}`, now)).toBeNull();
  });

  it("returns the required secure cookie attributes", () => {
    expect(formSubmissionChatSessionCookieOptions(true)).toEqual({
      httpOnly: true,
      sameSite: "lax",
      secure: true,
      path: "/",
      maxAge: 30 * 24 * 60 * 60,
    });
    expect(formSubmissionChatSessionCookieOptions(false).secure).toBe(false);
  });
});
