import { beforeEach, describe, expect, it, vi } from "vitest";

const dependencies = vi.hoisted(() => ({
  estimateVendorUsage: vi.fn(),
  db: {
    vendorSubscription: { findFirst: vi.fn() },
    usageRecord: { findMany: vi.fn() },
    streamUsageLedgerEntry: { findMany: vi.fn() },
    streamUsageAllocationEntry: { findMany: vi.fn() },
    streamUsageReconciliation: { findFirst: vi.fn() },
    paymentTransaction: { findMany: vi.fn() },
    refundRecord: { findMany: vi.fn() },
    affiliateCommissionLedgerEntry: { aggregate: vi.fn() },
  },
}));

vi.mock("@/lib/db", () => ({ getDb: () => dependencies.db }));
vi.mock("@/lib/usage-estimation", () => ({
  estimateVendorUsage: dependencies.estimateVendorUsage,
  MONTHLY_USAGE_SNAPSHOT_RECORD_TYPE: "monthly_usage_snapshot",
}));

import { calculateSettlement, calculateStreamUsageMinutes, invoiceDueAt, invoiceNumber, monthRange } from "@/lib/billing";

const subscription = {
  paymentMode: "platform",
  customFeeRateBps: 9_999,
  plan: {
    includedStreamMinutes: 0,
    includedEvents: 0,
    includedAffiliates: 0,
    includedStorageMinutes: 0,
    overflowWatchHourPriceCents: 0,
    overflowEventUnitPriceCents: 0,
    overflowAffiliateUnitPriceCents: 0,
    overflowStorageMinutePriceCents: 0,
    paymentServiceFeeCents: 0,
    affiliateManagementFeeCents: 0,
    monthlyPriceCents: 0,
    transactionFeeRateBps: 1,
  },
};

const transactions = [
  { grossAmountCents: 10_000, gatewayFeeCents: 300, platformFeeCents: 400, status: "paid" },
  { grossAmountCents: 5_000, gatewayFeeCents: 150, platformFeeCents: 200, status: "paid" },
];

const subscriptionWithPaidPlan = {
  ...subscription,
  id: "subscription-current",
  vendorId: "vendor-1",
  planId: "plan-current",
  plan: { ...subscription.plan, id: "plan-current", monthlyPriceCents: 1_000 },
};

function platformSubscriptionCheckout(overrides: Record<string, unknown> = {}) {
  return {
    id: "platform-checkout-1",
    vendorId: "vendor-1",
    status: "paid",
    grossAmountCents: 1_000,
    gatewayFeeCents: 30,
    platformFeeCents: 40,
    currency: "TWD",
    occurredAt: new Date("2026-07-15T00:00:00.000Z"),
    refundedAmountCents: 0,
    metadata: {
      billingPurpose: "platform_subscription_checkout",
      platformSubscriptionId: "subscription-current",
      billingPlanId: "plan-current",
    },
    ...overrides,
  };
}

function processedRefund(platformFeeRefundCents: number) {
  return [{
    refundAmountCents: 0,
    gatewayFeeRefundCents: 0,
    platformFeeRefundCents,
    paymentTransaction: { metadata: null },
  }];
}

beforeEach(() => {
  vi.clearAllMocks();
  dependencies.db.vendorSubscription.findFirst.mockResolvedValue(subscription);
  dependencies.estimateVendorUsage.mockResolvedValue({
    totalWatchMinutes: 0,
    totalEvents: 0,
    totalAffiliates: 0,
    totalStorageMinutes: 0,
  });
  dependencies.db.usageRecord.findMany.mockResolvedValue([]);
  dependencies.db.streamUsageLedgerEntry.findMany.mockResolvedValue([]);
  dependencies.db.streamUsageAllocationEntry.findMany.mockResolvedValue([]);
  dependencies.db.streamUsageReconciliation.findFirst.mockResolvedValue(null);
  dependencies.db.paymentTransaction.findMany.mockResolvedValue(transactions);
  dependencies.db.refundRecord.findMany.mockResolvedValue(processedRefund(0));
  dependencies.db.affiliateCommissionLedgerEntry.aggregate.mockResolvedValue({
    _sum: { amountCents: 0 },
  });
});

