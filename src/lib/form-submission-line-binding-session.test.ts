import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createFormSubmissionLineBindingToken,
  verifyFormSubmissionLineBindingToken,
} from "@/lib/form-submission-line-binding-session";

describe("form submission LINE binding capability", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("accepts only the signed submission and expires after thirty minutes", () => {
    vi.stubEnv("CSRF_SECRET", "line-binding-session-test-secret-at-least-32-bytes");
    const issuedAt = new Date("2026-09-07T00:00:00.000Z");
    const token = createFormSubmissionLineBindingToken("submission-1", issuedAt);

    expect(verifyFormSubmissionLineBindingToken(token, new Date("2026-09-07T00:29:59.000Z")))
      .toMatchObject({ submissionId: "submission-1" });
    expect(verifyFormSubmissionLineBindingToken(token, new Date("2026-09-07T00:30:00.000Z"))).toBeNull();
    expect(verifyFormSubmissionLineBindingToken(`${token.slice(0, -1)}x`, issuedAt)).toBeNull();
  });
});
