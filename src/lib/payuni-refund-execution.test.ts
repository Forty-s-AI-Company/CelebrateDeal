import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getPaymentProvider: vi.fn(),
  applyPlatformRefundProjection: vi.fn(async () => ({ subscription: null, invoice: null })),
  applyPaymentRefundAccounting: vi.fn(async () => ({ affiliateCommission: null, courseRefundAllocations: [], commerceOrderRefund: null })),
}));

vi.mock("@/lib/payment-providers", () => ({ getPaymentProvider: mocks.getPaymentProvider }));
vi.mock("@/lib/platform-refund-projection", () => ({ applyPlatformRefundProjection: mocks.applyPlatformRefundProjection }));
vi.mock("@/lib/payment-refund-accounting", () => ({
  applyPaymentRefundAccounting: mocks.applyPaymentRefundAccounting,
  calculateNetReferenceAmountCents: () => 0,
}));

import { executePayUniRefund } from "./payuni-refund-execution";

const input = {
  db: { $transaction: vi.fn() },
  transactionId: "server-selected-transaction",
  refundAmountCents: 100,
  gatewayFeeRefundCents: 0,
  platformFeeRefundCents: 0,
  reason: "server-owned",
  monthKey: "2026-09",
  actor: { id: "server-owned-actor", label: "wp4_sandbox_runner" },
};

function executionDb(transactionInput: Record<string, unknown>) {
  const transaction = { ...transactionInput };
  const tx = {
    paymentTransaction: {
      findUnique: vi.fn(async () => transaction),
      update: vi.fn(async ({ data }: { data: Record<string, unknown> }) => Object.assign(transaction, data)),
    },
    refundRecord: {
      aggregate: vi.fn(async ({ _count }: { _count?: unknown }) => _count
        ? { _count: { _all: 0 } }
        : { _sum: { refundAmountCents: Number(transaction.refundedAmountCents ?? 0), gatewayFeeRefundCents: 0, platformFeeRefundCents: 0 } }),
      create: vi.fn(async () => ({ id: "refund-1" })),
      update: vi.fn(async () => ({ id: "refund-1", status: "processed" })),
    },
    auditLog: { create: vi.fn(async () => undefined) },
  };
  return {
    transaction,
    tx,
    db: { ...tx, $transaction: vi.fn(async <T>(callback: (value: typeof tx) => Promise<T>) => callback(tx)) },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("executePayUniRefund input boundary", () => {
  it.each([
    { refundAmountCents: 0 },
    { refundAmountCents: -100 },
    { refundAmountCents: 100.5 },
    { gatewayFeeRefundCents: -1 },
    { gatewayFeeRefundCents: 0.5 },
    { platformFeeRefundCents: -1 },
    { platformFeeRefundCents: 0.5 },
  ])("fails closed before provider or database access for invalid refund amounts: %j", async (invalid) => {
    const result = await executePayUniRefund({ ...input, ...invalid } as never);

    expect(result).toEqual({ disposition: "validation_failed" });
    expect(mocks.getPaymentProvider).not.toHaveBeenCalled();
    expect(input.db.$transaction).not.toHaveBeenCalled();
  });
});

describe("executePayUniRefund financial projection", () => {
  it.each([
    ["full", 1_000, 0, 1_000, "refunded"],
    ["partial", 400, 0, 400, "partially_refunded"],
  ] as const)("passes a confirmed %s refund through the transaction-bound projection", async (_label, refundAmountCents, priorRefundedAmountCents, expectedRefundedAmountCents, status) => {
    const fixture = executionDb({
      id: "transaction-1",
      vendorId: "vendor-1",
      providerName: "payuni",
      providerTradeNo: "trade-1",
      orderNumber: "order-1",
      paymentMode: "platform",
      grossAmountCents: 1_000,
      gatewayFeeCents: 0,
      platformFeeCents: 0,
      netAmountCents: 1_000,
      currency: "TWD",
      status: "paid",
      refundedAmountCents: priorRefundedAmountCents,
      metadata: { billingPurpose: "platform_subscription_checkout" },
      occurredAt: new Date("2026-09-04T00:00:00.000Z"),
    });
    mocks.getPaymentProvider.mockReturnValue({ refundPayment: vi.fn().mockResolvedValue({ providerEventId: "provider-refund-1" }) });

    await expect(executePayUniRefund({ ...input, db: fixture.db as never, transactionId: "transaction-1", refundAmountCents })).resolves.toMatchObject({ disposition: "completed" });

    expect(mocks.applyPlatformRefundProjection).toHaveBeenCalledWith(
      fixture.tx,
      expect.objectContaining({ status, refundedAmountCents: expectedRefundedAmountCents }),
      expect.any(Date),
    );
  });
});
