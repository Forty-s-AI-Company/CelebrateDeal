import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireVendorContext: vi.fn(),
  liveCount: vi.fn(),
  productCount: vi.fn(),
  leadCount: vi.fn(),
  viewCount: vi.fn(),
  productClicks: vi.fn(),
  ctaClicks: vi.fn(),
  liveFindMany: vi.fn(),
  affiliateFindMany: vi.fn(),
  usageFindUnique: vi.fn(),
  scriptCount: vi.fn(),
  roleCount: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({ requireVendorContext: mocks.requireVendorContext }));
vi.mock("@/lib/db", () => ({
  getDb: () => ({
    live: { count: mocks.liveCount, findMany: mocks.liveFindMany },
    product: { count: mocks.productCount },
    formSubmission: { count: mocks.leadCount },
    analyticsEvent: { count: mocks.viewCount, groupBy: vi.fn(), findMany: vi.fn() },
    affiliate: { findMany: mocks.affiliateFindMany },
    vendorUsageLimit: { findUnique: mocks.usageFindUnique },
    interactionScript: { count: mocks.scriptCount },
    interactionRole: { count: mocks.roleCount },
  }),
}));

import DashboardPage from "./page";

const vendor = {
  id: "vendor-dashboard",
  tracking: { googleTagManagerId: "GTM-SYNTHETIC", facebookPixelId: null },
};
const recentLive = {
  id: "live-recent",
  title: "夏日直播",
  status: "published",
  scheduledAt: new Date("2026-08-01T10:00:00.000Z"),
  submissions: [{ id: "submission-1" }],
  products: [],
};
const upcomingLive = {
  id: "live-upcoming",
  title: "下週直播",
  scheduledAt: new Date("2026-08-08T10:00:00.000Z"),
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireVendorContext.mockResolvedValue({
    auth: { member: { role: "owner" } },
    vendor,
  });
  mocks.liveCount.mockResolvedValue(2);
  mocks.productCount.mockResolvedValue(3);
  mocks.leadCount.mockResolvedValue(4);
  mocks.viewCount.mockResolvedValue(100);
  mocks.productClicks.mockResolvedValue(20);
  mocks.ctaClicks.mockResolvedValue(10);
  mocks.liveFindMany
    .mockResolvedValueOnce([recentLive])
    .mockResolvedValueOnce([upcomingLive]);
  mocks.affiliateFindMany.mockResolvedValue([{ id: "affiliate-1", code: "SUMMER", name: "夏日夥伴", clicks: [{ id: "click-1" }, { id: "click-2" }] }]);
  mocks.usageFindUnique.mockResolvedValue({ creditsUsed: 25, creditsLimit: 100, billingPlan: { name: "商家方案" } });
  mocks.scriptCount.mockResolvedValue(2);
  mocks.roleCount.mockResolvedValue(1);
});

describe("/dashboard route", () => {
  it("scopes all dashboard reads to the current vendor and renders populated states", async () => {
    const html = renderToStaticMarkup(await DashboardPage());

    expect(mocks.requireVendorContext).toHaveBeenCalledExactlyOnceWith();
    expect(mocks.liveCount).toHaveBeenCalledWith({ where: { vendorId: vendor.id } });
    expect(mocks.productCount).toHaveBeenCalledWith({ where: { vendorId: vendor.id, isActive: true } });
    expect(mocks.scriptCount).toHaveBeenCalledWith({ where: { vendorId: vendor.id } });
    expect(mocks.roleCount).toHaveBeenCalledWith({ where: { vendorId: vendor.id } });
    expect(html).toContain("Dashboard");
    expect(html).toContain("夏日直播");
    expect(html).toContain("下週直播");
    expect(html).toContain("夏日夥伴");
    expect(html).toContain("商家方案");
    expect(html).toContain("25%");
  });

  it("renders empty and non-manager states without manager-only links", async () => {
    mocks.requireVendorContext.mockResolvedValue({ auth: { member: { role: "viewer" } }, vendor: { ...vendor, tracking: null } });
    mocks.liveCount.mockResolvedValue(0);
    mocks.productCount.mockResolvedValue(0);
    mocks.leadCount.mockResolvedValue(0);
    mocks.viewCount.mockResolvedValue(0);
    mocks.productClicks.mockResolvedValue(0);
    mocks.ctaClicks.mockResolvedValue(0);
    mocks.liveFindMany.mockReset().mockResolvedValue([]);
    mocks.affiliateFindMany.mockResolvedValue([]);
    mocks.usageFindUnique.mockResolvedValue(null);
    mocks.scriptCount.mockResolvedValue(0);
    mocks.roleCount.mockResolvedValue(0);

    const html = renderToStaticMarkup(await DashboardPage());

    expect(html).toContain("目前還沒有直播資料");
    expect(html).toContain("目前沒有排定中的直播");
    expect(html).toContain("尚未建立聯盟來源");
    expect(html).toContain("尚未設定方案");
    expect(html).not.toContain('href="/lives/new"');
    expect(html).not.toContain("查看全部");
  });
});
