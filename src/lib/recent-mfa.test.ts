import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ redirect: (path: string) => { throw new Error(`redirect:${path}`); } }));

import { recentMfaRedirectPath, recentMfaStatus, requireRecentMfa, STEP_UP_MFA_MAX_AGE_MINUTES } from "@/lib/recent-mfa";

const now = new Date("2026-10-21T08:00:00.000Z");
const factor = { id: "factor-1" };
const minutesAgo = (minutes: number) => new Date(now.getTime() - minutes * 60_000);

describe("recentMfaStatus", () => {
  it("defaults to the 15-minute step-up window", () => {
    expect(STEP_UP_MFA_MAX_AGE_MINUTES).toBe(15);
  });

  it("requires setup when the user has no confirmed factor, even with a verification stamp", () => {
    expect(recentMfaStatus({ user: { mfaFactor: null }, session: { mfaVerifiedAt: now } }, { now })).toBe("setup_required");
    expect(recentMfaStatus({ user: {}, session: { mfaVerifiedAt: now } }, { now })).toBe("setup_required");
  });

  it("fails closed for an incomplete actor", () => {
    expect(recentMfaStatus(undefined as never, { now })).toBe("setup_required");
    expect(recentMfaStatus({ user: { mfaFactor: factor } }, { now })).toBe("verification_required");
    expect(recentMfaStatus({ user: { mfaFactor: factor }, session: null }, { now })).toBe("verification_required");
  });

  it("requires verification when the session never passed MFA", () => {
    expect(recentMfaStatus({ user: { mfaFactor: factor }, session: { mfaVerifiedAt: null } }, { now })).toBe("verification_required");
    expect(recentMfaStatus({ user: { mfaFactor: factor }, session: { mfaVerifiedAt: new Date("invalid") } }, { now })).toBe("verification_required");
  });

  it("accepts a verification up to exactly 15 minutes old and rejects anything older", () => {
    expect(recentMfaStatus({ user: { mfaFactor: factor }, session: { mfaVerifiedAt: minutesAgo(0) } }, { now })).toBe("verified");
    expect(recentMfaStatus({ user: { mfaFactor: factor }, session: { mfaVerifiedAt: minutesAgo(15) } }, { now })).toBe("verified");
    expect(recentMfaStatus({ user: { mfaFactor: factor }, session: { mfaVerifiedAt: new Date(minutesAgo(15).getTime() - 1) } }, { now })).toBe("verification_required");
    // Login-time verification hours ago is not a step-up.
    expect(recentMfaStatus({ user: { mfaFactor: factor }, session: { mfaVerifiedAt: minutesAgo(180) } }, { now })).toBe("verification_required");
  });

  it("tolerates small clock skew but rejects a far-future stamp", () => {
    expect(recentMfaStatus({ user: { mfaFactor: factor }, session: { mfaVerifiedAt: new Date(now.getTime() + 30_000) } }, { now })).toBe("verified");
    expect(recentMfaStatus({ user: { mfaFactor: factor }, session: { mfaVerifiedAt: new Date(now.getTime() + 61_000) } }, { now })).toBe("verification_required");
  });

  it("honours a narrower window and rejects an invalid one", () => {
    expect(recentMfaStatus({ user: { mfaFactor: factor }, session: { mfaVerifiedAt: minutesAgo(6) } }, { now, maxAgeMinutes: 5 })).toBe("verification_required");
    expect(() => recentMfaStatus({ user: { mfaFactor: factor }, session: { mfaVerifiedAt: now } }, { maxAgeMinutes: 0 })).toThrow();
    expect(() => recentMfaStatus({ user: { mfaFactor: factor }, session: { mfaVerifiedAt: now } }, { maxAgeMinutes: Number.NaN })).toThrow();
  });
});

describe("requireRecentMfa", () => {
  it("returns without redirecting for a fresh verification", () => {
    expect(() => requireRecentMfa(
      { user: { mfaFactor: factor }, session: { mfaVerifiedAt: new Date() } },
      { nextPath: "/billing/plans" },
    )).not.toThrow();
  });

  it("sends a user without a factor to setup with a safe return path", () => {
    expect(() => requireRecentMfa({ user: { mfaFactor: null }, session: { mfaVerifiedAt: null } }, { nextPath: "/settings/security" }))
      .toThrow("redirect:/mfa/setup?reason=step_up&next=%2Fsettings%2Fsecurity");
  });

  it("sends a stale verification back to /mfa/verify", () => {
    expect(() => requireRecentMfa(
      { user: { mfaFactor: factor }, session: { mfaVerifiedAt: new Date(Date.now() - 16 * 60_000) } },
      { nextPath: "/billing/payment-methods" },
    )).toThrow("redirect:/mfa/verify?reason=step_up&next=%2Fbilling%2Fpayment-methods");
  });

  it("drops an off-site return path instead of forwarding it", () => {
    expect(recentMfaRedirectPath("verification_required", "//evil.example/steal")).toBe("/mfa/verify?reason=step_up");
    expect(recentMfaRedirectPath("setup_required", "https://evil.example")).toBe("/mfa/setup?reason=step_up");
  });
});
