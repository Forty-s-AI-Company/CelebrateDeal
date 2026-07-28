import { beforeEach, describe, expect, it, vi } from "vitest";

const dependencies = vi.hoisted(() => ({
  db: {
    vendorSubscription: { findFirst: vi.fn() },
    usageRecord: { findMany: vi.fn() },
    paymentTransaction: { findMany: vi.fn() },
    refundRecord: { aggregate: vi.fn() },
    affiliateCommission: { aggregate: vi.fn() },
  },
}));

vi.mock("@/lib/db", () => ({ getDb: () => dependencies.db }));

import { calculateSettlement, invoiceNumber, monthRange } from "@/lib/billing";

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
  { grossAmountCents: 10_000, gatewayFeeCents: 300, platformFeeCents: 400 },
  { grossAmountCents: 5_000, gatewayFeeCents: 150, platformFeeCents: 200 },
];

function processedRefund(platformFeeRefundCents: number) {
  return {
    _sum: {
      refundAmountCents: 0,
      gatewayFeeRefundCents: 0,
      platformFeeRefundCents,
    },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  dependencies.db.vendorSubscription.findFirst.mockResolvedValue(subscription);
  dependencies.db.usageRecord.findMany.mockResolvedValue([]);
  dependencies.db.paymentTransaction.findMany.mockResolvedValue(transactions);
  dependencies.db.refundRecord.aggregate.mockResolvedValue(processedRefund(0));
  dependencies.db.affiliateCommission.aggregate.mockResolvedValue({
    _sum: { commissionAmountCents: 0 },
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

describe("calculateSettlement transaction service fee", () => {
  it("deducts a partial processed platform-fee refund from recorded transaction fees", async () => {
    dependencies.db.refundRecord.aggregate.mockResolvedValueOnce(processedRefund(125));

    const settlement = await calculateSettlement("vendor-1", "2026-07");

    expect(settlement.transactionServiceFeeCents).toBe(475);
  });

  it("deducts a full processed platform-fee refund from recorded transaction fees", async () => {
    dependencies.db.refundRecord.aggregate.mockResolvedValueOnce(processedRefund(600));

    const settlement = await calculateSettlement("vendor-1", "2026-07");

    expect(settlement.transactionServiceFeeCents).toBe(0);
  });

  it("does not deduct an unprocessed platform-fee refund", async () => {
    const settlement = await calculateSettlement("vendor-1", "2026-07");

    expect(settlement.transactionServiceFeeCents).toBe(600);
    expect(dependencies.db.refundRecord.aggregate).toHaveBeenCalledWith({
      where: { vendorId: "vendor-1", monthKey: "2026-07", status: "processed" },
      _sum: {
        refundAmountCents: true,
        gatewayFeeRefundCents: true,
        platformFeeRefundCents: true,
      },
    });
  });

  it("never makes transaction service fees negative when processed refunds exceed recorded fees", async () => {
    dependencies.db.refundRecord.aggregate.mockResolvedValueOnce(processedRefund(750));

    const settlement = await calculateSettlement("vendor-1", "2026-07");

    expect(settlement.transactionServiceFeeCents).toBe(0);
  });
});
