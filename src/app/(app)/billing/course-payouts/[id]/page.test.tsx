import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireVendorFinance: vi.fn(),
  payoutFindFirst: vi.fn(),
  allocationFindMany: vi.fn(),
  ledgerAggregate: vi.fn(),
  ledgerGroupBy: vi.fn(),
  ledgerFindMany: vi.fn(),
  notFound: vi.fn(() => { throw new Error("not-found"); }),
}));

vi.mock("@/lib/auth", () => ({ requireVendorFinance: mocks.requireVendorFinance }));
vi.mock("@/lib/db", () => ({ getDb: () => ({
  coursePayout: { findFirst: mocks.payoutFindFirst },
  courseCommissionAllocation: { findMany: mocks.allocationFindMany },
  courseCommissionLedgerEntry: { aggregate: mocks.ledgerAggregate, groupBy: mocks.ledgerGroupBy, findMany: mocks.ledgerFindMany },
}) }));
vi.mock("next/navigation", () => ({ notFound: mocks.notFound }));

import MerchantCoursePayoutDetailPage from "./page";

const payout = {
  id: "payout-current", vendorId: "vendor-current", recipientMembershipId: "recipient-f", monthKey: "2026-07",
  commissionAmountCents: 400, adjustmentAmountCents: 0, finalAmountCents: 400,
  grossSalesAmountCents: 10_000, netReferenceAmountCents: 8_600, status: "paid",
  outcomeReference: "manual-reference-2026-07", outcomeReason: null, paidAt: new Date("2026-08-02T00:00:00.000Z"),
  recipient: { vendorMember: { user: { name: "課程推廣者 F" } } },
};
const allocations = [{
  id: "allocation-current", vendorId: "vendor-current", recipientMembershipId: "recipient-f", recipientRole: "F",
  shareBps: 4000, policyVersion: 2, grossAmountCents: 1_000, amountCents: 400, currency: "TWD",
  createdAt: new Date("2026-07-02T00:00:00.000Z"), product: { name: "測試課程" },
  paymentTransaction: { orderNumber: "ORDER-1", occurredAt: new Date("2026-07-02T00:00:00.000Z") },
  ledgerEntries: [
    { id: "ledger-accrual", courseCommissionAllocationId: "allocation-current", entryType: "accrual", amountCents: 500, providerName: "synthetic", eventIdentity: "sale-1", disputeCaseId: null, occurredAt: new Date("2026-07-02T00:00:00.000Z") },
    { id: "ledger-refund", courseCommissionAllocationId: "allocation-current", entryType: "dispute_lost", amountCents: -100, providerName: "synthetic", eventIdentity: "refund-1", disputeCaseId: "case-123", occurredAt: new Date("2026-07-03T00:00:00.000Z") },
  ],
}];

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireVendorFinance.mockResolvedValue({ vendor: { id: "vendor-current" } });
  mocks.payoutFindFirst.mockResolvedValue(payout);
  mocks.allocationFindMany.mockResolvedValue(allocations);
  mocks.ledgerAggregate.mockResolvedValue({ _sum: { amountCents: 400 } });
  mocks.ledgerGroupBy.mockResolvedValue([{ courseCommissionAllocationId: "allocation-current", _sum: { amountCents: 400 } }]);
  mocks.ledgerFindMany.mockResolvedValue(allocations[0]?.ledgerEntries ?? []);
});

