import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireVendor: vi.fn(),
  liveFindFirst: vi.fn(),
  analyticsFindMany: vi.fn(),
  formSubmissionCount: vi.fn(),
  liveChatMessageCount: vi.fn(),
  interactionEventCount: vi.fn(),
  paymentTransactionCount: vi.fn(),
  paymentTransactionAggregate: vi.fn(),
  emailDeliveryGroupBy: vi.fn(),
  interactionRunFindMany: vi.fn(),
  interactionResponseGroupBy: vi.fn(),
  interactionResponseFindMany: vi.fn(),
  liveQuestionGroupBy: vi.fn(),
  liveQuestionFindMany: vi.fn(),
  queryRaw: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({ requireVendorManager: mocks.requireVendor }));
vi.mock("@/lib/db", () => ({
  getDb: () => ({
    $queryRaw: mocks.queryRaw,
    live: { findFirst: mocks.liveFindFirst },
    analyticsEvent: { findMany: mocks.analyticsFindMany },
    formSubmission: { count: mocks.formSubmissionCount },
    liveChatMessage: { count: mocks.liveChatMessageCount },
    interactionEvent: { count: mocks.interactionEventCount },
    paymentTransaction: { count: mocks.paymentTransactionCount, aggregate: mocks.paymentTransactionAggregate },
    emailDelivery: { groupBy: mocks.emailDeliveryGroupBy },
    liveInteractionRun: { findMany: mocks.interactionRunFindMany },
    liveInteractionResponse: { groupBy: mocks.interactionResponseGroupBy, findMany: mocks.interactionResponseFindMany },
    liveQuestion: { groupBy: mocks.liveQuestionGroupBy, findMany: mocks.liveQuestionFindMany },
  }),
}));

import LiveAnalyticsPage from "./page";

