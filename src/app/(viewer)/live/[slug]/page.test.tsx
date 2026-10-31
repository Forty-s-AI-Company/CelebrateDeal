import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  findFirst: vi.fn(),
  getRuntimeLivePublishReadiness: vi.fn(),
  resolveLiveRuntime: vi.fn(),
  notFound: vi.fn(() => {
    throw new Error("NEXT_NOT_FOUND");
  }),
  warn: vi.fn(),
  headers: vi.fn(),
  liveSessionFindMany: vi.fn(),
  formSubmissionFindFirst: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  notFound: mocks.notFound,
}));

vi.mock("next/headers", () => ({
  headers: mocks.headers,
}));

vi.mock("@/lib/db", () => ({
  getDb: () => ({
    live: {
      findFirst: mocks.findFirst,
    },
    liveSession: { findMany: mocks.liveSessionFindMany },
    formSubmission: { findFirst: mocks.formSubmissionFindFirst },
  }),
}));

vi.mock("@/lib/live-runtime-readiness", () => ({
  getRuntimeLivePublishReadiness: mocks.getRuntimeLivePublishReadiness,
}));

vi.mock("@/lib/live-runtime-state", () => ({
  resolveLiveRuntime: mocks.resolveLiveRuntime,
}));

vi.mock("@/components/live-playback", () => ({
  LivePlayback: () => null,
}));

import PublicLivePage, { generateMetadata } from "./page";

const validFields = [
  { key: "name", label: "姓名", type: "text", required: true },
  { key: "email", label: "Email", type: "email", required: true },
];
const readyVideo = {
  vendorId: "vendor-1",
  sourceType: "url",
  status: "ready",
  durationSec: 3_600,
  cloudflareReadyToStream: false,
  cloudflareLiveInputUid: null,
  liveInputStatus: null,
};
const readyRegistrationTemplate = {
  vendorId: "vendor-1",
  channel: "email",
  trigger: "registration_confirmed",
  isActive: true,
  subject: "報名 {{live_title}}",
  body: "{{name}} {{unsubscribe_url}}",
};

const publicLive = {
  id: "live-1",
  title: "公開直播",
  slug: "public-live",
  status: "scheduled",
  description: null,
  accentCopy: null,
  heroImageUrl: null,
  vendorId: "vendor-1",
  streamMode: "vod",
  scheduledAt: new Date("2026-08-20T01:00:00.000Z"),
  startedAt: null,
  endedAt: null,
  replayAvailableUntil: null,
  replayEnabled: true,
  vendor: {
    name: "測試商店",
    logoUrl: null,
    primaryColor: "#2563eb",
    ctaColor: "#f97316",
  },
  video: readyVideo,
  form: null,
  messageTemplate: null,
  interactionScript: null,
  products: [],
};

function runtimeReadySalesLive() {
  return {
    ...publicLive,
    form: { id: "form-1", vendorId: "vendor-1", isActive: true, headline: "報名", description: null, fields: validFields, submitLabel: "送出", successMessage: "完成" },
    messageTemplate: readyRegistrationTemplate,
    interactionScript: { vendorId: "vendor-1", status: "published", events: [] },
    products: [{
      vendorId: "vendor-1",
      offerLabel: null,
      product: { id: "product-1", vendorId: "vendor-1", isActive: true, fulfillmentTypeConfirmed: true, name: "商品", description: null, priceCents: 1000, compareAtCents: null, currency: "TWD", imageUrl: null, checkoutUrl: null },
    }],
  };
}