describe("/billing/course-payouts/[id]", () => {
  it("binds both payout and allocation ledger queries to the current vendor", async () => {
    await MerchantCoursePayoutDetailPage({ params: Promise.resolve({ id: "payout-current" }) });

    expect(mocks.requireVendorFinance).toHaveBeenCalledExactlyOnceWith("/billing/course-payouts/payout-current");
    expect(mocks.payoutFindFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "payout-current", vendorId: "vendor-current" } }));
    expect(mocks.allocationFindMany).toHaveBeenCalledWith({
      where: {
        vendorId: "vendor-current", recipientMembershipId: "recipient-f",
        paymentTransaction: { occurredAt: { gte: new Date("2026-07-01T00:00:00.000Z"), lt: new Date("2026-08-01T00:00:00.000Z") } },
      },
      orderBy: { createdAt: "desc" }, take: 251,
      include: {
        product: { select: { name: true } },
        paymentTransaction: { select: { orderNumber: true, occurredAt: true } },
      },
    });
    expect(mocks.ledgerAggregate).toHaveBeenCalledWith({
      where: {
        vendorId: "vendor-current",
        allocation: {
          vendorId: "vendor-current", recipientMembershipId: "recipient-f",
          paymentTransaction: { occurredAt: { gte: new Date("2026-07-01T00:00:00.000Z"), lt: new Date("2026-08-01T00:00:00.000Z") } },
        },
      },
      _sum: { amountCents: true },
    });
    expect(mocks.ledgerGroupBy).toHaveBeenCalledWith({
      by: ["courseCommissionAllocationId"],
      where: { vendorId: "vendor-current", courseCommissionAllocationId: { in: ["allocation-current"] } },
      _sum: { amountCents: true },
    });
    expect(mocks.ledgerFindMany).toHaveBeenCalledWith({
      where: { vendorId: "vendor-current", courseCommissionAllocationId: { in: ["allocation-current"] } },
      orderBy: [{ occurredAt: "asc" }, { id: "asc" }],
      take: 501,
    });
  });

  it("renders the allowlisted refund ledger, reconciliation and payout outcome", async () => {
    const html = renderToStaticMarkup(await MerchantCoursePayoutDetailPage({ params: Promise.resolve({ id: "payout-current" }) }));

    expect(html).toContain("課程推廣者 F");
    expect(html).toContain("測試課程");
    expect(html).toContain("dispute_lost");
    expect(html).toContain("refund-1");
    expect(html).toContain("case-123");
    expect(html).toContain("manual-reference-2026-07");
    expect(html).toContain("金額一致");
    expect(html).not.toContain("<form");
  });

  it("does not query allocations for an invalid payout month", async () => {
    mocks.payoutFindFirst.mockResolvedValue({ ...payout, monthKey: "invalid-month" });

    const html = renderToStaticMarkup(await MerchantCoursePayoutDetailPage({ params: Promise.resolve({ id: "payout-current" }) }));

    expect(mocks.allocationFindMany).not.toHaveBeenCalled();
    expect(mocks.ledgerAggregate).not.toHaveBeenCalled();
    expect(mocks.ledgerGroupBy).not.toHaveBeenCalled();
    expect(mocks.ledgerFindMany).not.toHaveBeenCalled();
    expect(html).toContain("月份格式無效");
  });

  it("returns not found for a payout outside the current tenant", async () => {
    mocks.payoutFindFirst.mockResolvedValue(null);

    await expect(MerchantCoursePayoutDetailPage({ params: Promise.resolve({ id: "payout-other" }) })).rejects.toThrow("not-found");
    expect(mocks.allocationFindMany).not.toHaveBeenCalled();
  });

  it("uses the complete aggregate and warns when allocation display is truncated", async () => {
    mocks.payoutFindFirst.mockResolvedValue({ ...payout, commissionAmountCents: 25_100, finalAmountCents: 25_100 });
    mocks.allocationFindMany.mockResolvedValue(Array.from({ length: 251 }, (_, index) => ({
      ...allocations[0], id: `allocation-${index}`,
    })));
    mocks.ledgerAggregate.mockResolvedValue({ _sum: { amountCents: 25_100 } });
    mocks.ledgerGroupBy.mockResolvedValue([]);
    mocks.ledgerFindMany.mockResolvedValue([]);

    const html = renderToStaticMarkup(await MerchantCoursePayoutDetailPage({ params: Promise.resolve({ id: "payout-current" }) }));

    expect(html).toContain("Allocation 超過 250 筆");
    expect(html).toContain("金額一致");
    expect(html).not.toContain("金額不一致");
  });
});
