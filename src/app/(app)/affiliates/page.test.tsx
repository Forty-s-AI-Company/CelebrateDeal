import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireVendorManager: vi.fn(),
  affiliateFindMany: vi.fn(),
  clickGroupBy: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({ requireVendorManager: mocks.requireVendorManager }));
vi.mock("@/lib/db", () => ({
  getDb: () => ({
    affiliate: { findMany: mocks.affiliateFindMany },
    affiliateClick: { groupBy: mocks.clickGroupBy },
  }),
}));

import AffiliatesPage from "./page";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireVendorManager.mockResolvedValue({ id: "vendor-1" });
  mocks.affiliateFindMany.mockResolvedValue([
    { id: "affiliate-1", name: "合作夥伴", code: "PARTNER1", source: "社群", isActive: true, commissionRateBps: 1250, _count: { clicks: 10 } },
    { id: "affiliate-2", name: "停用夥伴", code: "PARTNER2", source: null, isActive: false, commissionRateBps: 800, _count: { clicks: 0 } },
  ]);
  mocks.clickGroupBy.mockResolvedValue([{ affiliateId: "affiliate-1", _count: { _all: 2 } }]);
});

describe("/affiliates route", () => {
  it("scopes partner and conversion queries and renders safe performance metrics", async () => {
    const html = renderToStaticMarkup(await AffiliatesPage());

    expect(mocks.requireVendorManager).toHaveBeenCalledExactlyOnceWith();
    expect(mocks.affiliateFindMany).toHaveBeenCalledWith({
      where: { vendorId: "vendor-1" },
      orderBy: { createdAt: "desc" },
      include: { _count: { select: { clicks: true } } },
    });
    expect(mocks.clickGroupBy).toHaveBeenCalledWith({
      by: ["affiliateId"],
      where: { vendorId: "vendor-1", affiliateId: { in: ["affiliate-1", "affiliate-2"] }, convertedAt: { not: null } },
      _count: { _all: true },
    });
    expect(html).toContain("聯盟夥伴");
    expect(html).toContain("合作夥伴");
    expect(html).toContain("PARTNER1");
    expect(html).toContain("2");
    expect(html).toContain("20%");
    expect(html).toContain("停用");
    expect(html).toContain("未設定");
  });

  it("renders the empty state when the vendor has no partners", async () => {
    mocks.affiliateFindMany.mockResolvedValue([]);
    mocks.clickGroupBy.mockResolvedValue([]);

    const html = renderToStaticMarkup(await AffiliatesPage());

    expect(html).toContain("還沒有聯盟夥伴");
    expect(html).toContain("建立推廣碼後");
    expect(mocks.clickGroupBy).toHaveBeenCalledWith({
      by: ["affiliateId"],
      where: { vendorId: "vendor-1", affiliateId: { in: [] }, convertedAt: { not: null } },
      _count: { _all: true },
    });
  });
});