beforeEach(() => {
  vi.restoreAllMocks();
  vi.clearAllMocks();
  vi.spyOn(console, "warn").mockImplementation(mocks.warn);
  mocks.getRuntimeLivePublishReadiness.mockReturnValue({ ready: true });
  mocks.resolveLiveRuntime.mockReturnValue({ state: "playing", playbackStartSeconds: 0 });
  mocks.findFirst.mockResolvedValue(publicLive);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("PublicLivePage generateMetadata", () => {
  const params = Promise.resolve({ slug: "public-live" });

  it("uses the live title, copy and cover image for share previews", async () => {
    mocks.findFirst.mockResolvedValue({ ...publicLive, accentCopy: "限時 <b>優惠</b>", heroImageUrl: "https://cdn.example.test/cover.png" });
    expect(await generateMetadata({ params })).toMatchObject({
      title: "公開直播",
      description: "限時 <b>優惠</b>",
      openGraph: { title: "公開直播", siteName: "測試商店", images: ["https://cdn.example.test/cover.png"] },
      twitter: { card: "summary_large_image" },
    });
  });

  it("drops non-http cover images and falls back to a generic description", async () => {
    mocks.findFirst.mockResolvedValue({ ...publicLive, heroImageUrl: "javascript:alert(1)" });
    const metadata = await generateMetadata({ params });
    expect(metadata.description).toBe("測試商店 的直播");
    expect(metadata.openGraph).not.toHaveProperty("images");
  });

  it("does not leak content for missing or not-ready lives", async () => {
    mocks.findFirst.mockResolvedValue(null);
    expect(await generateMetadata({ params })).toEqual({ title: "頁面不存在", robots: { index: false, follow: false } });
    mocks.findFirst.mockResolvedValue(publicLive);
    mocks.getRuntimeLivePublishReadiness.mockReturnValue({ ready: false, blockers: [] });
    const metadata = await generateMetadata({ params });
    expect(metadata).toEqual({ title: "頁面不存在", robots: { index: false, follow: false } });
    expect(JSON.stringify(metadata)).not.toContain("公開直播");
  });
});

describe("PublicLivePage", () => {
  it("passes only normalized advanced event settings to the public player", async () => {
    mocks.findFirst.mockResolvedValue({
      ...publicLive,
      interactionScript: {
        vendorId: "vendor-1", status: "published",
        events: [{ id: "poll-1", eventType: "poll", triggerSec: 10, title: "投票", role: null,
          metadata: { question: "選哪個？", options: ["A", "B"], durationSec: 30, internalNote: "private" } }],
      },
    });
    const element = await PublicLivePage({ params: Promise.resolve({ slug: "public-live" }) });
    expect(element.props.live.interactionEvents[0].metadata).toEqual({
      kind: "poll", question: "選哪個？", durationSec: 30,
      options: [{ id: "option-1", label: "A" }, { id: "option-2", label: "B" }],
    });
  });

  it("only resolves scheduled, live, or replay-enabled ended lives", async () => {
    await PublicLivePage({ params: Promise.resolve({ slug: "public-live" }) });

    expect(mocks.findFirst).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
      where: expect.objectContaining({
        slug: "public-live",
        OR: expect.arrayContaining([
          { status: { in: ["scheduled", "live"] } },
          { status: "ended", replayEnabled: true },
          { status: "ended", replayEnabled: false },
          { status: "ended", replayAvailableUntil: { lte: expect.any(Date) } },
        ]),
      }),
    }));
    expect(mocks.notFound).not.toHaveBeenCalled();
    expect(mocks.warn).not.toHaveBeenCalled();
  });

  it("loads every linked product for runtime validation and omits an optional inactive content form", async () => {
    mocks.findFirst.mockResolvedValue({
      ...publicLive,
      form: {
        id: "form-1",
        isActive: false,
        headline: "停用表單",
        description: null,
        fields: [],
        submitLabel: "送出",
        successMessage: "完成",
      },
    });

    const element = await PublicLivePage({
      params: Promise.resolve({ slug: "public-live" }),
    });

    expect(mocks.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      include: expect.objectContaining({
        products: {
          orderBy: { sortOrder: "asc" },
          include: { product: true },
        },
        video: true,
        messageTemplate: true,
      }),
    }));
    expect(element.props.live.form).toBeNull();
    expect(element.props.live.chatEnabled).toBe(false);
  });

  it("returns not found when a waiting runtime is not publish-ready", async () => {
    mocks.resolveLiveRuntime.mockReturnValue({ state: "waiting", playbackStartSeconds: null });
    mocks.getRuntimeLivePublishReadiness.mockReturnValue({ ready: false, blockers: [{ code: "media", ready: false }] });

    await expect(PublicLivePage({ params: Promise.resolve({ slug: "public-live" }) }))
      .rejects.toThrow("NEXT_NOT_FOUND");

    expect(mocks.notFound).toHaveBeenCalledOnce();
    expect(mocks.warn).toHaveBeenCalledExactlyOnceWith("PUBLIC_LIVE_NOT_FOUND_READINESS", ["media"]);
  });

  it("returns not found when an unavailable runtime is not publish-ready", async () => {
    mocks.resolveLiveRuntime.mockReturnValue({ state: "unavailable", playbackStartSeconds: null });
    mocks.findFirst.mockResolvedValue({
      ...publicLive,
      status: "ended",
      replayEnabled: true,
      replayAvailableUntil: new Date("2026-08-01T00:00:00.000Z"),
    });
    mocks.getRuntimeLivePublishReadiness.mockReturnValue({ ready: false, blockers: [{ code: "media", ready: false }] });

    await expect(PublicLivePage({ params: Promise.resolve({ slug: "public-live" }) }))
      .rejects.toThrow("NEXT_NOT_FOUND");

    expect(mocks.notFound).toHaveBeenCalledOnce();
    expect(mocks.warn).toHaveBeenCalledExactlyOnceWith("PUBLIC_LIVE_NOT_FOUND_READINESS", ["media"]);
  });

  it.each([
    ["expired", { replayEnabled: true, replayAvailableUntil: new Date("2026-08-01T00:00:00.000Z") }],
    ["disabled", { replayEnabled: false, replayAvailableUntil: null }],
  ])("projects a publish-ready %s replay as unavailable without exposing playback data", async (_label, overrides) => {
    mocks.resolveLiveRuntime.mockReturnValue({ state: "unavailable", playbackStartSeconds: null });
    mocks.findFirst.mockResolvedValue({
      ...publicLive,
      status: "ended",
      ...overrides,
    });

    const element = await PublicLivePage({ params: Promise.resolve({ slug: "public-live" }) });

    expect(mocks.notFound).not.toHaveBeenCalled();
    expect(element.props.live.runtimeState).toBe("unavailable");
    expect(element.props.live).not.toHaveProperty("videoUrl");
  });

  it("returns not found when the lifecycle filter rejects the live", async () => {
    mocks.findFirst.mockResolvedValue(null);

    await expect(PublicLivePage({
      params: Promise.resolve({ slug: "draft-live" }),
    })).rejects.toThrow("NEXT_NOT_FOUND");

    expect(mocks.notFound).toHaveBeenCalledOnce();
    expect(mocks.warn).toHaveBeenCalledExactlyOnceWith("PUBLIC_LIVE_NOT_FOUND_AVAILABILITY");
    expect(JSON.stringify(mocks.warn.mock.calls)).not.toContain("draft-live");
  });

  it.each([
    ["media", "media", { video: null }],
    ["form", "registration_form", { form: { id: "form-1", vendorId: "vendor-1", isActive: false, fields: validFields } }],
    ["email", "registration_email", { messageTemplate: { ...readyRegistrationTemplate, isActive: false } }],
    ["script", "interaction_script", { interactionScript: { vendorId: "vendor-1", status: "draft", events: [] } }],
    ["product", "products", { products: [{ vendorId: "vendor-1", offerLabel: null, product: { id: "product-1", vendorId: "vendor-1", isActive: false, fulfillmentTypeConfirmed: true } }] }],
  ])("returns not found when a published sales live has stale %s readiness", async (_label, blockerCode, overrides) => {
    mocks.getRuntimeLivePublishReadiness.mockReturnValue({ ready: false, blockers: [{ code: blockerCode, ready: false }] });
    mocks.findFirst.mockResolvedValue({ ...runtimeReadySalesLive(), ...overrides });

    await expect(PublicLivePage({ params: Promise.resolve({ slug: "public-live" }) }))
      .rejects.toThrow("NEXT_NOT_FOUND");

    expect(mocks.warn).toHaveBeenCalledExactlyOnceWith("PUBLIC_LIVE_NOT_FOUND_READINESS", [blockerCode]);
    expect(JSON.stringify(mocks.warn.mock.calls)).not.toContain("public-live");
  });

  it("maps only a strictly valid registration schema into playback", async () => {
    const fields = [
      { key: "name", label: "姓名", type: "text", required: true },
      { key: "email", label: "Email", type: "email", required: true },
      { key: "website", label: "網站", type: "url", required: false },
    ];
    mocks.findFirst.mockResolvedValue({
      ...publicLive,
      form: {
        id: "form-valid",
        vendorId: "vendor-1",
        isActive: true,
        headline: "立即登記",
        description: "報名說明",
        submitLabel: "送出資料",
        successMessage: "已完成",
        fields,
      },
    });

    const element = await PublicLivePage({ params: Promise.resolve({ slug: "public-live" }) });

    expect(element.props.live.form).toEqual({
      id: "form-valid",
      headline: "立即登記",
      description: "報名說明",
      submitLabel: "送出資料",
      successMessage: "已完成",
      fields,
    });
    expect(element.props.live).not.toHaveProperty("formConfigurationUnavailable");
    expect(element.props.live.chatEnabled).toBe(true);
  });

  it("maps public commerce data without exposing the playback source", async () => {
    mocks.findFirst.mockResolvedValue({
      ...publicLive,
      status: "live",
      description: "直播說明",
      accentCopy: "限時優惠",
      heroImageUrl: "/hero.png",
      vendor: { name: "品牌商店", logoUrl: "/logo.png", primaryColor: "#123456", ctaColor: "#654321" },
      video: readyVideo,
      form: {
        id: "form-1", vendorId: "vendor-1", isActive: true, headline: "立即登記", description: "報名說明", submitLabel: "送出資料", successMessage: "已完成",
        fields: validFields,
      },
      messageTemplate: readyRegistrationTemplate,
      interactionScript: {
        vendorId: "vendor-1",
        status: "published",
        events: [
          { id: "event-1", eventType: "CTA", triggerSec: 12, title: "第一段", message: "看看課程", productId: "product-1", ctaLabel: "查看", ctaUrl: "/products/1", role: { vendorId: "vendor-1", name: "主持人", avatarUrl: "/host.png", label: "講師", roleType: "HOST", isActive: true, isScheduled: false } },
          { id: "event-2", eventType: "chat_message", triggerSec: 24, title: "第二段", message: "歡迎", productId: null, ctaLabel: null, ctaUrl: null, role: { vendorId: "vendor-1", name: "直播小編", avatarUrl: "/host.png", label: "官方角色", roleType: "official", isActive: true, isScheduled: true } },
        ],
      },
      products: [{
        vendorId: "vendor-1",
        offerLabel: "直播優惠", product: { id: "product-1", vendorId: "vendor-1", isActive: true, fulfillmentTypeConfirmed: true, name: "主打課程", description: "完整課程", priceCents: 168000, compareAtCents: 198000, currency: "TWD", imageUrl: "/product.png", checkoutUrl: "/checkout/product-1" },
      }],
    });

    const element = await PublicLivePage({ params: Promise.resolve({ slug: "public-live" }) });
    expect(element.props.live).toEqual({
      id: "live-1", title: "公開直播", slug: "public-live", status: "live", runtimeState: "playing", scheduledAt: publicLive.scheduledAt.toISOString(), serverNow: expect.any(String), description: "直播說明", accentCopy: "限時優惠", heroImageUrl: "/hero.png", vendorId: "vendor-1", admissionRequired: true, chatEnabled: true,
      brand: { name: "品牌商店", logoUrl: "/logo.png", primaryColor: "#123456", ctaColor: "#654321" },
      form: { id: "form-1", headline: "立即登記", description: "報名說明", submitLabel: "送出資料", successMessage: "已完成", fields: validFields },
      interactionEvents: [
        { id: "event-1", eventType: "CTA", triggerSec: 12, title: "第一段", message: "看看課程", productId: "product-1", ctaLabel: "查看", ctaUrl: "/products/1", role: { name: "主持人", avatarUrl: "/host.png", label: "講師" } },
      ],
      scheduledMessages: [{
        id: "event-2",
        source: "scheduled",
        triggerSec: 24,
        body: "歡迎",
        actor: { name: "直播小編", avatarUrl: null, label: null, presentationRole: "official" },
      }],
      products: [{ id: "product-1", name: "主打課程", description: "完整課程", priceCents: 168000, compareAtCents: 198000, currency: "TWD", imageUrl: "/product.png", checkoutUrl: "/checkout/product-1", offerLabel: "直播優惠" }],
    });
  });

  it.each([
    ["draft", "vendor-1"],
    ["published", "vendor-2"],
  ])("fails closed for a %s interaction script owned by %s", async (status, vendorId) => {
    mocks.getRuntimeLivePublishReadiness.mockReturnValue({
      ready: false,
      blockers: [{ code: "interaction_script", ready: false }],
    });
    mocks.findFirst.mockResolvedValue({
      ...publicLive,
      form: { id: "form-1", vendorId: "vendor-1", isActive: true, fields: validFields },
      messageTemplate: readyRegistrationTemplate,
      products: [{
        vendorId: "vendor-1",
        offerLabel: null,
        product: {
          id: "product-1",
          vendorId: "vendor-1",
          isActive: true,
          fulfillmentTypeConfirmed: true,
          name: "可售商品",
          description: null,
          priceCents: 1000,
          compareAtCents: null,
          currency: "TWD",
          imageUrl: null,
          checkoutUrl: null,
        },
      }],
      interactionScript: {
        vendorId,
        status,
        events: [{
          id: "event-legacy",
          eventType: "chat_message",
          triggerSec: 0,
          title: "不應公開",
          message: "不應公開",
          productId: null,
          ctaLabel: null,
          ctaUrl: null,
          role: null,
        }],
      },
    });

    await expect(PublicLivePage({ params: Promise.resolve({ slug: "public-live" }) }))
      .rejects.toThrow("NEXT_NOT_FOUND");
  });

  it("removes a role payload that does not belong to the live vendor", async () => {
    mocks.findFirst.mockResolvedValue({
      ...publicLive,
      interactionScript: {
        vendorId: "vendor-1",
        status: "published",
        events: [{
          id: "event-legacy-role",
          eventType: "chat_message",
          triggerSec: 0,
          title: "歡迎",
          message: "歡迎",
          productId: null,
          ctaLabel: null,
          ctaUrl: null,
          role: { vendorId: "vendor-2", name: "其他商店角色", avatarUrl: null, label: "官方角色", roleType: "official" },
        }],
      },
    });

    const element = await PublicLivePage({ params: Promise.resolve({ slug: "public-live" }) });

    expect(element.props.live.interactionEvents).toEqual([]);
    expect(element.props.live.scheduledMessages).toEqual([]);
  });

  it("omits public messages assigned to a disabled role without hiding system or commerce events", async () => {
    mocks.findFirst.mockResolvedValue({
      ...publicLive,
      form: { id: "form-1", vendorId: "vendor-1", isActive: true, fields: validFields },
      messageTemplate: readyRegistrationTemplate,
      interactionScript: {
        vendorId: "vendor-1",
        status: "published",
        events: [
          {
            id: "event-disabled-chat",
            eventType: "chat_message",
            triggerSec: 0,
            title: "停用角色留言",
            message: "不應公開",
            productId: null,
            ctaLabel: null,
            ctaUrl: null,
            role: {
              vendorId: "vendor-1",
              name: "已停用角色",
              avatarUrl: null,
              label: "官方角色",
              roleType: "official",
              isActive: false,
            },
          },
          {
            id: "event-system-chat",
            eventType: "chat_message",
            triggerSec: 1,
            title: "官方系統留言",
            message: "可以公開",
            productId: null,
            ctaLabel: null,
            ctaUrl: null,
            role: null,
          },
          {
            id: "event-product",
            eventType: "product_spotlight",
            triggerSec: 2,
            title: "商品聚焦",
            message: null,
            productId: "product-1",
            ctaLabel: null,
            ctaUrl: null,
            role: null,
          },
        ],
      },
      products: [{
        vendorId: "vendor-1",
        offerLabel: "直播商品",
        product: {
          id: "product-1",
          vendorId: "vendor-1",
          isActive: true,
          fulfillmentTypeConfirmed: true,
          name: "可售商品",
          description: null,
          priceCents: 1200,
          compareAtCents: null,
          currency: "TWD",
          imageUrl: null,
          checkoutUrl: "/checkout/product-1",
        },
      }],
    });

    const element = await PublicLivePage({ params: Promise.resolve({ slug: "public-live" }) });

    expect(element.props.live.interactionEvents.map((event: { id: string }) => event.id)).toEqual(["event-product"]);
    expect(element.props.live.scheduledMessages).toEqual([]);
  });

  it("projects only valid scheduled chat messages and keeps private role fields out of the client props", async () => {
    mocks.findFirst.mockResolvedValue({
      ...publicLive,
      interactionScript: {
        vendorId: "vendor-1",
        status: "published",
        events: [
          {
            id: "scheduled-official",
            eventType: "chat_message",
            triggerSec: 10,
            title: "官方訊息",
            message: "歡迎",
            productId: null,
            ctaLabel: null,
            ctaUrl: null,
            role: { vendorId: "vendor-1", name: "官方小編", avatarUrl: "https://cdn.example.test/official.png", label: "官方角色", roleType: "official", isActive: true, isScheduled: true, roleId: "secret-role" },
          },
          {
            id: "scheduled-audience",
            eventType: "reminder",
            triggerSec: 20,
            title: "觀眾訊息",
            message: "記得看看商品",
            productId: null,
            ctaLabel: null,
            ctaUrl: null,
            role: { vendorId: "vendor-1", name: "小明", avatarUrl: null, label: "一般觀眾", roleType: "audience", isActive: true, isScheduled: true },
          },
          {
            id: "cross-tenant",
            eventType: "chat_message",
            triggerSec: 30,
            title: "跨租戶",
            message: "不應公開",
            productId: null,
            ctaLabel: null,
            ctaUrl: null,
            role: { vendorId: "vendor-2", name: "外部角色", avatarUrl: null, label: "官方角色", roleType: "official", isActive: true, isScheduled: true },
          },
          {
            id: "inactive",
            eventType: "chat_message",
            triggerSec: 40,
            title: "停用",
            message: "不應公開",
            productId: null,
            ctaLabel: null,
            ctaUrl: null,
            role: { vendorId: "vendor-1", name: "停用角色", avatarUrl: null, label: "官方角色", roleType: "official", isActive: false, isScheduled: true },
          },
          {
            id: "not-scheduled",
            eventType: "chat_message",
            triggerSec: 50,
            title: "未排程",
            message: "不應公開",
            productId: null,
            ctaLabel: null,
            ctaUrl: null,
            role: { vendorId: "vendor-1", name: "一般角色", avatarUrl: null, label: "官方角色", roleType: "official", isActive: true, isScheduled: false },
          },
        ],
      },
    });

    const element = await PublicLivePage({ params: Promise.resolve({ slug: "public-live" }) });
    expect(element.props.live.scheduledMessages).toEqual([
      expect.objectContaining({ id: "scheduled-official", source: "scheduled", triggerSec: 10, body: "歡迎", actor: expect.objectContaining({ presentationRole: "official" }) }),
      expect.objectContaining({ id: "scheduled-audience", source: "scheduled", triggerSec: 20, body: "記得看看商品", actor: expect.objectContaining({ presentationRole: "audience" }) }),
    ]);
    expect(element.props.live.scheduledMessages[0]).not.toHaveProperty("roleId");
    expect(element.props.live.scheduledMessages[0]).not.toHaveProperty("roleType");
    expect(element.props.live.interactionEvents).toEqual([]);
  });

  it("omits a product spotlight that is not in the live's current saleable product set", async () => {
    mocks.findFirst.mockResolvedValue({
      ...publicLive,
      form: { id: "form-1", vendorId: "vendor-1", isActive: true, fields: validFields },
      messageTemplate: readyRegistrationTemplate,
      interactionScript: {
        vendorId: "vendor-1",
        status: "published",
        events: [{
          id: "event-stale-product",
          eventType: "product_spotlight",
          triggerSec: 0,
          title: "失效商品",
          message: null,
          productId: "product-disabled",
          ctaLabel: null,
          ctaUrl: null,
          role: null,
        }],
      },
      products: [{
        vendorId: "vendor-1",
        offerLabel: "直播商品",
        product: {
          id: "product-current",
          vendorId: "vendor-1",
          isActive: true,
          fulfillmentTypeConfirmed: true,
          name: "目前商品",
          description: null,
          priceCents: 1200,
          compareAtCents: null,
          currency: "TWD",
          imageUrl: null,
          checkoutUrl: null,
        },
      }],
    });

    const element = await PublicLivePage({ params: Promise.resolve({ slug: "public-live" }) });

    expect(element.props.live.interactionEvents).toEqual([]);
    expect(element.props.live.products).toEqual([
      expect.objectContaining({ id: "product-current", name: "目前商品" }),
    ]);
  });

  it("fails closed for malformed form fields while keeping other safe empty fallbacks", async () => {
    mocks.findFirst.mockResolvedValue({
      ...publicLive,
      form: { id: "form-2", vendorId: "vendor-1", isActive: true, headline: "表單", description: null, fields: { unexpected: true }, submitLabel: "送出", successMessage: "完成" },
      interactionScript: null,
      products: [],
    });

    const element = await PublicLivePage({ params: Promise.resolve({ slug: "public-live" }) });
    expect(element.props.live.form).toBeNull();
    expect(element.props.live.formConfigurationUnavailable).toBe(true);
    expect(element.props.live.chatEnabled).toBe(false);
    expect(element.props.live.videoUrl).toBeUndefined();
    expect(element.props.live.interactionEvents).toEqual([]);
    expect(element.props.live.products).toEqual([]);
    expect(Object.keys(element.props.live)).toEqual([
      "id", "title", "slug", "status", "runtimeState", "scheduledAt", "serverNow", "description", "accentCopy", "heroImageUrl", "vendorId", "admissionRequired", "chatEnabled", "brand", "form", "formConfigurationUnavailable", "interactionEvents", "scheduledMessages", "products",
    ]);
    expect(mocks.headers).not.toHaveBeenCalled();
  });
});

