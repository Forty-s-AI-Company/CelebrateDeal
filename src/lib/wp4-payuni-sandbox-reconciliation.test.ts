import { describe, expect, it } from "vitest";

import {
  isWp4PayUniSandboxTransaction,
  wp4PayUniPurposeFromMetadata,
} from "@/lib/wp4-payuni-sandbox-reconciliation";
import { WP4_SANDBOX_FIXTURE } from "@/lib/wp4-sandbox-fixture";

describe("WP4 PayUni Sandbox transaction boundary", () => {
  it("recognizes only the fixed server-owned purposes", () => {
    expect(wp4PayUniPurposeFromMetadata({ billingPurpose: "buyer_order" })).toBe("buyer_order");
    expect(wp4PayUniPurposeFromMetadata({ billingPurpose: "platform_subscription" })).toBe("platform_subscription");
    expect(wp4PayUniPurposeFromMetadata({ billingPurpose: "invoice_payment" })).toBe("invoice_payment");
    expect(wp4PayUniPurposeFromMetadata({ billingPurpose: "anything_else" })).toBeNull();
    expect(wp4PayUniPurposeFromMetadata(null)).toBeNull();
  });

  it.each([
    ["buyer_order", { productId: WP4_SANDBOX_FIXTURE.productId }],
    ["platform_subscription", { planId: WP4_SANDBOX_FIXTURE.planId }],
    ["invoice_payment", { invoiceId: WP4_SANDBOX_FIXTURE.invoiceId }],
  ] as const)("accepts the matching %s fixture transaction", (billingPurpose, fixtureIdentity) => {
    expect(isWp4PayUniSandboxTransaction({
      vendorId: WP4_SANDBOX_FIXTURE.vendorId,
      providerName: "payuni",
      grossAmountCents: 100,
      status: "paid",
      metadata: { billingPurpose, ...fixtureIdentity },
    })).toBe(true);
  });

  it("rejects cross-tenant, caller-shaped, and terminally invalid candidates", () => {
    const base = {
      vendorId: WP4_SANDBOX_FIXTURE.vendorId,
      providerName: "payuni",
      grossAmountCents: 100,
      status: "paid",
      metadata: { billingPurpose: "buyer_order", productId: WP4_SANDBOX_FIXTURE.productId },
    };
    expect(isWp4PayUniSandboxTransaction({ ...base, vendorId: "other-vendor" })).toBe(false);
    expect(isWp4PayUniSandboxTransaction({ ...base, providerName: "demo" })).toBe(false);
    expect(isWp4PayUniSandboxTransaction({ ...base, grossAmountCents: 0 })).toBe(false);
    expect(isWp4PayUniSandboxTransaction({ ...base, status: "pending" })).toBe(false);
    expect(isWp4PayUniSandboxTransaction({ ...base, metadata: { billingPurpose: "buyer_order", productId: "caller-value" } })).toBe(false);
  });
});
