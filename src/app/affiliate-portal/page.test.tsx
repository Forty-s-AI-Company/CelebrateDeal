import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requirePortal: vi.fn(),
  dashboard: vi.fn(),
}));

vi.mock("@/lib/affiliate-portal-auth", () => ({ requireAffiliatePortal: mocks.requirePortal }));
vi.mock("@/lib/affiliate-portal", () => ({ getAffiliatePortalDashboard: mocks.dashboard }));
vi.mock("@/lib/db", () => ({ getDb: () => ({}) }));
vi.mock("@/components/csrf-field", () => ({ CsrfField: () => <input type="hidden" name="_csrf" value="test" /> }));
vi.mock("@/app/actions/affiliate-portal-actions", () => ({
  affiliatePortalLogoutAction: vi.fn(),
  requestAffiliatePayoutAction: vi.fn(),
  saveAffiliateBankAccountAction: vi.fn(),
}));

import AffiliatePortalPage from "@/app/affiliate-portal/page";

describe("affiliate portal page", () => {
  it("renders isolated metrics, wallet states, referral link and payout control", async () => {
    mocks.requirePortal.mockResolvedValue({
      auth: { user: { id: "user-a" } },
      affiliate: { id: "affiliate-a", name: "小美", code: "MAY", bankAccountEncrypted: null },
      vendor: { id: "vendor-a", name: "商家 A" },
    });
    mocks.dashboard.mockResolvedValue({
      affiliate: { id: "affiliate-a", name: "小美", code: "MAY", bankAccountEncrypted: null },
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

    const html = renderToStaticMarkup(await AffiliatePortalPage({ searchParams: Promise.resolve({}) }));
    expect(html).toContain("即時點擊數");
    expect(html).toContain(">88<");
    expect(html).toContain("轉換訂單數");
    expect(html).toContain("總帶貨金額");
    expect(html).toContain("Pending");
    expect(html).toContain("Approved");
    expect(html).toContain("Paid");
    expect(html).toContain("https://app.example.test/r/MAY");
    expect(html).toContain("一鍵申請提領");
  });
});