describe("PublicLivePage evergreen session", () => {
  const product = (id: string, name: string) => ({
    vendorId: "vendor-1",
    offerLabel: id === "product-1" ? "早鳥價" : null,
    product: { id, vendorId: "vendor-1", isActive: true, fulfillmentTypeConfirmed: true, name, description: null, priceCents: 1000, compareAtCents: null, currency: "TWD", imageUrl: null, checkoutUrl: null },
  });
  const event = (id: string, eventType: string, triggerSec: number, productId: string | null = null) => ({
    id, eventType, triggerSec, title: id, message: null, productId, ctaLabel: eventType === "cta_switch" ? "了解更多" : null, ctaUrl: eventType === "cta_switch" ? "https://shop.example.test/more" : null, role: null,
    metadata: eventType === "poll" ? { question: "選哪個？", options: ["A", "B"], durationSec: 30 } : null,
  });

  function evergreenSalesLive(overrides: Record<string, unknown> = {}) {
    return {
      ...runtimeReadySalesLive(),
      status: "scheduled",
      scheduledAt: new Date("2026-01-01T00:00:00.000Z"),
      replayEnabled: false,
      vendor: { ...publicLive.vendor, timezone: "Asia/Taipei" },
      video: { ...readyVideo, durationSec: 1_800 },
      isEvergreen: true,
      evergreenScheduleMode: "just_in_time",
      evergreenIntervalMinutes: 15,
      evergreenDailyTimes: [],
      evergreenSessionStartAt: null,
      evergreenPitchAtSeconds: 200,
      evergreenConsultationAtSeconds: null,
      interactionScript: {
        vendorId: "vendor-1",
        status: "published",
        events: [
          event("spotlight-reached", "product_spotlight", 60, "product-2"),
          event("poll-shared-run", "poll", 100),
          event("cta-later", "cta_switch", 400),
        ],
      },
      products: [product("product-1", "早鳥課程"), product("product-2", "進階課程")],
      ...overrides,
    };
  }

  async function sessionCookie(enteredAt: Date, live = evergreenSalesLive()) {
    const { resolveEvergreenViewerSession, evergreenSessionCookieName } = await import("@/lib/evergreen-viewer-session");
    const session = resolveEvergreenViewerSession({ live: live as never, vendorTimezone: "Asia/Taipei", token: null, intent: "claim", now: enteredAt });
    return { name: evergreenSessionCookieName("live-1"), value: session!.issuedToken! };
  }

  function withCookie(cookie: { name: string; value: string } | null) {
    mocks.headers.mockResolvedValue(new Headers(cookie ? { cookie: `analytics=1; ${cookie.name}=${cookie.value}` } : {}));
  }

  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubEnv("CSRF_SECRET", "public-live-evergreen-page-test-secret-0123456789");
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
  });

  it("keeps a first visit in the waiting room with every offer and product withheld", async () => {
    vi.setSystemTime(new Date("2026-10-29T06:03:00.000Z"));
    withCookie(null);
    mocks.findFirst.mockResolvedValue(evergreenSalesLive());

    const element = await PublicLivePage({ params: Promise.resolve({ slug: "public-live" }) });
    expect(element.props.live).toMatchObject({
      runtimeState: "waiting",
      scheduledAt: "2026-10-29T06:15:00.000Z",
      evergreen: { assigned: false, roomState: "waiting_countdown", timezone: "Asia/Taipei", nextRevealAtSec: null },
    });
    expect(element.props.live.interactionEvents).toEqual([]);
    expect(element.props.live.products).toEqual([]);
  });

  it("ships only the offers the visitor's own session reached and the next reveal second", async () => {
    const cookie = await sessionCookie(new Date("2026-10-29T06:03:00.000Z"));
    vi.setSystemTime(new Date("2026-10-29T06:20:00.000Z"));
    withCookie(cookie);
    mocks.findFirst.mockResolvedValue(evergreenSalesLive());

    const element = await PublicLivePage({ params: Promise.resolve({ slug: "public-live" }) });
    expect(element.props.live).toMatchObject({
      runtimeState: "playing",
      scheduledAt: "2026-10-29T06:15:00.000Z",
      evergreen: { assigned: true, roomState: "playing", offsetSeconds: 300, nextRevealAtSec: 400, canRejoin: false },
    });
    // The pitch (200s) spotlight is reached; the 400s CTA is withheld and the shared-run poll is never offered.
    expect(element.props.live.interactionEvents.map((item: { id: string }) => item.id)).toEqual(["spotlight-reached", "evergreen-pitch"]);
    expect(element.props.live.products.map((item: { id: string }) => item.id)).toEqual(["product-1", "product-2"]);
    expect(JSON.stringify(element.props.live)).not.toContain("https://shop.example.test/more");
    expect(JSON.stringify(element.props.live)).not.toContain(cookie.value);
  });

  it("withholds the coupon until its second and reveals it after a refresh", async () => {
    const cookie = await sessionCookie(new Date("2026-10-29T06:03:00.000Z"));
    vi.setSystemTime(new Date("2026-10-29T06:16:30.000Z"));
    withCookie(cookie);
    mocks.findFirst.mockResolvedValue(evergreenSalesLive());

    const early = await PublicLivePage({ params: Promise.resolve({ slug: "public-live" }) });
    expect(early.props.live.evergreen).toMatchObject({ offsetSeconds: 90, nextRevealAtSec: 200 });
    expect(early.props.live.interactionEvents.map((item: { id: string }) => item.id)).toEqual(["spotlight-reached"]);
    expect(early.props.live.products.map((item: { id: string }) => item.id)).toEqual(["product-2"]);
  });

  it("ships the whole offer timeline once the session ended into an open replay", async () => {
    const cookie = await sessionCookie(new Date("2026-10-29T06:03:00.000Z"));
    vi.setSystemTime(new Date("2026-10-29T07:00:00.000Z"));
    withCookie(cookie);
    mocks.findFirst.mockResolvedValue(evergreenSalesLive({ replayEnabled: true }));

    const element = await PublicLivePage({ params: Promise.resolve({ slug: "public-live" }) });
    expect(element.props.live).toMatchObject({ runtimeState: "replay", evergreen: { roomState: "ended" } });
    expect(element.props.live.interactionEvents.map((item: { id: string }) => item.id)).toEqual(["spotlight-reached", "evergreen-pitch", "cta-later"]);
  });

  it("shows an ended session with a rejoin option when replay is closed", async () => {
    const cookie = await sessionCookie(new Date("2026-10-29T06:03:00.000Z"));
    vi.setSystemTime(new Date("2026-10-29T07:00:00.000Z"));
    withCookie(cookie);
    mocks.findFirst.mockResolvedValue(evergreenSalesLive());

    const element = await PublicLivePage({ params: Promise.resolve({ slug: "public-live" }) });
    expect(element.props.live).toMatchObject({ runtimeState: "unavailable", evergreen: { roomState: "ended", canRejoin: true } });
    expect(element.props.live.products).toEqual([]);
  });

  it("keeps a merchant-ended evergreen live on the regular lifecycle", async () => {
    vi.setSystemTime(new Date("2026-10-29T06:03:00.000Z"));
    withCookie(null);
    mocks.resolveLiveRuntime.mockReturnValue({ state: "replay", playbackStartSeconds: null });
    mocks.findFirst.mockResolvedValue(evergreenSalesLive({ status: "ended", replayEnabled: true }));

    const element = await PublicLivePage({ params: Promise.resolve({ slug: "public-live" }) });
    expect(element.props.live.runtimeState).toBe("replay");
    expect(element.props.live).not.toHaveProperty("evergreen");
  });
});

