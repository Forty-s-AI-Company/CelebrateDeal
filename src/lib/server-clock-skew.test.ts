import { describe, expect, it } from "vitest";
import { SERVER_CLOCK_SKEW_MS, SERVER_CLOCK_SKEW_SECONDS } from "@/lib/server-clock-skew";
import { STUDENT_PORTAL_CLOCK_SKEW_SECONDS } from "@/lib/student-portal-clock-skew";
import { recentMfaStatus } from "@/lib/recent-mfa";
import { STREAM_TOKEN_CLOCK_SKEW_SECONDS } from "@/lib/cloudflare-stream-signing";

describe("one server clock-skew bound", () => {
  it("is 60 seconds and the learner portal uses the same value", () => {
    expect(SERVER_CLOCK_SKEW_SECONDS).toBe(60);
    expect(SERVER_CLOCK_SKEW_MS).toBe(60_000);
    expect(STUDENT_PORTAL_CLOCK_SKEW_SECONDS).toBe(SERVER_CLOCK_SKEW_SECONDS);
  });

  it("recent MFA accepts a stamp exactly the shared bound ahead and nothing further", () => {
    const now = new Date("2026-11-17T00:00:00.000Z");
    const actor = (ahead: number) => ({ user: { mfaFactor: { id: "factor" } }, session: { mfaVerifiedAt: new Date(now.getTime() + ahead) } });
    expect(recentMfaStatus(actor(SERVER_CLOCK_SKEW_MS), { now })).toBe("verified");
    expect(recentMfaStatus(actor(SERVER_CLOCK_SKEW_MS + 1), { now })).toBe("verification_required");
  });

  it("keeps Cloudflare Stream's own 30-second not-before allowance separate", () => {
    // A provider-verified nbf margin, not a bound on our own issued timestamps.
    expect(STREAM_TOKEN_CLOCK_SKEW_SECONDS).toBe(30);
  });
});
