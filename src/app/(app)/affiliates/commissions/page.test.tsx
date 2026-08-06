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
    await AffiliateCommissionsPage();

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
    const html = renderToStaticMarkup(await AffiliateCommissionsPage());

    expect(html).toContain("推廣夥伴");
    expect(html).toContain("標記已付款");
    expect(html).toContain("標記作廢");
    expect(html).toContain('name="id" value="affiliate-payout-pending"');
    expect(html).toContain('name="status" value="paid"');
    expect(html).toContain('name="status" value="void"');
    expect(html).toContain('name="_csrf" value="csrf-affiliate"');
    expect(html).toContain('name="reason"');
  });

  it("does not render outcome controls for a paid, void, or linked payout", async () => {
    mocks.payoutFindMany.mockResolvedValue([
      { ...pendingPayout, id: "paid-payout", status: "paid", paidAt: new Date("2026-08-01T00:00:00.000Z") },
      { ...pendingPayout, id: "void-payout", status: "void" },
      { ...pendingPayout, id: "linked-payout", payoutItemId: "platform-item-1" },
      { ...pendingPayout, id: "mismatched-payout", finalAmountCents: 600 },
      { ...pendingPayout, id: "other-vendor-payout", vendorId: "vendor-other" },
    ]);

    const html = renderToStaticMarkup(await AffiliateCommissionsPage());

    expect(html).not.toContain("標記已付款");
    expect(html).not.toContain("標記作廢");
    expect(html).not.toContain("付款備註");
    expect(html).not.toContain("作廢原因");
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
