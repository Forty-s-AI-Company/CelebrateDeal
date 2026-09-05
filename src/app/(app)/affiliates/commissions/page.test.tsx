import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  commissionFindMany: vi.fn(),
  payoutFindMany: vi.fn(),
  requireVendorFinance: vi.fn(),
  getCsrfToken: vi.fn(),
}));

vi.mock("@/app/actions", () => ({ recordAffiliatePayoutOutcomeAction: vi.fn() }));
vi.mock("@/lib/auth", () => ({ requireVendorFinance: mocks.requireVendorFinance }));
vi.mock("@/components/csrf-field", () => ({
  CsrfField: () => <input type="hidden" name="_csrf" value="csrf-affiliate" />,
}));
vi.mock("@/lib/db", () => ({
  getDb: () => ({
    affiliateCommission: { findMany: mocks.commissionFindMany },
    affiliatePayout: { findMany: mocks.payoutFindMany },
  }),
}));

import AffiliateCommissionsPage from "./page";

const vendor = { id: "vendor-current" };
const commissions = [
  {
    id: "commission-1",
    affiliateId: "affiliate-1",
    referralCode: "PARTNER-1",
    orderNumber: "ORDER-1",
    orderAmountCents: 10000,
    commissionBaseAmountCents: 10000,
    netReferenceAmountCents: 8600,
    commissionRateBps: 500,
    commissionAmountCents: 500,
    status: "locked",
    attributedAt: new Date("2026-07-01T00:00:00.000Z"),
    affiliate: { id: "affiliate-1", name: "推廣夥伴" },
  },
];
const pendingPayout = {
  id: "affiliate-payout-pending",
  vendorId: "vendor-current",
  monthKey: "2026-07",
  commissionAmountCents: 500,
  adjustmentAmountCents: 0,
  finalAmountCents: 500,
  status: "pending",
  payoutItemId: null,
  outcomeReference: null,
  outcomeReason: null,
  requestedAt: new Date("2026-07-31T08:00:00.000Z"),
  affiliate: { id: "affiliate-1", name: "推廣夥伴" },
  createdAt: new Date("2026-07-31T00:00:00.000Z"),
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireVendorFinance.mockResolvedValue({
    vendor,
    member: { id: "member-finance", role: "accountant", status: "active" },
  });
  mocks.getCsrfToken.mockResolvedValue("csrf-affiliate");
  mocks.commissionFindMany.mockResolvedValue(commissions);
  mocks.payoutFindMany.mockResolvedValue([pendingPayout]);
});

describe("/affiliates/commissions route", () => {
  it("scopes commissions and payout records to the current vendor", async () => {
    await AffiliateCommissionsPage({});

    expect(mocks.requireVendorFinance).toHaveBeenCalledExactlyOnceWith("/affiliates/commissions");
    expect(mocks.commissionFindMany).toHaveBeenCalledWith({
      where: { vendorId: vendor.id },
      orderBy: { attributedAt: "desc" },
      include: { affiliate: true },
    });
    expect(mocks.payoutFindMany).toHaveBeenCalledWith({
      where: { vendorId: vendor.id },
      orderBy: [{ monthKey: "desc" }, { createdAt: "desc" }],
      include: { affiliate: true },
    });
  });

  it("renders deterministic paid and void controls only for an actionable pending payout", async () => {
    const html = renderToStaticMarkup(await AffiliateCommissionsPage({}));

    expect(html).toContain("推廣夥伴");
    expect(html).toContain("Gross 分潤基礎");
    expect(html).toContain("Net reference");
    expect(html).toContain("$86");
    expect(html).toContain("標記已付款");
    expect(html).toContain("標記作廢");
    expect(html).toContain('name="id" value="affiliate-payout-pending"');
    expect(html).toContain('name="status" value="paid"');
    expect(html).toContain('name="status" value="void"');
    expect(html).toContain('name="_csrf" value="csrf-affiliate"');
    expect(html).toContain('name="outcomeReference"');
    expect(html).toContain("人工出款 reference");
    expect(html).toContain("查看 ledger 與 payout 明細");
    expect(html).toContain("Portal 提領申請");
    expect(html).toContain("/affiliates/commissions/affiliate-payout-pending");
    expect(html).toContain('name="reason"');
  });

  it("keeps a payout visible when the commission list is empty and shows its preserved outcome note", async () => {
    mocks.commissionFindMany.mockResolvedValue([]);
    mocks.payoutFindMany.mockResolvedValue([{
      ...pendingPayout,
      status: "paid",
      outcomeReference: "affiliate-transfer-reference",
      outcomeReason: "synthetic merchant transfer note",
      paidAt: new Date("2026-08-01T00:00:00.000Z"),
    }]);

    const html = renderToStaticMarkup(await AffiliateCommissionsPage({}));

    expect(html).toContain("尚無分潤資料");
    expect(html).toContain("affiliate-transfer-reference");
    expect(html).toContain("synthetic merchant transfer note");
    expect(html).toContain("查看 ledger 與 payout 明細");
  });

  it("does not render outcome controls for a paid, void, or linked payout", async () => {
    mocks.payoutFindMany.mockResolvedValue([
      { ...pendingPayout, id: "paid-payout", status: "paid", paidAt: new Date("2026-08-01T00:00:00.000Z") },
      { ...pendingPayout, id: "void-payout", status: "void" },
      { ...pendingPayout, id: "linked-payout", payoutItemId: "platform-item-1" },
      { ...pendingPayout, id: "mismatched-payout", finalAmountCents: 600 },
      { ...pendingPayout, id: "other-vendor-payout", vendorId: "vendor-other" },
    ]);

    const html = renderToStaticMarkup(await AffiliateCommissionsPage({}));

    expect(html).not.toContain("標記已付款");
    expect(html).not.toContain("標記作廢");
    expect(html).not.toContain('name="reason"');
    expect(html).not.toContain('placeholder="付款備註"');
    expect(html).not.toContain('placeholder="作廢原因"');
  });

  it("renders only allowlisted action errors", async () => {
    const conflictHtml = renderToStaticMarkup(await AffiliateCommissionsPage({
      searchParams: Promise.resolve({ error: "conflict" }),
    }));
    const unknownHtml = renderToStaticMarkup(await AffiliateCommissionsPage({
      searchParams: Promise.resolve({ error: "unexpected-secret" }),
    }));

    expect(conflictHtml).toContain("已被其他操作更新");
    expect(unknownHtml).not.toContain("unexpected-secret");
  });
});
