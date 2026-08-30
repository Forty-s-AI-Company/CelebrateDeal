import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireVendorFinance: vi.fn(),
  payoutFindFirst: vi.fn(),
  commissionFindMany: vi.fn(),
  commissionAggregate: vi.fn(),
  ledgerAggregate: vi.fn(),
  ledgerGroupBy: vi.fn(),
  ledgerFindMany: vi.fn(),
  notFound: vi.fn(() => { throw new Error("not-found"); }),
}));

vi.mock("@/lib/auth", () => ({ requireVendorFinance: mocks.requireVendorFinance }));
vi.mock("@/lib/db", () => ({ getDb: () => ({
  affiliatePayout: { findFirst: mocks.payoutFindFirst },
  affiliateCommission: { findMany: mocks.commissionFindMany, aggregate: mocks.commissionAggregate },
  affiliateCommissionLedgerEntry: {
    aggregate: mocks.ledgerAggregate,
    groupBy: mocks.ledgerGroupBy,
    findMany: mocks.ledgerFindMany,
  },
}) }));
vi.mock("next/navigation", () => ({ notFound: mocks.notFound }));

import AffiliatePayoutDetailPage from "./page";

const payout = {
  id: "affiliate-payout-current",
  vendorId: "vendor-current",
  affiliateId: "affiliate-current",
  monthKey: "2026-07",
  commissionAmountCents: 400,
  adjustmentAmountCents: 0,
  finalAmountCents: 400,
  grossSalesAmountCents: 10_000,
  netReferenceAmountCents: 8_600,
  status: "paid",
  payoutItemId: null,
  outcomeReference: "affiliate-transfer-reference",
  outcomeReason: "synthetic merchant payment note",
  paidAt: new Date("2026-08-02T00:00:00.000Z"),
  affiliate: { id: "affiliate-current", name: "推廣夥伴", code: "PARTNER-1" },
};
const commissions = [{
  id: "commission-current",
  vendorId: "vendor-current",
  affiliateId: "affiliate-current",
  monthKey: "2026-07",
  sourceType: "webhook",
  referralCode: "PARTNER-1",
  orderNumber: "ORDER-SYNTHETIC",
  commissionBaseAmountCents: 10_000,
  netReferenceAmountCents: 8_600,
  commissionRateBps: 500,
  commissionAmountCents: 500,
  status: "paid",
  attributedAt: new Date("2026-07-02T00:00:00.000Z"),
}];
const ledgerEntries = [
  { id: "ledger-accrual", affiliateCommissionId: "commission-current", entryType: "accrual", amountCents: 500, providerName: "synthetic", eventIdentity: "sale-1", disputeCaseId: null, occurredAt: new Date("2026-07-02T00:00:00.000Z") },
  { id: "ledger-dispute", affiliateCommissionId: "commission-current", entryType: "dispute_lost", amountCents: -100, providerName: "synthetic", eventIdentity: "dispute-1", disputeCaseId: "case-123", occurredAt: new Date("2026-07-03T00:00:00.000Z") },
];

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireVendorFinance.mockResolvedValue({ vendor: { id: "vendor-current" } });
  mocks.payoutFindFirst.mockResolvedValue(payout);
  mocks.commissionFindMany.mockResolvedValue(commissions);
  mocks.commissionAggregate.mockResolvedValue({ _sum: { commissionBaseAmountCents: 10_000, netReferenceAmountCents: 8_600 } });
  mocks.ledgerAggregate.mockResolvedValue({ _sum: { amountCents: 400 } });
  mocks.ledgerGroupBy.mockResolvedValue([{ affiliateCommissionId: "commission-current", _sum: { amountCents: 400 } }]);
  mocks.ledgerFindMany.mockResolvedValue(ledgerEntries);
});

