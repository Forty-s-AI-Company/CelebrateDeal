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
  it("derives a whole-TWD partial amount without accepting a caller amount", () => {
    expect(selectWp4PayUniFixedRefund({ ...base, grossAmountCents: 300 }, "partial")).toEqual({
      purpose: "buyer_order",
      phase: "partial",
      refundAmountCents: 100,
      gatewayFeeRefundCents: 0,
      platformFeeRefundCents: 0,
    });
  });

  it("allows one full NT$1 refund or a whole-TWD remainder", () => {
    expect(selectWp4PayUniFixedRefund(base, "remaining"))
      .toEqual({
        purpose: "buyer_order",
        phase: "remaining",
        refundAmountCents: 100,
        gatewayFeeRefundCents: 0,
        platformFeeRefundCents: 0,
      });
    expect(selectWp4PayUniFixedRefund({ ...base, grossAmountCents: 300, status: "partially_refunded", refundedAmountCents: 100 }, "remaining"))
      .toMatchObject({ refundAmountCents: 200 });
  });

  it("fails closed for an unrelated transaction, a completed refund, or a one-cent fixture", () => {
    expect(selectWp4PayUniFixedRefund({ ...base, vendorId: "other-vendor" }, "partial")).toBeNull();
    expect(selectWp4PayUniFixedRefund({ ...base, status: "refunded", refundedAmountCents: 100 }, "remaining")).toBeNull();
    expect(selectWp4PayUniFixedRefund({ ...base, grossAmountCents: 1 }, "partial")).toBeNull();
    expect(selectWp4PayUniFixedRefund({ ...base, grossAmountCents: 150 }, "remaining")).toBeNull();
  });
});

