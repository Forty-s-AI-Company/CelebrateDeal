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
      affiliateCommission: { findMany: vi.fn(async () => []) },
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

  it("reverses every promoter and upline allocation from its immutable rate snapshot", async () => {
    const commissions = [
      { id: "commission-promoter", vendorId: "vendor-1", affiliateId: "affiliate-promoter", monthKey: "2026-08", sourceType: "webhook", sourceId: "payment-1", recipientRole: "promoter", uplineLevel: null, commissionRateBps: 1000, status: "pending" },
      { id: "commission-leader", vendorId: "vendor-1", affiliateId: "affiliate-leader", monthKey: "2026-08", sourceType: "webhook", sourceId: "payment-1", recipientRole: "upline_leader", uplineLevel: 1, commissionRateBps: 200, status: "pending" },
    ];
    const entries = [
      { id: "opening-promoter", vendorId: "vendor-1", affiliateCommissionId: "commission-promoter", entryType: "accrual", providerName: "payuni", eventIdentity: "paid-1", disputeCaseId: null, amountCents: 1000, deduplicationKey: "opening-promoter" },
      { id: "opening-leader", vendorId: "vendor-1", affiliateCommissionId: "commission-leader", entryType: "accrual", providerName: "payuni", eventIdentity: "paid-1", disputeCaseId: null, amountCents: 200, deduplicationKey: "opening-leader" },
    ];
    const ledger = {
      findMany: vi.fn(async ({ where }: { where: { affiliateCommissionId: string } }) => entries.filter((entry) => entry.affiliateCommissionId === where.affiliateCommissionId)),
      findUnique: vi.fn(async () => null),
      aggregate: vi.fn(async ({ where }: { where: { affiliateCommissionId: string } }) => ({
        _sum: { amountCents: entries.filter((entry) => entry.affiliateCommissionId === where.affiliateCommissionId).reduce((sum, entry) => sum + entry.amountCents, 0) },
      })),
      create: vi.fn(async ({ data }: { data: typeof entries[number] }) => {
        const entry = { ...data, id: `entry-${entries.length + 1}` };
        entries.push(entry);
        return entry;
      }),
    };
    const db = {
      affiliateCommission: {
        findMany: vi.fn(async () => commissions),
        updateMany: vi.fn(async () => ({ count: 1 })),
        findUnique: vi.fn(async ({ where }: { where: { id: string } }) => commissions.find((item) => item.id === where.id)),
      },
      affiliateCommissionLedgerEntry: ledger,
      courseCommissionAllocation: { findMany: vi.fn(async () => []) },
    };

    await applyPaymentRefundAccounting(db as never, {
      vendorId: "vendor-1",
      transactionId: "payment-1",
      orderNumber: "CD-1",
      providerName: "payuni",
      eventIdentity: "refund-1",
      refundAmountCents: 1000,
      netReferenceAmountCents: 9000,
      isFullRefund: false,
      transactionOccurredAt: new Date("2026-08-01T00:00:00.000Z"),
      occurredAt: new Date("2026-08-08T00:00:00.000Z"),
    });

    expect(entries.filter((entry) => entry.entryType === "refund").map((entry) => entry.amountCents)).toEqual([-100, -20]);
    expect(ledger.create).toHaveBeenCalledTimes(2);
  });
});
