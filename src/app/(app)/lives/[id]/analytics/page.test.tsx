import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireVendor: vi.fn(),
  liveFindFirst: vi.fn(),
  analyticsGroupBy: vi.fn(),
  analyticsFindMany: vi.fn(),
  formSubmissionCount: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({ requireVendorManager: mocks.requireVendor }));
vi.mock("@/lib/db", () => ({
  getDb: () => ({
    live: { findFirst: mocks.liveFindFirst },
    analyticsEvent: { groupBy: mocks.analyticsGroupBy, findMany: mocks.analyticsFindMany },
    formSubmission: { count: mocks.formSubmissionCount },
  }),
}));

import LiveAnalyticsPage from "./page";

const live = {
  id: "live-current",
  title: "夏季直播",
  affiliateClicks: [{
    id: "affiliate-click-1",
    referralCode: "summer-partner",
    convertedAt: null,
    createdAt: new Date("2026-07-30T12:00:00.000Z"),
  }],
};

const recentEvents = Array.from({ length: 30 }, (_, index) => ({
  id: `recent-${index + 1}`,
  eventType: "page_view",
  visitorId: `visitor-${index + 1}`,
  createdAt: new Date(`2026-07-${String(30 - index).padStart(2, "0")}T12:00:00.000Z`),
}));

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireVendor.mockResolvedValue({ id: "vendor-current" });
  mocks.liveFindFirst.mockResolvedValue(live);
  mocks.analyticsGroupBy.mockResolvedValue([
    { eventType: "page_view", _count: { _all: 40 } },
    { eventType: "product_click", _count: { _all: 8 } },
    { eventType: "cta_click", _count: { _all: 6 } },
    { eventType: "play_progress", _count: { _all: 5 } },
  ]);
  mocks.formSubmissionCount.mockResolvedValue(4);
  mocks.analyticsFindMany.mockResolvedValue(recentEvents);
});

describe("/lives/[id]/analytics route", () => {
  it("uses full live-scoped event totals for KPIs and the conversion funnel when more than 30 events exist", async () => {
    const html = renderToStaticMarkup(await LiveAnalyticsPage({ params: Promise.resolve({ id: live.id }) }));

    expect(mocks.analyticsGroupBy).toHaveBeenCalledWith({
      by: ["eventType"],
      where: {
        vendorId: "vendor-current",
        liveId: live.id,
        eventType: { in: ["page_view", "product_click", "cta_click", "play_progress"] },
      },
      _count: { _all: true },
    });
    expect(mocks.formSubmissionCount).toHaveBeenCalledWith({ where: { liveId: live.id } });
    expect(html).toMatch(/觀看<\/p><p[^>]*>40<\/p>/);
    expect(html).toMatch(/商品點擊<\/p><p[^>]*>8<\/p>/);
    expect(html).toMatch(/CTA 點擊<\/p><p[^>]*>6<\/p>/);
    expect(html).toMatch(/播放進度<\/p><p[^>]*>5<\/p>/);
    expect(html).toContain('aria-label="商品點擊：8，相對觀看轉換率 20%"');
    expect(html).toContain('aria-label="CTA 點擊：6，相對觀看轉換率 15%"');
    expect(html).toContain('aria-label="名單：4，相對觀看轉換率 10%"');
  });

  it("keeps the recent-event list limited to 30 live-scoped events", async () => {
    const html = renderToStaticMarkup(await LiveAnalyticsPage({ params: Promise.resolve({ id: live.id }) }));

    expect(mocks.analyticsFindMany).toHaveBeenCalledWith({
      where: { vendorId: "vendor-current", liveId: live.id },
      orderBy: { createdAt: "desc" },
      take: 30,
    });
    expect(html).toContain("visitor-1");
    expect(html).toContain("visitor-30");
    expect(html).toContain("summer-partner");
  });

  it("shows an empty state when there are no recent events", async () => {
    mocks.analyticsFindMany.mockResolvedValue([]);

    const html = renderToStaticMarkup(await LiveAnalyticsPage({ params: Promise.resolve({ id: live.id }) }));

    expect(html).toContain("目前沒有最近事件。");
    expect(html).not.toContain("visitor-1");
  });

  it("shows an empty state when there are no affiliate sources", async () => {
    mocks.liveFindFirst.mockResolvedValue({ ...live, affiliateClicks: [] });

    const html = renderToStaticMarkup(await LiveAnalyticsPage({ params: Promise.resolve({ id: live.id }) }));

    expect(html).toContain("目前沒有聯盟來源資料。");
    expect(html).not.toContain("summer-partner");
  });
});