describe("/affiliates/commissions/[id]", () => {
  it("binds payout, commission and ledger queries to the current vendor, affiliate and month", async () => {
    await AffiliatePayoutDetailPage({ params: Promise.resolve({ id: payout.id }) });

    const scope = { vendorId: "vendor-current", affiliateId: "affiliate-current", monthKey: "2026-07" };
    expect(mocks.requireVendorFinance).toHaveBeenCalledExactlyOnceWith(`/affiliates/commissions/${payout.id}`);
    expect(mocks.payoutFindFirst).toHaveBeenCalledWith({
      where: { id: payout.id, vendorId: "vendor-current" },
      include: { affiliate: { select: { id: true, name: true, code: true } } },
    });
    expect(mocks.commissionFindMany).toHaveBeenCalledWith({
      where: scope,
      orderBy: [{ attributedAt: "desc" }, { id: "desc" }],
      take: 251,
    });
    expect(mocks.ledgerAggregate).toHaveBeenCalledWith({
      where: { vendorId: "vendor-current", commission: scope },
      _sum: { amountCents: true },
    });
    expect(mocks.ledgerGroupBy).toHaveBeenCalledWith({
      by: ["affiliateCommissionId"],
      where: { vendorId: "vendor-current", affiliateCommissionId: { in: ["commission-current"] } },
      _sum: { amountCents: true },
    });
    expect(mocks.ledgerFindMany).toHaveBeenCalledWith({
      where: { vendorId: "vendor-current", affiliateCommissionId: { in: ["commission-current"] } },
      orderBy: [{ occurredAt: "asc" }, { id: "asc" }],
      take: 501,
    });
    expect(mocks.commissionAggregate).toHaveBeenCalledWith({
      where: scope,
      _sum: { commissionBaseAmountCents: true, netReferenceAmountCents: true },
    });
  });

  it("renders payout notes, refund-dispute ledger and exact reconciliation without mutation controls", async () => {
    const html = renderToStaticMarkup(await AffiliatePayoutDetailPage({ params: Promise.resolve({ id: payout.id }) }));

    expect(html).toContain("推廣夥伴");
    expect(html).toContain("ORDER-SYNTHETIC");
    expect(html).toContain("affiliate-transfer-reference");
    expect(html).toContain("synthetic merchant payment note");
    expect(html).toContain("dispute_lost");
    expect(html).toContain("dispute-1");
    expect(html).toContain("case-123");
    expect(html).toContain("金額一致");
    expect(html).not.toContain("<form");
  });

  it("expects a zero ledger after a void payout reversal", async () => {
    mocks.payoutFindFirst.mockResolvedValue({
      ...payout,
      status: "void",
      outcomeReference: null,
      outcomeReason: "synthetic void reason",
      paidAt: null,
    });
    mocks.ledgerAggregate.mockResolvedValue({ _sum: { amountCents: 0 } });

    const html = renderToStaticMarkup(await AffiliatePayoutDetailPage({ params: Promise.resolve({ id: payout.id }) }));

    expect(html).toContain("synthetic void reason");
    expect(html).toContain("目前狀態預期 $0");
    expect(html).toContain("金額一致");
  });

  it("stops child queries for an invalid month and fails closed for a cross-tenant payout", async () => {
    mocks.payoutFindFirst.mockResolvedValueOnce({ ...payout, monthKey: "invalid-month" });
    const invalidHtml = renderToStaticMarkup(await AffiliatePayoutDetailPage({ params: Promise.resolve({ id: payout.id }) }));
    expect(invalidHtml).toContain("月份格式無效");
    expect(mocks.commissionFindMany).not.toHaveBeenCalled();
    expect(mocks.ledgerAggregate).not.toHaveBeenCalled();

    mocks.payoutFindFirst.mockResolvedValueOnce(null);
    await expect(AffiliatePayoutDetailPage({ params: Promise.resolve({ id: "payout-other" }) })).rejects.toThrow("not-found");
    expect(mocks.notFound).toHaveBeenCalledOnce();
  });

  it("uses the complete aggregate and warns when commission display is truncated", async () => {
    mocks.payoutFindFirst.mockResolvedValue({ ...payout, commissionAmountCents: 25_100, finalAmountCents: 25_100 });
    mocks.commissionFindMany.mockResolvedValue(Array.from({ length: 251 }, (_, index) => ({
      ...commissions[0],
      id: `commission-${index}`,
    })));
    mocks.ledgerAggregate.mockResolvedValue({ _sum: { amountCents: 25_100 } });
    mocks.ledgerGroupBy.mockResolvedValue([]);
    mocks.ledgerFindMany.mockResolvedValue([]);

    const html = renderToStaticMarkup(await AffiliatePayoutDetailPage({ params: Promise.resolve({ id: payout.id }) }));

    expect(html).toContain("Commission 超過 250 筆");
    expect(html).toContain("金額一致");
    expect(html).not.toContain("金額不一致");
  });
});
