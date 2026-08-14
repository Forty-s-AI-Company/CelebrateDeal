import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createFormSubmissionVerificationToken,
  createFormSubmissionVerificationUrl,
  verifyFormSubmissionVerificationToken,
} from "@/lib/form-submission-verification";

afterEach(() => vi.unstubAllEnvs());

describe("form submission verification token", () => {
  it("round-trips an exact submission, expiry and version without persisting a raw secret", () => {
    vi.stubEnv("CSRF_SECRET", "form-verification-test-secret-longer-than-thirty-two-bytes");
    const expiresAt = new Date("2026-08-10T00:00:00.000Z");
    const token = createFormSubmissionVerificationToken({ submissionId: "formsub_abc123", expiresAt, version: 2 });

    expect(verifyFormSubmissionVerificationToken(token, new Date("2026-08-09T00:00:00.000Z"))).toEqual({
      submissionId: "formsub_abc123",
      expiresAt,
      version: 2,
    });
    expect(token).not.toContain("form-verification-test-secret");
  });

  it("rejects tampering, expiry, malformed values and a different signing key", () => {
    vi.stubEnv("CSRF_SECRET", "form-verification-test-secret-longer-than-thirty-two-bytes");
    const token = createFormSubmissionVerificationToken({
      submissionId: "formsub_abc123",
      expiresAt: new Date("2026-08-10T00:00:00.000Z"),
      version: 1,
    });
    expect(verifyFormSubmissionVerificationToken(`${token.slice(0, -1)}x`, new Date("2026-08-09T00:00:00.000Z"))).toBeNull();
    expect(verifyFormSubmissionVerificationToken(token, new Date("2026-08-10T00:00:00.000Z"))).toBeNull();
    expect(verifyFormSubmissionVerificationToken("invalid")).toBeNull();
    vi.stubEnv("CSRF_SECRET", "different-form-verification-secret-longer-than-thirty-two");
    expect(verifyFormSubmissionVerificationToken(token, new Date("2026-08-09T00:00:00.000Z"))).toBeNull();
  });

  it("creates only an http(s) same-application verification URL", () => {
    vi.stubEnv("CSRF_SECRET", "form-verification-test-secret-longer-than-thirty-two-bytes");
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://app.example.test");
    const token = createFormSubmissionVerificationToken({
      submissionId: "formsub_abc123",
      expiresAt: new Date("2026-08-10T00:00:00.000Z"),
      version: 1,
    });
    expect(createFormSubmissionVerificationUrl(token)).toBe(`https://app.example.test/verify-registration?token=${token}`);
  });
});