const live = {
  id: "live-current",
  title: "夏季直播",
  endedAt: new Date("2026-07-30T13:00:00.000Z"),
  interactionScript: { id: "script-current", vendorId: "vendor-current", status: "published" },
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
  mocks.formSubmissionCount.mockResolvedValueOnce(6).mockResolvedValueOnce(4);
  mocks.liveChatMessageCount.mockResolvedValue(3);
  mocks.interactionEventCount.mockResolvedValue(7);
  mocks.paymentTransactionCount.mockResolvedValue(2);
  mocks.paymentTransactionAggregate
    .mockResolvedValueOnce({ _count: { _all: 2 }, _sum: { grossAmountCents: 120_000 } })
    .mockResolvedValueOnce({ _count: { _all: 1 }, _sum: { grossAmountCents: 30_000 } });
  mocks.emailDeliveryGroupBy.mockResolvedValue([
    { status: "sent", _count: { _all: 12 } },
    { status: "failed", _count: { _all: 1 } },
    { status: "exhausted", _count: { _all: 2 } },
  ]);
  mocks.analyticsFindMany
    .mockResolvedValueOnce(verifiedAnalyticsSessions)
    .mockResolvedValueOnce(recentEvents)
    .mockResolvedValueOnce([{ visitorId: "live-viewer" }])
    .mockResolvedValueOnce([{ visitorId: "replay-viewer" }]);
  mocks.interactionRunFindMany.mockResolvedValue([]);
  mocks.interactionResponseGroupBy.mockResolvedValue([]);
  mocks.interactionResponseFindMany.mockResolvedValue([]);
  mocks.liveQuestionGroupBy.mockResolvedValue([]);
  mocks.liveQuestionFindMany.mockResolvedValue([]);
  mocks.queryRaw.mockResolvedValue([]);
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
    expect(mocks.formSubmissionCount).toHaveBeenNthCalledWith(1, { where: { liveId: live.id, form: { vendorId: "vendor-current" } } });
    expect(mocks.formSubmissionCount).toHaveBeenNthCalledWith(2, { where: { liveId: live.id, verificationStatus: "VERIFIED", form: { vendorId: "vendor-current" } } });
    expect(html).toMatch(/播放 session<\/p><p[^>]*>40<\/p>/);
    expect(html).toMatch(/商品點擊<\/p><p[^>]*>8<\/p>/);
    expect(html).toMatch(/CTA 點擊<\/p><p[^>]*>6<\/p>/);
    expect(html).toMatch(/播放進度<\/p><p[^>]*>5<\/p>/);
    expect(html).toContain('aria-label="商品點擊：8，相對觀看轉換率 20%"');
    expect(html).toContain('aria-label="CTA 點擊：6，相對觀看轉換率 15%"');
    expect(html).toMatch(/報名<\/p><p[^>]*>6<\/p>/);
    expect(html).toMatch(/Email 已驗證<\/p><p[^>]*>4<\/p>/);
    expect(html).toContain('aria-label="名單：4，相對觀看轉換率 10%"');
    expect(mocks.liveChatMessageCount).toHaveBeenCalledWith({ where: {
      vendorId: "vendor-current",
      liveId: live.id,
      source: "viewer",
      isSimulated: false,
      status: "visible",
      formSubmissionId: { not: null },
      roleId: null,
    } });
    expect(mocks.interactionEventCount).toHaveBeenCalledWith({ where: {
      eventType: { in: ["chat_message", "reminder"] },
      message: { not: null },
      isSimulated: true,
      script: { id: "script-current", vendorId: "vendor-current", status: "published" },
      role: { is: { vendorId: "vendor-current", isActive: true, isScheduled: true } },
    } });
    expect(html).toMatch(/真實觀眾留言<\/p><p[^>]*>3<\/p>/);
    expect(mocks.paymentTransactionCount).toHaveBeenCalledWith({
      where: {
        vendorId: "vendor-current",
        primaryCommerceOrder: { isNot: null },
        metadata: { path: ["sourceLiveId"], equals: live.id },
      },
    });
    expect(html).toMatch(/建立待付款訂單<\/p><p[^>]*>2<\/p>/);
    expect(mocks.emailDeliveryGroupBy).toHaveBeenCalledWith({
      by: ["status"],
      where: { vendorId: "vendor-current", sourceLiveId: live.id },
      _count: { _all: true },
    });
    expect(html).toMatch(/Email 成功<\/p><p[^>]*>12<\/p>/);
    expect(html).toMatch(/Email 失敗<\/p><p[^>]*>3<\/p>/);
    expect(html).toMatch(/排程留言腳本<\/p><p[^>]*>7<\/p>/);
    expect(html).toContain("設定數，不列入轉換率");
    expect(html).toContain(`href="/lives/${live.id}/analytics/messages/export"`);
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
  });

  it("shows an empty state when there are no recent events", async () => {
    mocks.analyticsFindMany
      .mockReset()
      .mockResolvedValueOnce(verifiedAnalyticsSessions)
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ visitorId: "live-viewer" }])
      .mockResolvedValueOnce([{ visitorId: "replay-viewer" }]);

    const html = renderToStaticMarkup(await LiveAnalyticsPage({ params: Promise.resolve({ id: live.id }) }));

    expect(html).toContain("目前沒有最近事件。");
    expect(html).not.toContain("visitor-1");
  });

  it("shows an empty state when there are no affiliate sources", async () => {
    const html = renderToStaticMarkup(await LiveAnalyticsPage({ params: Promise.resolve({ id: live.id }) }));

    expect(html).toContain("目前沒有推廣夥伴歸因資料。");
    expect(html).not.toContain("summer-partner");
  });

  it("renders tenant-scoped interaction aggregates, masked Q&A, and live/replay revenue", async () => {
    mocks.interactionRunFindMany.mockResolvedValue([
      { id: "poll-1", eventType: "poll", title: "投票", configuration: { question: "最喜歡哪款？", options: [{ id: "a", label: "A 款" }, { id: "b", label: "B 款" }] }, winnerResponseId: null, startsAt: new Date() },
      { id: "draw-1", eventType: "lucky_draw", title: "週年抽獎", configuration: { prizeName: "限定禮盒" }, winnerResponseId: "winner-1", startsAt: new Date() },
      { id: "voucher-1", eventType: "flash_voucher", title: "限時紅包", configuration: {}, winnerResponseId: null, startsAt: new Date() },
    ]);
    mocks.interactionResponseGroupBy
      .mockResolvedValueOnce([
        { runId: "poll-1", value: "a", _count: { _all: 3 } },
        { runId: "poll-1", value: "b", _count: { _all: 1 } },
        { runId: "draw-1", value: "週年快樂", _count: { _all: 8 } },
        { runId: "voucher-1", value: "claim", _count: { _all: 5 } },
      ])
      .mockResolvedValueOnce([{ runId: "voucher-1", eventType: "flash_voucher", _count: { _all: 2 } }]);
    mocks.interactionResponseFindMany.mockResolvedValue([{ id: "winner-1", displayName: "張小芬", winnerClaimedAt: null }]);
    mocks.liveQuestionGroupBy.mockResolvedValue([
      { status: "answered", _count: { _all: 2 } },
      { status: "hidden", _count: { _all: 1 } },
      { status: "spotlight", _count: { _all: 1 } },
    ]);
    mocks.liveQuestionFindMany.mockResolvedValue([{ id: "q-1", body: "課程有回放嗎？", displayName: "陳小明", status: "answered" }]);
    mocks.queryRaw.mockResolvedValue([{ attributionKey: "affiliate-1", name: "夏季夥伴", clicks: 10, registrations: 6, confirmedOrders: 2, pendingOrders: 1, confirmedGrossCents: 50_000 }]);

    const html = renderToStaticMarkup(await LiveAnalyticsPage({ params: Promise.resolve({ id: live.id }) }));

    expect(mocks.interactionResponseGroupBy).toHaveBeenNthCalledWith(1, expect.objectContaining({
      by: ["runId", "value"],
      where: expect.objectContaining({ vendorId: "vendor-current", liveId: live.id }),
    }));
    expect(mocks.liveQuestionGroupBy).toHaveBeenCalledWith({
      by: ["status"],
      where: { vendorId: "vendor-current", liveId: live.id },
      _count: { _all: true },
    });
    expect(html).toContain("最喜歡哪款？");
    expect(html).toContain("3 票 · 75%");
    expect(html).toContain("限定禮盒");
    expect(html).toContain("張*芬");
    expect(html).not.toContain("張小芬");
    expect(html).toContain("領取到轉換 CVR：40%");
    expect(html).toContain("陳*明");
    expect(html).not.toContain("陳小明");
    expect(html).toContain("NT$1,200");
    expect(html).toContain("NT$300");
    expect(html).toContain("夏季夥伴");
    expect(html).toContain("20%");
    expect(html).toContain("2 Confirmed · 1 Pending");
  });
});
