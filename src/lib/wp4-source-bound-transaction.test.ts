import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { wp4SourceBoundTransactionMetadata } from "./wp4-source-bound-transaction";
import { WP4_SANDBOX_FIXTURE } from "./wp4-sandbox-fixture";

const source = "a".repeat(40);
describe("server-owned Sandbox checkout source", () => {
  beforeEach(() => {
    vi.stubEnv("VERCEL_ENV", "preview");
    vi.stubEnv("PAYUNI_ENV", "sandbox");
    vi.stubEnv("WP4_SANDBOX_EXECUTOR_ENABLED", "true");
    vi.stubEnv("VERCEL_GIT_COMMIT_SHA", source);
    vi.stubEnv("WP4_EXPECTED_SOURCE_SHA", "");
  });
  afterEach(() => vi.unstubAllEnvs());

  it("marks only the two fixed server-selected identities", () => {
    expect(wp4SourceBoundTransactionMetadata("buyer_order", { productId: WP4_SANDBOX_FIXTURE.productId }))
      .toEqual({ wp4SourceCommit: source });
    expect(wp4SourceBoundTransactionMetadata("platform_subscription", { planId: WP4_SANDBOX_FIXTURE.planId }))
      .toEqual({ wp4SourceCommit: source });
  });
  it.each([
    ["VERCEL_ENV", "production"], ["PAYUNI_ENV", "production"],
    ["WP4_SANDBOX_EXECUTOR_ENABLED", "false"], ["VERCEL_GIT_COMMIT_SHA", "invalid"],
    ["WP4_EXPECTED_SOURCE_SHA", "b".repeat(40)],
  ])("rejects incompatible %s", (key, value) => {
    vi.stubEnv(key, value);
    expect(wp4SourceBoundTransactionMetadata("buyer_order", { productId: WP4_SANDBOX_FIXTURE.productId })).toBeNull();
  });
  it("does not mark ordinary products or accept caller source metadata", () => {
    expect(wp4SourceBoundTransactionMetadata("buyer_order", { productId: "ordinary-product" })).toBeNull();
    expect(wp4SourceBoundTransactionMetadata("buyer_order", {
      productId: WP4_SANDBOX_FIXTURE.productId, wp4SourceCommit: "b".repeat(40),
    })).toBeNull();
    expect(wp4SourceBoundTransactionMetadata("platform_subscription", { planId: "ordinary-plan" })).toBeNull();
  });
});
