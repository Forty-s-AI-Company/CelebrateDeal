import { describe, expect, it } from "vitest";
import { checkoutReadinessAllowsNewTransaction } from "@/lib/payment-providers/types";

describe("checkout provider readiness", () => {
  it("allows ready providers and rejects unavailable providers in every runtime", () => {
    expect(checkoutReadinessAllowsNewTransaction("ready", "production")).toBe(true);
    expect(checkoutReadinessAllowsNewTransaction("unavailable", "test", true)).toBe(false);
  });

  it("keeps local-only providers disabled in production without explicit loopback evidence", () => {
    expect(checkoutReadinessAllowsNewTransaction("local_only", "production")).toBe(false);
    expect(checkoutReadinessAllowsNewTransaction("local_only", "production", true)).toBe(true);
    expect(checkoutReadinessAllowsNewTransaction("local_only", "test")).toBe(true);
  });
});
