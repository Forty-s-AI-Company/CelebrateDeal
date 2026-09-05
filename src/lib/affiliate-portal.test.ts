import { describe, expect, it, vi } from "vitest";
import { getAffiliatePortalDashboard } from "@/lib/affiliate-portal";

vi.mock("@/lib/app-url", () => ({ getCanonicalAppUrl: () => "https://app.example.test" }));

function database(affiliate: unknown) {
  return {
    affiliate: { findFirst: vi.fn().mockResolvedValue(affiliate) },
    affiliateClick: { count: vi.fn().mockResolvedValue(12) },
    affiliateCommission: {
      count: vi.fn().mockResolvedValue(3),
      aggregate: vi.fn().mockResolvedValue({ _sum: { commissionBaseAmountCents: 48_000 } }),
      groupBy: vi.fn().mockResolvedValue([
        { status: "pending", _sum: { commissionAmountCents: 100 } },
        { status: "locked", _sum: { commissionAmountCents: 200 } },
        { status: "paid", _sum: { commissionAmountCents: 300 } },
      ]),
      findMany: vi.fn().mockResolvedValue([]),
    },
    affiliatePayout: { findMany: vi.fn().mockResolvedValue([]) },
  };
}

describe("affiliate portal dashboard", () => {
  it("scopes every read to the authenticated tenant and affiliate", async () => {
    const db = database({ id: "affiliate-a", vendorId: "vendor-a", name: "A", code: "A-CODE", bankAccountEncrypted: null });
    const result = await getAffiliatePortalDashboard(db as never, {
      vendorId: "vendor-a",
      affiliateId: "affiliate-a",
      userId: "user-a",
    });

    expect(db.affiliate.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: "affiliate-a", vendorId: "vendor-a", userId: "user-a", isActive: true },
    }));
    expect(db.affiliateClick.count).toHaveBeenCalledWith({ where: { vendorId: "vendor-a", affiliateId: "affiliate-a" } });
    expect(db.affiliatePayout.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { vendorId: "vendor-a", affiliateId: "affiliate-a" } }));
    expect(result?.metrics).toEqual({ clickCount: 12, conversionCount: 3, salesAmountCents: 48_000 });
    expect(result?.wallet).toEqual({ pending: 100, approved: 200, paid: 300 });
    expect(result?.referralUrl).toBe("https://app.example.test/r/A-CODE");
  });

  it("fails closed before reading metrics when ownership does not match", async () => {
    const db = database(null);
    const result = await getAffiliatePortalDashboard(db as never, {
      vendorId: "vendor-a",
      affiliateId: "affiliate-b",
      userId: "user-a",
    });

    expect(result).toBeNull();
    expect(db.affiliateClick.count).not.toHaveBeenCalled();
    expect(db.affiliatePayout.findMany).not.toHaveBeenCalled();
  });
});
