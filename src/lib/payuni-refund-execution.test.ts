import { describe, expect, it, vi } from "vitest";

const providerMocks = vi.hoisted(() => ({
  getPaymentProvider: vi.fn(),
}));

vi.mock("@/lib/payment-providers", () => ({
  getPaymentProvider: providerMocks.getPaymentProvider,
}));

import { executePayUniRefund } from "@/lib/payuni-refund-execution";

describe("PayUni refund amount boundary", () => {
  it.each([
    { refundAmountCents: -100 },
    { refundAmountCents: 50.5 },
    { refundAmountCents: Number.MAX_SAFE_INTEGER + 1 },
    { gatewayFeeRefundCents: -1 },
    { gatewayFeeRefundCents: 0.5 },
    { platformFeeRefundCents: -1 },
    { platformFeeRefundCents: Number.POSITIVE_INFINITY },
  ])("rejects invalid money before a provider call or reservation: %j", async (override) => {
    providerMocks.getPaymentProvider.mockClear();
    const transaction = vi.fn();

    const result = await executePayUniRefund({
      db: { $transaction: transaction } as never,
      transactionId: "synthetic-transaction",
      refundAmountCents: 100,
      gatewayFeeRefundCents: 0,
      platformFeeRefundCents: 0,
      reason: "synthetic",
      monthKey: "2026-09",
      actor: { id: "synthetic-actor", label: "synthetic" },
      ...override,
    });

    expect(result).toEqual({ disposition: "validation_failed" });
    expect(providerMocks.getPaymentProvider).not.toHaveBeenCalled();
    expect(transaction).not.toHaveBeenCalled();
  });
});
