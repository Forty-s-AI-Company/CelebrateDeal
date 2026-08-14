import { describe, expect, it, vi } from "vitest";

const commerceOrderMocks = vi.hoisted(() => ({
  reconcileCommerceOrderRefundForPayment: vi.fn(async () => ({
    orderId: "order-1",
    refundId: "commerce-refund-1",
    changed: true,
  })),
}));

vi.mock("@/lib/commerce-orders", () => ({
  reconcileCommerceOrderRefundForPayment: commerceOrderMocks.reconcileCommerceOrderRefundForPayment,
}));

import {
  applyPaymentRefundAccounting,
  calculateNetReferenceAmountCents,
} from "@/lib/payment-refund-accounting";

describe("calculateNetReferenceAmountCents", () => {
  it("subtracts refunded principal and restores explicitly refunded fees", () => {
    expect(calculateNetReferenceAmountCents({
      netAmountCents: 97_000,
      refundedAmountCents: 20_000,
      gatewayFeeRefundCents: 400,
      platformFeeRefundCents: 200,
    })).toBe(77_600);
  });

  it("clamps the display-only reference at zero", () => {
    expect(calculateNetReferenceAmountCents({
      netAmountCents: 1_000,
      refundedAmountCents: 2_000,
      gatewayFeeRefundCents: 0,
      platformFeeRefundCents: 0,
    })).toBe(0);
  });
});

describe("applyPaymentRefundAccounting", () => {
  it("reconciles the canonical order in the same accounting call", async () => {
    commerceOrderMocks.reconcileCommerceOrderRefundForPayment.mockClear();
    const db = {
      affiliateCommission: { findFirst: vi.fn(async () => null) },
      courseCommissionAllocation: { findMany: vi.fn(async () => []) },
    };
    const occurredAt = new Date("2026-08-08T09:00:00.000Z");

    await expect(applyPaymentRefundAccounting(db as never, {
      vendorId: "vendor-1",
      transactionId: "payment-1",
      orderNumber: "CD-1",
      providerName: "payuni",
      eventIdentity: "refund-event-1",
      refundRecordId: "refund-record-1",
      refundAmountCents: 300,
      netReferenceAmountCents: 900,
      isFullRefund: false,
      transactionOccurredAt: occurredAt,
      occurredAt,
    })).resolves.toMatchObject({
      commerceOrderRefund: { orderId: "order-1", changed: true },
    });

    expect(commerceOrderMocks.reconcileCommerceOrderRefundForPayment).toHaveBeenCalledWith(
      db,
      expect.objectContaining({
        paymentTransactionId: "payment-1",
        refundRecordId: "refund-record-1",
        amountCents: 300,
      }),
    );
  });
});
