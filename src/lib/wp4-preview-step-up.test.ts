import { afterEach, describe, expect, it, vi } from "vitest";
import { recentMfaStatus } from "@/lib/recent-mfa";
import { wp4PreviewStepUpActor } from "@/lib/wp4-runtime-boundary";
import { WP4_SANDBOX_FIXTURE } from "@/lib/wp4-sandbox-fixture";

// #462 m5: the only F-027 exemption. The synthetic WP4 owner (no enrolled
// factor) may pass step-up solely inside a bound non-production runtime, and
// the 15-minute recency of its session stamp still applies.
const LOOPBACK_DB = "postgresql://synthetic:synthetic@127.0.0.1:55432/celebratedeal_test";

function stubBoundDisposableRuntime() {
  vi.stubEnv("VERCEL_ENV", "preview");
  vi.stubEnv("PAYUNI_ENV", "sandbox");
  vi.stubEnv("WP4_SANDBOX_EXECUTOR_ENABLED", "true");
  vi.stubEnv("VERCEL_PROJECT_ID", "");
  vi.stubEnv("WP4_DISPOSABLE_RUNNER_MARKER", "verified-loopback");
  vi.stubEnv("NEXT_PUBLIC_APP_URL", "http://127.0.0.1:31023");
  vi.stubEnv("DATABASE_URL", LOOPBACK_DB);
  vi.stubEnv("DIRECT_URL", LOOPBACK_DB);
}

function fixtureContext(mfaVerifiedAt: Date | null, userId: string = WP4_SANDBOX_FIXTURE.userId) {
  return { user: { id: userId, mfaFactor: null }, session: { mfaVerifiedAt } };
}

afterEach(() => vi.unstubAllEnvs());

describe("wp4PreviewStepUpActor", () => {
  it("lets the fixture owner pass with a fresh preview session in the bound runtime", () => {
    stubBoundDisposableRuntime();
    const actor = wp4PreviewStepUpActor(fixtureContext(new Date()), WP4_SANDBOX_FIXTURE.vendorId);
    expect(recentMfaStatus(actor)).toBe("verified");
  });

  it("never applies in production", () => {
    stubBoundDisposableRuntime();
    vi.stubEnv("VERCEL_ENV", "production");
    const actor = wp4PreviewStepUpActor(fixtureContext(new Date()), WP4_SANDBOX_FIXTURE.vendorId);
    expect(recentMfaStatus(actor)).toBe("setup_required");
  });

  it.each([
    ["PAYUNI_ENV is production", "PAYUNI_ENV", "production"],
    ["the executor switch is off", "WP4_SANDBOX_EXECUTOR_ENABLED", "false"],
    ["the loopback marker is missing", "WP4_DISPOSABLE_RUNNER_MARKER", ""],
  ])("does not apply when %s", (_label, key, value) => {
    stubBoundDisposableRuntime();
    vi.stubEnv(key, value);
    const actor = wp4PreviewStepUpActor(fixtureContext(new Date()), WP4_SANDBOX_FIXTURE.vendorId);
    expect(recentMfaStatus(actor)).toBe("setup_required");
  });

  it("does not apply to another user or another vendor", () => {
    stubBoundDisposableRuntime();
    expect(recentMfaStatus(wp4PreviewStepUpActor(fixtureContext(new Date(), "real-owner"), WP4_SANDBOX_FIXTURE.vendorId))).toBe("setup_required");
    expect(recentMfaStatus(wp4PreviewStepUpActor(fixtureContext(new Date()), "real-vendor"))).toBe("setup_required");
  });

  it.each([
    ["has no verification stamp", null],
    ["was verified more than 15 minutes ago", new Date(Date.now() - 16 * 60_000)],
  ])("still requires recency when the fixture session %s", (_label, mfaVerifiedAt) => {
    stubBoundDisposableRuntime();
    const actor = wp4PreviewStepUpActor(fixtureContext(mfaVerifiedAt), WP4_SANDBOX_FIXTURE.vendorId);
    expect(recentMfaStatus(actor)).toBe("verification_required");
  });

  it("returns the real actor unchanged outside the exemption", () => {
    const context = { user: { id: "owner-1", mfaFactor: { id: "factor" } }, session: { mfaVerifiedAt: new Date() } };
    expect(wp4PreviewStepUpActor(context, "vendor-1")).toBe(context);
  });
});