describe("PublicLivePage fixed sessions (指定場次)", () => {
  const sessionStart = new Date("2026-10-30T06:00:00.000Z");
  const fixedLive = () => ({
    ...runtimeReadySalesLive(),
    sessionMode: "fixed_sessions",
    sessionRegistrationCutoffMinutes: 0,
    sessionReplayWindowHours: null,
    scheduledAt: new Date("2026-10-31T12:00:00.000Z"),
    vendor: { ...publicLive.vendor, timezone: "Asia/Taipei" },
  });

  beforeEach(() => {
    vi.stubEnv("CSRF_SECRET", "public-live-fixed-session-page-test-secret-0123456789");
    mocks.headers.mockResolvedValue(new Headers({}));
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("times the page from the session the visitor follows instead of the shared scheduledAt", async () => {
    mocks.findFirst.mockResolvedValue(fixedLive());
    mocks.liveSessionFindMany.mockResolvedValue([
      { id: "session-a", startAt: sessionStart, capacity: null, registeredCount: 0, status: "open" },
      { id: "session-b", startAt: new Date("2026-10-31T12:00:00.000Z"), capacity: null, registeredCount: 0, status: "open" },
    ]);
    mocks.resolveLiveRuntime.mockReturnValue({ state: "playing", playbackStartSeconds: 120 });
    vi.useFakeTimers();
    vi.setSystemTime(new Date(sessionStart.getTime() + 120_000));
    try {
      const element = await PublicLivePage({ params: Promise.resolve({ slug: "public-live" }) });
      expect(element.props.live).toMatchObject({ runtimeState: "playing", scheduledAt: sessionStart.toISOString() });
      expect(element.props.live.evergreen).toBeUndefined();
      // The session lookup is bound to this Live and vendor and skips cancelled sessions.
      expect(mocks.liveSessionFindMany).toHaveBeenCalledWith(expect.objectContaining({
        where: { vendorId: "vendor-1", liveId: "live-1", status: { not: "cancelled" } },
      }));
      // The shared runtime is evaluated on the session's own start.
      expect(mocks.resolveLiveRuntime).toHaveBeenLastCalledWith(expect.objectContaining({ scheduledAt: sessionStart, streamMode: "vod" }), expect.any(Date));
      expect(mocks.formSubmissionFindFirst).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it("keeps a visitor in the waiting room when the Live has no session left to follow", async () => {
    mocks.findFirst.mockResolvedValue(fixedLive());
    mocks.liveSessionFindMany.mockResolvedValue([]);
    const element = await PublicLivePage({ params: Promise.resolve({ slug: "public-live" }) });
    expect(element.props.live).toMatchObject({ runtimeState: "waiting", scheduledAt: "2026-10-31T12:00:00.000Z" });
  });

  it("leaves a Live without sessions on its shared schedule", async () => {
    mocks.findFirst.mockResolvedValue({ ...runtimeReadySalesLive(), sessionMode: "single" });
    const element = await PublicLivePage({ params: Promise.resolve({ slug: "public-live" }) });
    expect(element.props.live).toMatchObject({ runtimeState: "playing", scheduledAt: publicLive.scheduledAt.toISOString() });
    expect(mocks.liveSessionFindMany).not.toHaveBeenCalled();
  });
});