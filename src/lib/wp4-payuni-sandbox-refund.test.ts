import { describe, expect, it } from "vitest";
import { selectWp4PayUniFixedRefund } from "@/lib/wp4-payuni-sandbox-refund";
import { WP4_SANDBOX_FIXTURE } from "@/lib/wp4-sandbox-fixture";

const base = {
  vendorId: WP4_SANDBOX_FIXTURE.vendorId,
  providerName: "payuni",
  grossAmountCents: 100,
  refundedAmountCents: 0,
  gatewayFeeCents: 0,
  platformFeeCents: 0,
  status: "paid",
  metadata: {
    billingPurpose: "buyer_order",
    productId: WP4_SANDBOX_FIXTURE.productId,
  },
};

describe("WP4 fixed PayUni Sandbox refund selection", () => {
  it("derives a server-owned partial amount without accepting a caller amount", () => {
    expect(selectWp4PayUniFixedRefund(base, "partial")).toEqual({
      purpose: "buyer_order",
      phase: "partial",
      refundAmountCents: 50,
      gatewayFeeRefundCents: 0,
      platformFeeRefundCents: 0,
    });
  });

  it("allows the remaining phase only after a prior partial refund", () => {
    expect(selectWp4PayUniFixedRefund({ ...base, status: "partially_refunded", refundedAmountCents: 50 }, "remaining"))
      .toEqual({
        purpose: "buyer_order",
        phase: "remaining",
        refundAmountCents: 50,
        gatewayFeeRefundCents: 0,
        platformFeeRefundCents: 0,
      });
    expect(selectWp4PayUniFixedRefund(base, "remaining")).toBeNull();
  });

  it("fails closed for an unrelated transaction, a completed refund, or a one-cent fixture", () => {
    expect(selectWp4PayUniFixedRefund({ ...base, vendorId: "other-vendor" }, "partial")).toBeNull();
    expect(selectWp4PayUniFixedRefund({ ...base, status: "refunded", refundedAmountCents: 100 }, "remaining")).toBeNull();
    expect(selectWp4PayUniFixedRefund({ ...base, grossAmountCents: 1 }, "partial")).toBeNull();
  });
});
