import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requirePortal: vi.fn(),
  dashboard: vi.fn(),
}));

vi.mock("@/lib/affiliate-portal-auth", () => ({ requireAffiliatePortal: mocks.requirePortal }));
vi.mock("@/lib/affiliate-portal", () => ({ getAffiliatePortalDashboard: mocks.dashboard }));
vi.mock("@/lib/db", () => ({ getDb: () => ({}) }));
vi.mock("@/lib/bank-account", () => ({
  resolveStoredBankAccount: () => ({ accountName: "王小美", bankCode: "812", accountNumber: "1234567890" }),
  maskBankAccount: () => ({ accountName: "王＊＊", bankCode: "812", accountNumber: "****7890" }),
}));
vi.mock("@/lib/tax-identity", () => ({ decryptTaxIdentity: () => "A123456789", maskTaxIdentity: () => "A1*****789" }));
vi.mock("@/components/csrf-field", () => ({ CsrfField: () => <input type="hidden" name="_csrf" value="test" /> }));
vi.mock("@/app/actions/affiliate-portal-actions", () => ({
  affiliatePortalLogoutAction: vi.fn(),
  requestAffiliatePayoutAction: vi.fn(),
  saveAffiliateBankAccountAction: vi.fn(),
}));

import AffiliatePortalPage from "@/app/affiliate-portal/page";

describe("affiliate portal page", () => {
  beforeEach(() => {
    mocks.requirePortal.mockResolvedValue({
      auth: { user: { id: "user-a" } },
      affiliate: { id: "affiliate-a", name: "小美", code: "MAY", bankAccountEncrypted: "encrypted", taxIdentityEncrypted: "encrypted-tax" },
      vendor: { id: "vendor-a", name: "商家 A" },
    });
    mocks.dashboard.mockResolvedValue({
      affiliate: { id: "affiliate-a", name: "小美", code: "MAY", bankAccountEncrypted: "encrypted", taxIdentityEncrypted: "encrypted-tax" },
      metrics: { clickCount: 88, conversionCount: 5, salesAmountCents: 120_000 },
      wallet: { pending: 1_000, approved: 2_000, paid: 3_000 },
      referralUrl: "https://app.example.test/r/MAY",
      commissions: [
        { id: "c1", monthKey: "2026-09", orderNumber: "O-1", commissionBaseAmountCents: 10_000, commissionAmountCents: 1_000, status: "pending", attributedAt: new Date("2026-09-05") },
        { id: "c2", monthKey: "2026-09", orderNumber: "O-2", commissionBaseAmountCents: 20_000, commissionAmountCents: 2_000, status: "locked", attributedAt: new Date("2026-09-05") },
        { id: "c3", monthKey: "2026-08", orderNumber: "O-3", commissionBaseAmountCents: 30_000, commissionAmountCents: 3_000, status: "paid", attributedAt: new Date("2026-08-05") },
      ],
      payouts: [{ id: "p1", monthKey: "2026-09", finalAmountCents: 2_000, status: "pending", requestedAt: null, paidAt: null, createdAt: new Date("2026-09-05") }],
    });

  });

  it("renders isolated metrics, wallet states, referral link and payout control", async () => {
    const html = renderToStaticMarkup(await AffiliatePortalPage({ searchParams: Promise.resolve({}) }));
    expect(html).toContain("即時點擊數");
    expect(html).toContain(">88<");
    expect(html).toContain("轉換訂單數");
    expect(html).toContain("總帶貨金額");
    expect(html).toContain("Pending");
    expect(html).toContain("Approved");
    expect(html).toContain("Paid");
    expect(html).toContain("https://app.example.test/r/MAY");
    expect(html).toContain("勞務報酬明細與簽署確認");
    expect(html).toContain("確認簽署並申請提領");
    expect(html).toContain("A1*****789");
    const payoutDialog = html.match(/<dialog[\s\S]*?<\/dialog>/u)?.[0];
    expect(payoutDialog).toContain('name="_csrf" value="test"');
    expect(payoutDialog).toContain('name="payoutId" value="p1"');
    expect(payoutDialog).not.toContain("A123456789");
    expect(payoutDialog).not.toContain("1234567890");
  });

  it.each([0, 1_200, 1_500])("keeps the dashboard available when a pending payout is %i cents", async (finalAmountCents) => {
    const dashboard = await mocks.dashboard();
    mocks.dashboard.mockResolvedValue({ ...dashboard, payouts: [{ ...dashboard.payouts[0], finalAmountCents }] });
    const html = renderToStaticMarkup(await AffiliatePortalPage({ searchParams: Promise.resolve({}) }));
    expect(html).toContain("嗨，小美");
    expect(html).toContain("即時點擊數");
    expect(html).toContain("暫時無法申請提領");
    expect(html).not.toContain('name="payoutId"');
  });

  it("renders a historical small payout without recalculating a new deduction snapshot", async () => {
    const dashboard = await mocks.dashboard();
    mocks.dashboard.mockResolvedValue({ ...dashboard, payouts: [{ ...dashboard.payouts[0], finalAmountCents: 1_200, status: "paid", paidAt: new Date("2026-09-05") }] });
    const html = renderToStaticMarkup(await AffiliatePortalPage({ searchParams: Promise.resolve({}) }));
    expect(html).toContain("已付款");
    expect(html).not.toContain("暫時無法申請提領");
    expect(html).not.toContain('name="payoutId"');
  });

});
