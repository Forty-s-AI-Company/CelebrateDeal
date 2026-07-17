import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireVendor: vi.fn(),
  findUnique: vi.fn(),
  usageRecordFindMany: vi.fn(),
  subscriptionFindFirst: vi.fn(),
  transactionFindMany: vi.fn(),
  refundRecordAggregate: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({ requireVendor: mocks.requireVendor }));
vi.mock("@/lib/db", () => ({
  getDb: () => ({
    vendorUsageLimit: { findUnique: mocks.findUnique },
    usageRecord: { findMany: mocks.usageRecordFindMany },
    vendorSubscription: { findFirst: mocks.subscriptionFindFirst },
    paymentTransaction: { findMany: mocks.transactionFindMany },
    refundRecord: { aggregate: mocks.refundRecordAggregate },
  }),
}));

import BillingUsagePage from "./page";

const currentVendor = { id: "vendor-current" };
const transactions = [
  { id: "paid-at-start", vendorId: "vendor-current", status: "paid", occurredAt: new Date("2026-07-01T00:00:00.000Z"), grossAmountCents: 10000, refundedAmountCents: 0, platformFeeCents: 500 },
  { id: "partially-refunded-before-end", vendorId: "vendor-current", status: "partially_refunded", occurredAt: new Date("2026-07-31T23:59:59.999Z"), grossAmountCents: 5400, refundedAmountCents: 1400, platformFeeCents: 300 },
  { id: "fully-refunded", vendorId: "vendor-current", status: "refunded", occurredAt: new Date("2026-07-15T00:00:00.000Z"), grossAmountCents: 3000, refundedAmountCents: 3000, platformFeeCents: 100 },
  { id: "over-refunded", vendorId: "vendor-current", status: "refunded", occurredAt: new Date("2026-07-16T00:00:00.000Z"), grossAmountCents: 2000, refundedAmountCents: 9999, platformFeeCents: 100 },
  { id: "other-vendor", vendorId: "vendor-other", status: "paid", occurredAt: new Date("2026-07-15T00:00:00.000Z"), grossAmountCents: 100000, refundedAmountCents: 0, platformFeeCents: 5000 },
  { id: "pending", vendorId: "vendor-current", status: "pending", occurredAt: new Date("2026-07-15T00:00:00.000Z"), grossAmountCents: 200000, refundedAmountCents: 0, platformFeeCents: 10000 },
  { id: "previous-month", vendorId: "vendor-current", status: "refunded", occurredAt: new Date("2026-06-30T23:59:59.999Z"), grossAmountCents: 300000, refundedAmountCents: 0, platformFeeCents: 15000 },
  { id: "next-month", vendorId: "vendor-current", status: "paid", occurredAt: new Date("2026-08-01T00:00:00.000Z"), grossAmountCents: 400000, refundedAmountCents: 0, platformFeeCents: 20000 },
];

const refunds = [
  { id: "partial-refund", vendorId: "vendor-current", monthKey: "2026-07", status: "processed", platformFeeRefundCents: 120 },
  { id: "full-refund", vendorId: "vendor-current", monthKey: "2026-07", status: "processed", platformFeeRefundCents: 100 },
  { id: "other-vendor-refund", vendorId: "vendor-other", monthKey: "2026-07", status: "processed", platformFeeRefundCents: 5000 },
  { id: "previous-month-refund", vendorId: "vendor-current", monthKey: "2026-06", status: "processed", platformFeeRefundCents: 5000 },
  { id: "pending-refund", vendorId: "vendor-current", monthKey: "2026-07", status: "pending", platformFeeRefundCents: 5000 },
];

const previousMonthRecord = {
  id: "usage-june-latest",
  vendorId: currentVendor.id,
  monthKey: "2026-06",
  recordType: "event",
  quantity: 99,
  unit: "場",
  creditsDelta: 0,
  totalEvents: 99,
  description: "上月紀錄",
  createdAt: new Date("2026-07-18T11:00:00.000Z"),
};

