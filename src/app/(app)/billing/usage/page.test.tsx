import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireVendorFinance: vi.fn(),
  findUnique: vi.fn(),
  usageRecordFindMany: vi.fn(),
  streamUsageLedgerFindMany: vi.fn(),
  streamUsageAllocationGroupBy: vi.fn(),
  streamUsagePageGroupBy: vi.fn(),
  teamMembershipFindMany: vi.fn(),
  partnerFunnelPageFindMany: vi.fn(),
  subscriptionFindFirst: vi.fn(),
  transactionFindMany: vi.fn(),
  refundRecordAggregate: vi.fn(),
  streamUsageReconciliationFindFirst: vi.fn(),
  streamOperationsAlertFindMany: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({ requireVendorFinance: mocks.requireVendorFinance }));
vi.mock("@/lib/db", () => ({
  getDb: () => ({
    vendorUsageLimit: { findUnique: mocks.findUnique },
    usageRecord: { findMany: mocks.usageRecordFindMany },
    streamUsageLedgerEntry: { findMany: mocks.streamUsageLedgerFindMany, groupBy: mocks.streamUsagePageGroupBy },
    streamUsageAllocationEntry: { groupBy: mocks.streamUsageAllocationGroupBy },
    partnerFunnelPage: { findMany: mocks.partnerFunnelPageFindMany },
    teamMembership: { findMany: mocks.teamMembershipFindMany },
    vendorSubscription: { findFirst: mocks.subscriptionFindFirst },
    paymentTransaction: { findMany: mocks.transactionFindMany },
    refundRecord: { aggregate: mocks.refundRecordAggregate },
    streamUsageReconciliation: { findFirst: mocks.streamUsageReconciliationFindFirst },
    streamOperationsAlert: { findMany: mocks.streamOperationsAlertFindMany },
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
  totalWatchMinutes: 0,
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
  mocks.requireVendorFinance.mockResolvedValue({ vendor: currentVendor });
  mocks.findUnique.mockResolvedValue(null);
  mocks.usageRecordFindMany.mockImplementation(async ({ where }) => {
    if (where.monthKey === "2026-07") return [currentMonthRecord];
    return [previousMonthRecord, currentMonthRecord];
  });
  mocks.streamUsageLedgerFindMany.mockResolvedValue([]);
  mocks.streamUsageAllocationGroupBy.mockResolvedValue([]);
  mocks.streamUsagePageGroupBy.mockResolvedValue([]);
  mocks.teamMembershipFindMany.mockResolvedValue([]);
  mocks.partnerFunnelPageFindMany.mockResolvedValue([]);
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
  mocks.streamUsageReconciliationFindFirst.mockResolvedValue(null);
  mocks.streamOperationsAlertFindMany.mockResolvedValue([]);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("/billing/usage route", () => {
  it("queries the current vendor's completed transactions in the current month's half-open interval", async () => {
    await BillingUsagePage();

    expect(mocks.requireVendorFinance).toHaveBeenCalledExactlyOnceWith("/billing/usage");
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
      take: 20,
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

  it("reconciles immutable stream ledger seconds instead of trusting a stale usage counter", async () => {
    mocks.findUnique.mockResolvedValueOnce({
      streamMinutesUsed: 1,
      streamMinutesLimit: 100,
      storageMinutesUsed: 0,
      storageMinutesLimit: 100,
      creditsUsed: 0,
      creditsLimit: 100,
      billingPlan: null,
    });
    mocks.streamUsageLedgerFindMany.mockResolvedValueOnce([{ watchSeconds: 61 }]);

    const html = renderToStaticMarkup(await BillingUsagePage());

    expect(html).toContain("2 / 100 分鐘");
  });

  it("shows an explicit overage state instead of a negative remaining quota", async () => {
    mocks.findUnique.mockResolvedValueOnce({
      streamMinutesUsed: 150,
      streamMinutesLimit: 100,
      storageMinutesUsed: 0,
      storageMinutesLimit: 100,
      creditsUsed: 0,
      creditsLimit: 100,
      billingPlan: null,
    });

    const html = renderToStaticMarkup(await BillingUsagePage());

    expect(html).toContain("已超額 50 分鐘");
    expect(html).toContain("查看帳單／手動付款");
    expect(html).toContain('href="/billing/invoices"');
    expect(html).toContain('href="/billing/plans"');
    expect(html).not.toContain("剩餘 -50 分鐘");
  });

  it("shows the deterministic 80 percent Stream quota notification", async () => {
    mocks.findUnique.mockResolvedValueOnce({
      streamMinutesUsed: 80,
      streamMinutesLimit: 100,
      storageMinutesUsed: 0,
      storageMinutesLimit: 0,
      creditsUsed: 0,
      creditsLimit: 0,
      billingPlan: null,
    });

    const html = renderToStaticMarkup(await BillingUsagePage());

    expect(html).toContain("Stream 額度已達 80%");
    expect(html).toContain("請通知付款人與相關成員");
  });

  it("queries and renders only this vendor's current-month provider reconciliation and unresolved alerts", async () => {
    mocks.streamUsageReconciliationFindFirst.mockResolvedValueOnce({
      id: "reconciliation-1",
      provider: "CLOUDFLARE",
      providerWatchMinutes: 125,
      internalWatchMinutes: 100,
      differenceMinutes: 25,
      status: "MISMATCH",
      evidenceKind: "ADMIN_ATTESTED_DIGEST",
      sourceDigest: "a".repeat(64),
      resolution: null,
      capturedAt: new Date("2026-07-31T23:59:59.000Z"),
      createdAt: new Date("2026-08-01T00:00:00.000Z"),
    });
    mocks.streamOperationsAlertFindMany.mockResolvedValueOnce([{
      id: "alert-1",
      type: "PROVIDER_DISCREPANCY",
      status: "OPEN",
      severity: "CRITICAL",
      message: "Provider delivered minutes differ from the internal ledger.",
      createdAt: new Date("2026-08-01T00:00:00.000Z"),
    }]);

    const html = renderToStaticMarkup(await BillingUsagePage());

    expect(mocks.streamUsageReconciliationFindFirst).toHaveBeenCalledWith({
      where: { vendorId: "vendor-current", monthKey: "2026-07" },
      orderBy: { createdAt: "desc" },
      select: expect.objectContaining({ sourceDigest: true, providerWatchMinutes: true, internalWatchMinutes: true }),
    });
    expect(mocks.streamOperationsAlertFindMany).toHaveBeenCalledWith({
      where: { vendorId: "vendor-current", monthKey: "2026-07", status: { not: "RESOLVED" } },
      orderBy: [{ severity: "desc" }, { createdAt: "desc" }],
      take: 10,
      select: { id: true, type: true, status: true, severity: true, message: true, createdAt: true },
    });
    expect(html).toContain("Stream provider 對帳");
    expect(html).toContain("125 分鐘");
    expect(html).toContain("100 分鐘");
    expect(html).toContain("+25 分鐘");
    expect(html).toContain("平台管理員核對的摘要雜湊（不是 provider 簽章）");
    expect(html).toContain("Provider delivered minutes differ from the internal ledger.");
    expect(html).toContain('role="alert"');
  });

  it("does not mislabel missing provider evidence as reconciled", async () => {
    const html = renderToStaticMarkup(await BillingUsagePage());

    expect(html).toContain("尚未匯入");
    expect(html).toContain("這不等同 Cloudflare 帳單已驗證");
    expect(html).not.toContain("provider 對帳已通過");
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

  it("shows current-month member and page attribution from immutable stream allocation groups", async () => {
    mocks.streamUsageAllocationGroupBy.mockResolvedValueOnce([
      {
        recipientKey: "MEMBERSHIP:team-1:member-1",
        recipientType: "MEMBERSHIP",
        recipientTeamId: "team-1",
        recipientMembershipId: "member-1",
        _sum: { allocatedWatchSeconds: 120 },
      },
    ]);
    mocks.streamUsagePageGroupBy.mockResolvedValueOnce([
      { sourcePageId: "page-1", _sum: { watchSeconds: 120 } },
      { sourcePageId: null, _sum: { watchSeconds: 60 } },
    ]);
    mocks.teamMembershipFindMany.mockResolvedValueOnce([
      { id: "member-1", vendorMember: { user: { name: "推廣成員 A" } } },
    ]);
    mocks.partnerFunnelPageFindMany.mockResolvedValueOnce([
      { id: "page-1", slug: "partner-page", headline: "合作推廣頁" },
    ]);

    const html = renderToStaticMarkup(await BillingUsagePage());

    expect(html).toContain("Stream 歸屬用量");
    expect(html).toContain("推廣成員 A");
    expect(html).toContain("合作推廣頁");
    expect(html).toContain("直接播放（未指定推廣頁）");
    expect(html).toContain("120 秒（約 2 分鐘）");
    expect(html).toContain("商家 vendor aggregate enforce");
  });
});