describe("monthRange", () => {
  it("builds a UTC month window from a valid key", () => {
    expect(monthRange("2026-07")).toEqual({
      start: new Date("2026-07-01T00:00:00.000Z"),
      end: new Date("2026-08-01T00:00:00.000Z"),
    });
  });

  it("falls back safely when the key does not contain numeric parts", () => {
    const currentYear = new Date().getFullYear();
    const currentMonth = new Date().getMonth();

    expect(monthRange("not-a-month")).toEqual({
      start: new Date(Date.UTC(currentYear, currentMonth, 1)),
      end: new Date(Date.UTC(currentYear, currentMonth + 1, 1)),
    });
  });
});

describe("calculateStreamUsageMinutes", () => {
  it("reconciles legacy usage aggregates with immutable ledger seconds without undercounting", () => {
    expect(calculateStreamUsageMinutes([
      { recordType: "stream_minutes", quantity: 3, totalWatchMinutes: 2 },
      { recordType: "storage_minutes", quantity: 99, totalWatchMinutes: 4 },
    ], 61)).toBe(4);
  });

  it("never turns negative or malformed ledger seconds into negative usage", () => {
    expect(calculateStreamUsageMinutes([], -1)).toBe(0);
  });
});

describe("invoiceNumber", () => {
  it("keeps invoices unique when vendor slugs share the same first twelve characters", () => {
    const first = invoiceNumber("celebrate-deal-alpha", "2026-07", "vendor-alpha");
    const second = invoiceNumber("celebrate-deal-beta", "2026-07", "vendor-beta");

    expect(first).not.toBe(second);
    expect(first).toMatch(/^INV-202607-CELEBRATE-DE-[A-F0-9]{8}$/);
  });

  it("is stable for the same vendor and month", () => {
    expect(invoiceNumber("celebrate-deal", "2026-07", "vendor-1")).toBe(
      invoiceNumber("celebrate-deal", "2026-07", "vendor-1"),
    );
  });
});

describe("invoiceDueAt", () => {
  it("uses the next month's billing cycle day", () => {
    expect(invoiceDueAt("2026-07", 5)).toEqual(new Date("2026-08-05T00:00:00.000Z"));
  });

  it("clamps a 31st billing cycle to February's last day", () => {
    expect(invoiceDueAt("2026-01", 31)).toEqual(new Date("2026-02-28T00:00:00.000Z"));
  });
});

describe("calculateSettlement transaction service fee", () => {
  it("deducts a partial processed platform-fee refund from recorded transaction fees", async () => {
    dependencies.db.refundRecord.findMany.mockResolvedValueOnce(processedRefund(125));

    const settlement = await calculateSettlement("vendor-1", "2026-07");

    expect(settlement.transactionServiceFeeCents).toBe(475);
  });

  it("deducts a full processed platform-fee refund from recorded transaction fees", async () => {
    dependencies.db.refundRecord.findMany.mockResolvedValueOnce(processedRefund(600));

    const settlement = await calculateSettlement("vendor-1", "2026-07");

    expect(settlement.transactionServiceFeeCents).toBe(0);
  });

  it("does not deduct an unprocessed platform-fee refund", async () => {
    const settlement = await calculateSettlement("vendor-1", "2026-07");

    expect(settlement.transactionServiceFeeCents).toBe(600);
    expect(dependencies.db.refundRecord.findMany).toHaveBeenCalledWith({
      where: { vendorId: "vendor-1", monthKey: "2026-07", status: "processed" },
      include: {
        paymentTransaction: {
          select: { metadata: true },
        },
      },
    });
  });

  it("never makes transaction service fees negative when processed refunds exceed recorded fees", async () => {
    dependencies.db.refundRecord.findMany.mockResolvedValueOnce(processedRefund(750));

    const settlement = await calculateSettlement("vendor-1", "2026-07");

    expect(settlement.transactionServiceFeeCents).toBe(0);
  });
});