const currentMonthRecord = {
  ...previousMonthRecord,
  id: "usage-july-current",
  monthKey: "2026-07",
  quantity: 5,
  totalEvents: 5,
  description: "本月紀錄",
  createdAt: new Date("2026-07-01T00:00:00.000Z"),
};

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-07-18T12:00:00.000Z"));
  vi.clearAllMocks();
  mocks.requireVendor.mockResolvedValue(currentVendor);
  mocks.findUnique.mockResolvedValue(null);
  mocks.usageRecordFindMany.mockImplementation(async ({ where }) => {
    if (where.monthKey === "2026-07") return [currentMonthRecord];
    return [previousMonthRecord, currentMonthRecord];
  });
  mocks.subscriptionFindFirst.mockResolvedValue(null);
  mocks.transactionFindMany.mockImplementation(async ({ where }) =>
    transactions.filter((transaction) =>
      transaction.vendorId === where.vendorId &&
      where.status.in.includes(transaction.status) &&
      transaction.occurredAt >= where.occurredAt.gte &&
      transaction.occurredAt < where.occurredAt.lt,
    ),
  );
  mocks.refundRecordAggregate.mockImplementation(async ({ where }) => ({
    _sum: {
      platformFeeRefundCents: refunds
        .filter((refund) =>
          refund.vendorId === where.vendorId &&
          refund.monthKey === where.monthKey &&
          refund.status === where.status,
        )
        .reduce((sum, refund) => sum + refund.platformFeeRefundCents, 0),
    },
  }));
});

afterEach(() => {
  vi.useRealTimers();
});

describe("/billing/usage route", () => {
  it("queries the current vendor's completed transactions in the current month's half-open interval", async () => {
    await BillingUsagePage();

    expect(mocks.requireVendor).toHaveBeenCalledOnce();
    expect(mocks.transactionFindMany).toHaveBeenCalledWith({
      where: {
        vendorId: currentVendor.id,
        status: { in: ["paid", "partially_refunded", "refunded"] },
        occurredAt: {
          gte: new Date("2026-07-01T00:00:00.000Z"),
          lt: new Date("2026-08-01T00:00:00.000Z"),
        },
      },
      orderBy: { occurredAt: "desc" },
    });
  });

  it("queries processed platform fee returns for only the current vendor and month", async () => {
    await BillingUsagePage();

    expect(mocks.refundRecordAggregate).toHaveBeenCalledWith({
      where: { vendorId: currentVendor.id, monthKey: "2026-07", status: "processed" },
      _sum: { platformFeeRefundCents: true },
    });
  });

  it("queries this vendor's current-month usage record while keeping the history query unchanged", async () => {
    await BillingUsagePage();

    expect(mocks.usageRecordFindMany).toHaveBeenNthCalledWith(1, {
      where: { vendorId: currentVendor.id },
      orderBy: { createdAt: "desc" },
      take: 20,
    });
    expect(mocks.usageRecordFindMany).toHaveBeenNthCalledWith(2, {
      where: { vendorId: currentVendor.id, monthKey: "2026-07" },
      orderBy: { createdAt: "desc" },
      take: 1,
    });
  });

  it("does not display the latest previous-month usage record as this month's event count", async () => {
    const html = renderToStaticMarkup(await BillingUsagePage());

    expect(html).toMatch(/本月活動場次<\/p><p[^>]*>5<\/p>/);
    expect(html).not.toMatch(/本月活動場次<\/p><p[^>]*>99<\/p>/);
    expect(html).toContain("上月紀錄");
  });

  it("deducts partial and full processed refund platform fees without including other vendors or months", async () => {
    const html = renderToStaticMarkup(await BillingUsagePage());

    expect(html).toMatch(/預估交易服務費<\/p><p[^>]*>\$8<\/p>/);
  });

  it("renders net revenue and never lets excessive processed refund platform fees make the estimate negative", async () => {
    mocks.refundRecordAggregate.mockResolvedValueOnce({
      _sum: { platformFeeRefundCents: 1120 },
    });

    const html = renderToStaticMarkup(await BillingUsagePage());

    expect(html).toContain("本月成交額");
    expect(html).toContain("預估交易服務費");
    expect(html).toMatch(/本月成交額<\/p><p[^>]*>\$140<\/p>/);
    expect(html).toMatch(/預估交易服務費<\/p><p[^>]*>\$0<\/p>/);
    expect(html).not.toContain("$154");
    expect(html).not.toContain("$10,140");
    expect(html).not.toContain("$510");
    expect(html).not.toContain("-$");
  });
});
