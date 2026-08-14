import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireVendor: vi.fn(),
  liveFindFirst: vi.fn(),
  analyticsFindMany: vi.fn(),
  formSubmissionCount: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({ requireVendorManager: mocks.requireVendor }));
vi.mock("@/lib/db", () => ({
  getDb: () => ({
    live: { findFirst: mocks.liveFindFirst },
    analyticsEvent: { findMany: mocks.analyticsFindMany },
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
  trustLevel: "ADMITTED_LIVE_SESSION",
  createdAt: new Date(`2026-07-${String(30 - index).padStart(2, "0")}T12:00:00.000Z`),
}));
const verifiedAnalyticsSessions = [
  ...Array.from({ length: 40 }, (_, index) => ({ eventType: "page_view", visitorId: `view-session-${index}` })),
  ...Array.from({ length: 8 }, (_, index) => ({ eventType: "product_click", visitorId: `product-session-${index}` })),
  ...Array.from({ length: 6 }, (_, index) => ({ eventType: "cta_click", visitorId: `cta-session-${index}` })),
  ...Array.from({ length: 5 }, (_, index) => ({ eventType: "play_progress", visitorId: `progress-session-${index}` })),
];

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireVendor.mockResolvedValue({ id: "vendor-current" });
  mocks.liveFindFirst.mockResolvedValue(live);
  mocks.formSubmissionCount.mockResolvedValue(4);
  mocks.analyticsFindMany
    .mockResolvedValueOnce(verifiedAnalyticsSessions)
    .mockResolvedValueOnce(recentEvents);
});

describe("/lives/[id]/analytics route", () => {
  it("uses full live-scoped event totals for KPIs and the conversion funnel when more than 30 events exist", async () => {
    const html = renderToStaticMarkup(await LiveAnalyticsPage({ params: Promise.resolve({ id: live.id }) }));

    expect(mocks.analyticsFindMany).toHaveBeenNthCalledWith(1, {
      where: {
        vendorId: "vendor-current",
        liveId: live.id,
        trustLevel: "ADMITTED_LIVE_SESSION",
        eventType: { in: ["page_view", "product_click", "cta_click", "play_progress"] },
      },
      select: { eventType: true, visitorId: true },
      distinct: ["eventType", "visitorId"],
    });
    expect(mocks.formSubmissionCount).toHaveBeenCalledWith({ where: { liveId: live.id, verificationStatus: "VERIFIED" } });
    expect(html).toMatch(/播放 session<\/p><p[^>]*>40<\/p>/);
    expect(html).toMatch(/商品點擊<\/p><p[^>]*>8<\/p>/);
    expect(html).toMatch(/CTA 點擊<\/p><p[^>]*>6<\/p>/);
    expect(html).toMatch(/播放進度<\/p><p[^>]*>5<\/p>/);
    expect(html).toContain('aria-label="商品點擊：8，相對觀看轉換率 20%"');
    expect(html).toContain('aria-label="CTA 點擊：6，相對觀看轉換率 15%"');
    expect(html).toContain('aria-label="名單：4，相對觀看轉換率 10%"');
  });

  it("keeps the recent-event list limited to 30 live-scoped events", async () => {
    const html = renderToStaticMarkup(await LiveAnalyticsPage({ params: Promise.resolve({ id: live.id }) }));

    expect(mocks.analyticsFindMany).toHaveBeenNthCalledWith(2, {
      where: {
        vendorId: "vendor-current",
        liveId: live.id,
        OR: [
          { trustLevel: "ADMITTED_LIVE_SESSION" },
          { trustLevel: "VERIFIED_FORM_SUBMISSION", eventType: "lead_submit" },
        ],
      },
      orderBy: { createdAt: "desc" },
      take: 30,
    });
    expect(html).toContain("visitor-1");
    expect(html).toContain("visitor-30");
    expect(html).toContain("summer-partner");
  });

  it("shows an empty state when there are no recent events", async () => {
    mocks.analyticsFindMany
      .mockReset()
      .mockResolvedValueOnce(verifiedAnalyticsSessions)
      .mockResolvedValueOnce([]);

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