describe("FIN-01 settlement boundary coverage", () => {
  it("fails closed when no active subscription exists", async () => {
    dependencies.db.vendorSubscription.findFirst.mockResolvedValueOnce(null);

    await expect(calculateSettlement("vendor-1", "2026-07")).rejects.toThrow(
      "找不到有效訂閱方案，無法產生月結。",
    );
  });

  it("does not create a payout amount for a non-platform payment mode", async () => {
    dependencies.db.vendorSubscription.findFirst.mockResolvedValueOnce({
      ...subscription,
      paymentMode: "byo",
    });
    dependencies.db.paymentTransaction.findMany.mockResolvedValueOnce([
      ...transactions,
      { grossAmountCents: 50_000, gatewayFeeCents: 500, platformFeeCents: 700, status: "paid" },
    ]);
    dependencies.db.affiliateCommissionLedgerEntry.aggregate.mockResolvedValueOnce({
      _sum: { amountCents: 9_999 },
    });

    const settlement = await calculateSettlement("vendor-1", "2026-07");

    expect(settlement.paymentGatewayFeeCents).toBe(0);
    expect(settlement.transactionServiceFeeCents).toBe(0);
    expect(settlement.paymentServiceFeeCents).toBe(0);
    expect(settlement.payoutableAmountCents).toBe(0);
    expect(settlement.finalPayoutAmountCents).toBe(0);
  });

  it("clamps gross revenue and gateway fees after processed refunds", async () => {
    dependencies.db.paymentTransaction.findMany.mockResolvedValueOnce([
      { grossAmountCents: 1_000, gatewayFeeCents: 300, platformFeeCents: 100, status: "paid" },
    ]);
    dependencies.db.refundRecord.findMany.mockResolvedValueOnce([{
      refundAmountCents: 1_500,
      gatewayFeeRefundCents: 450,
      platformFeeRefundCents: 50,
      paymentTransaction: { metadata: null },
    }]);

    const settlement = await calculateSettlement("vendor-1", "2026-07");

    expect(settlement.grossRevenueCents).toBe(0);
    expect(settlement.paymentGatewayFeeCents).toBe(0);
    expect(settlement.transactionServiceFeeCents).toBe(50);
  });

  it("excludes platform checkout and invoice collections, including their refunds, from merchant payout", async () => {
    dependencies.db.vendorSubscription.findFirst.mockResolvedValueOnce(subscriptionWithPaidPlan);
    dependencies.db.paymentTransaction.findMany.mockResolvedValueOnce([
      { grossAmountCents: 10_000, gatewayFeeCents: 300, platformFeeCents: 400, status: "paid", metadata: null },
      platformSubscriptionCheckout(),
      {
        grossAmountCents: 2_000,
        gatewayFeeCents: 60,
        platformFeeCents: 80,
        status: "paid",
        metadata: { billingPurpose: "invoice_payment" },
      },
    ]);
    dependencies.db.refundRecord.findMany.mockResolvedValueOnce([
      {
        refundAmountCents: 1_000,
        gatewayFeeRefundCents: 30,
        platformFeeRefundCents: 40,
        paymentTransaction: { metadata: null },
      },
      {
        refundAmountCents: 1_000,
        gatewayFeeRefundCents: 30,
        platformFeeRefundCents: 40,
        paymentTransaction: { metadata: { billingPurpose: "platform_subscription_checkout" } },
      },
      {
        refundAmountCents: 2_000,
        gatewayFeeRefundCents: 60,
        platformFeeRefundCents: 80,
        paymentTransaction: { metadata: { billingPurpose: "invoice_payment" } },
      },
    ]);

    const settlement = await calculateSettlement("vendor-1", "2026-07");

    expect(settlement).toMatchObject({
      grossRevenueBeforeRefundCents: 10_000,
      refundAmountCents: 1_000,
      gatewayFeeRefundCents: 30,
      platformFeeRefundCents: 40,
      grossRevenueCents: 9_000,
      paymentGatewayFeeCents: 270,
      transactionServiceFeeCents: 360,
      payoutableAmountCents: 8_370,
    });
  });

  it("credits the first month only when exactly one complete platform checkout was paid", async () => {
    dependencies.db.vendorSubscription.findFirst.mockResolvedValueOnce(subscriptionWithPaidPlan);
    dependencies.db.paymentTransaction.findMany.mockResolvedValueOnce([platformSubscriptionCheckout()]);

    const settlement = await calculateSettlement("vendor-1", "2026-07");

    expect(settlement.monthlyFeeCents).toBe(0);
  });

  it("charges the fixed SaaS fee again in the following month without an in-period checkout", async () => {
    dependencies.db.vendorSubscription.findFirst.mockResolvedValueOnce(subscriptionWithPaidPlan);
    dependencies.db.paymentTransaction.findMany.mockResolvedValueOnce([]);

    const settlement = await calculateSettlement("vendor-1", "2026-08");

    expect(settlement.monthlyFeeCents).toBe(1_000);
  });

  it("fails closed when the month contains duplicate platform subscription checkouts", async () => {
    dependencies.db.vendorSubscription.findFirst.mockResolvedValueOnce(subscriptionWithPaidPlan);
    dependencies.db.paymentTransaction.findMany.mockResolvedValueOnce([
      platformSubscriptionCheckout(),
      platformSubscriptionCheckout({ occurredAt: new Date("2026-07-16T00:00:00.000Z") }),
    ]);

    await expect(calculateSettlement("vendor-1", "2026-07")).rejects.toMatchObject({
      code: "platform_subscription_monthly_fee_credit_conflict",
    });
  });

  it.each(["partially_refunded", "refunded"])("fails closed when the platform checkout is %s", async (status) => {
    dependencies.db.vendorSubscription.findFirst.mockResolvedValueOnce(subscriptionWithPaidPlan);
    dependencies.db.paymentTransaction.findMany.mockResolvedValueOnce([
      platformSubscriptionCheckout({ status, refundedAmountCents: 1 }),
    ]);

    await expect(calculateSettlement("vendor-1", "2026-07")).rejects.toMatchObject({
      code: "platform_subscription_monthly_fee_credit_conflict",
    });
  });

  it.each([
    platformSubscriptionCheckout({ metadata: { billingPurpose: "platform_subscription_checkout", platformSubscriptionId: "subscription-old", billingPlanId: "plan-current" } }),
    platformSubscriptionCheckout({ metadata: { billingPurpose: "platform_subscription_checkout", platformSubscriptionId: "subscription-current", billingPlanId: "plan-old" } }),
    platformSubscriptionCheckout({ grossAmountCents: 999 }),
    platformSubscriptionCheckout({ currency: "USD" }),
  ])("fails closed when platform checkout identity or price evidence is invalid", async (checkout) => {
    dependencies.db.vendorSubscription.findFirst.mockResolvedValueOnce(subscriptionWithPaidPlan);
    dependencies.db.paymentTransaction.findMany.mockResolvedValueOnce([checkout]);

    await expect(calculateSettlement("vendor-1", "2026-07")).rejects.toMatchObject({
      code: "platform_subscription_monthly_fee_credit_conflict",
    });
  });

  it.each(["pending", "failed"])("fails closed for a %s checkout that could be paid later", async (status) => {
    dependencies.db.vendorSubscription.findFirst.mockResolvedValueOnce(subscriptionWithPaidPlan);
    dependencies.db.paymentTransaction.findMany.mockResolvedValueOnce([platformSubscriptionCheckout({ status })]);

    await expect(calculateSettlement("vendor-1", "2026-07")).rejects.toMatchObject({
      code: "platform_subscription_monthly_fee_credit_conflict",
    });
  });

  it("charges WatchMinutes, Events, Affiliates, and StorageMinutes overages on new billing", async () => {
    dependencies.db.usageRecord.findMany.mockResolvedValueOnce([
      {
        recordType: "stream_minutes",
        quantity: 6_100,
        totalWatchMinutes: 5_000,
        totalEvents: 12,
        totalAffiliates: 4,
        totalStorageMinutes: 2_000,
      },
      {
        recordType: "storage_minutes",
        quantity: 7_200,
        totalWatchMinutes: 5_500,
        totalEvents: 15,
        totalAffiliates: 8,
        totalStorageMinutes: 6_000,
      },
    ]);
    dependencies.db.paymentTransaction.findMany.mockResolvedValueOnce([]);
    dependencies.db.vendorSubscription.findFirst.mockResolvedValueOnce({
      ...subscription,
      plan: {
        ...subscription.plan,
        overflowWatchHourPriceCents: 100,
        overflowEventUnitPriceCents: 200,
        overflowAffiliateUnitPriceCents: 300,
        overflowStorageMinutePriceCents: 1,
      },
    });

    const settlement = await calculateSettlement("vendor-1", "2026-07");

    expect(settlement.totals).toEqual({
      totalWatchMinutes: 6_100,
      totalEvents: 15,
      totalAffiliates: 8,
      totalStorageMinutes: 7_200,
    });
    expect(settlement.overflowWatchMinutes).toBe(6_100);
    expect(settlement.overflowEvents).toBe(15);
    expect(settlement.overflowAffiliates).toBe(8);
    expect(settlement.overflowStorageMinutes).toBe(7_200);
    // Watch 200 + events 400 + affiliates 300 + storage 7,200.
    expect(settlement.overflowFeeCents).toBe(8_100);
  });

  it("includes the immutable page/member stream ledger without double-counting aggregates", async () => {
    dependencies.db.usageRecord.findMany.mockResolvedValueOnce([]);
    dependencies.db.streamUsageLedgerEntry.findMany.mockResolvedValueOnce([
      { watchSeconds: 60 },
      { watchSeconds: 45 },
    ]);

    const settlement = await calculateSettlement("vendor-1", "2026-07");

    expect(settlement.totals.totalWatchMinutes).toBe(2);
    expect(dependencies.db.streamUsageLedgerEntry.findMany).toHaveBeenCalledWith({
      where: { vendorId: "vendor-1", monthKey: "2026-07" },
      select: { watchSeconds: true },
    });
  });

  it("uses the current server-owned usage estimate when legacy records are absent", async () => {
    dependencies.db.usageRecord.findMany.mockResolvedValueOnce([]);
    dependencies.estimateVendorUsage.mockResolvedValueOnce({
      totalWatchMinutes: 12,
      totalEvents: 15,
      totalAffiliates: 4,
      totalStorageMinutes: 28,
    });

    const settlement = await calculateSettlement("vendor-1", "2026-07");

    expect(settlement.totals).toEqual({
      totalWatchMinutes: 12,
      totalEvents: 15,
      totalAffiliates: 4,
      totalStorageMinutes: 28,
    });
    expect(dependencies.estimateVendorUsage).toHaveBeenCalledWith("vendor-1", "2026-07");
  });

  it("returns internal stream allocation totals without changing provider aggregate usage", async () => {
    dependencies.db.usageRecord.findMany.mockResolvedValueOnce([]);
    dependencies.db.streamUsageLedgerEntry.findMany.mockResolvedValueOnce([{ watchSeconds: 60 }]);
    dependencies.db.streamUsageAllocationEntry.findMany.mockResolvedValueOnce([
      { recipientKey: "MEMBERSHIP:team-1:owner-1", recipientType: "MEMBERSHIP", recipientMembershipId: "owner-1", allocatedWatchSeconds: 18 },
      { recipientKey: "MEMBERSHIP:team-1:promoter-1", recipientType: "MEMBERSHIP", recipientMembershipId: "promoter-1", allocatedWatchSeconds: 42 },
    ]);

    const settlement = await calculateSettlement("vendor-1", "2026-07");

    expect(settlement.totals.totalWatchMinutes).toBe(1);
    expect(settlement.internalStreamUsageAllocations).toEqual([
      { recipientKey: "MEMBERSHIP:team-1:owner-1", recipientType: "MEMBERSHIP", recipientMembershipId: "owner-1", allocatedWatchSeconds: 18 },
      { recipientKey: "MEMBERSHIP:team-1:promoter-1", recipientType: "MEMBERSHIP", recipientMembershipId: "promoter-1", allocatedWatchSeconds: 42 },
    ]);
    expect(dependencies.db.streamUsageAllocationEntry.findMany).toHaveBeenCalledWith({
      where: { vendorId: "vendor-1", monthKey: "2026-07" },
      select: {
        recipientKey: true,
        recipientType: true,
        recipientMembershipId: true,
        allocatedWatchSeconds: true,
      },
    });
  });

  it("keeps provider settlement usable while explicitly exposing a pending allocation migration", async () => {
    dependencies.db.usageRecord.findMany.mockResolvedValueOnce([]);
    dependencies.db.streamUsageLedgerEntry.findMany.mockResolvedValueOnce([{ watchSeconds: 60 }]);
    dependencies.db.streamUsageAllocationEntry.findMany.mockRejectedValueOnce({ code: "P2021" });

    const settlement = await calculateSettlement("vendor-1", "2026-07");

    expect(settlement.totals.totalWatchMinutes).toBe(1);
    expect(settlement.internalStreamUsageAllocations).toEqual([]);
    expect(settlement.internalStreamUsageAllocationStatus).toBe("MIGRATION_REQUIRED");
  });

  it("uses an explicitly accepted provider snapshot as the authoritative Stream billing total", async () => {
    dependencies.db.usageRecord.findMany.mockResolvedValueOnce([{
      recordType: "stream_minutes",
      quantity: 180,
      totalWatchMinutes: 180,
      totalEvents: 2,
      totalAffiliates: 1,
      totalStorageMinutes: 90,
    }]);
    dependencies.db.streamUsageReconciliation.findFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
      id: "provider-resolution",
      status: "RESOLVED",
      resolution: "ACCEPT_PROVIDER",
      providerWatchMinutes: 120,
      providerStorageMinutes: 75,
      });

    const settlement = await calculateSettlement("vendor-1", "2026-07");

    expect(settlement.totals.totalWatchMinutes).toBe(120);
    expect(settlement.totals.totalStorageMinutes).toBe(75);
    expect(settlement.totals.totalEvents).toBe(2);
    expect(settlement.streamUsageReconciliationStatus).toBe("ACCEPT_PROVIDER");
    expect(settlement.streamUsageReconciliationId).toBe("provider-resolution");
  });

  it("keeps internal usage authoritative after an explicit ACCEPT_INTERNAL resolution", async () => {
    dependencies.db.streamUsageLedgerEntry.findMany.mockResolvedValueOnce([{ watchSeconds: 7_200 }]);
    dependencies.db.streamUsageReconciliation.findFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
      id: "internal-resolution",
      status: "RESOLVED",
      resolution: "ACCEPT_INTERNAL",
      providerWatchMinutes: 80,
      providerStorageMinutes: null,
      });

    const settlement = await calculateSettlement("vendor-1", "2026-07");

    expect(settlement.totals.totalWatchMinutes).toBe(120);
    expect(settlement.streamUsageReconciliationStatus).toBe("ACCEPT_INTERNAL");
  });

  it.each([
    { status: "MISMATCH", resolution: null },
    { status: "RESOLVED", resolution: "ESCALATED" },
  ])("fails closed when a known provider discrepancy still requires review", async (reconciliation) => {
    dependencies.db.streamUsageReconciliation.findFirst.mockResolvedValueOnce({
      ...reconciliation,
      providerWatchMinutes: 80,
      providerStorageMinutes: null,
    });

    await expect(calculateSettlement("vendor-1", "2026-07")).rejects.toMatchObject({
      name: "StreamUsageReconciliationRequiredError",
      code: "stream_reconciliation_required",
    });
  });

  it("keeps the pre-migration billing path explicit during a rolling deployment", async () => {
    dependencies.db.streamUsageReconciliation.findFirst.mockRejectedValueOnce({ code: "P2021" });

    const settlement = await calculateSettlement("vendor-1", "2026-07");

    expect(settlement.streamUsageReconciliationStatus).toBe("MIGRATION_REQUIRED");
  });

  it("does not let a newer matched digest hide an older unresolved mismatch", async () => {
    dependencies.db.streamUsageReconciliation.findFirst.mockResolvedValueOnce({ id: "older-mismatch" });

    await expect(calculateSettlement("vendor-1", "2026-07")).rejects.toMatchObject({
      code: "stream_reconciliation_required",
    });
    expect(dependencies.db.streamUsageReconciliation.findFirst).toHaveBeenCalledWith({
      where: {
        vendorId: "vendor-1",
        monthKey: "2026-07",
        OR: [
          { status: "MISMATCH" },
          { status: "RESOLVED", resolution: "ESCALATED" },
        ],
      },
      select: { id: true },
    });
  });
});
