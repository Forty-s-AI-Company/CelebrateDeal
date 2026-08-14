import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  findFirst: vi.fn(),
  notFound: vi.fn(() => {
    throw new Error("NEXT_NOT_FOUND");
  }),
}));

vi.mock("next/navigation", () => ({
  notFound: mocks.notFound,
}));

vi.mock("@/lib/db", () => ({
  getDb: () => ({
    live: {
      findFirst: mocks.findFirst,
    },
  }),
}));

vi.mock("@/components/live-playback", () => ({
  LivePlayback: () => null,
}));

import PublicLivePage from "./page";

const validFields = [
  { key: "name", label: "姓名", type: "text", required: true },
  { key: "email", label: "Email", type: "email", required: true },
];
const readyVideo = {
  vendorId: "vendor-1",
  sourceType: "url",
  status: "ready",
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
  vi.clearAllMocks();
  mocks.findFirst.mockResolvedValue(publicLive);
});

describe("PublicLivePage", () => {
  it("only resolves scheduled, live, or replay-enabled ended lives", async () => {
    await PublicLivePage({ params: Promise.resolve({ slug: "public-live" }) });

    expect(mocks.findFirst).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
      where: {
        slug: "public-live",
        OR: [
          { status: { in: ["scheduled", "live"] } },
          { status: "ended", replayEnabled: true },
        ],
      },
    }));
    expect(mocks.notFound).not.toHaveBeenCalled();
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
  });

  it("returns not found when the lifecycle filter rejects the live", async () => {
    mocks.findFirst.mockResolvedValue(null);

    await expect(PublicLivePage({
      params: Promise.resolve({ slug: "draft-live" }),
    })).rejects.toThrow("NEXT_NOT_FOUND");

    expect(mocks.notFound).toHaveBeenCalledOnce();
  });

  it.each([
    ["media", { video: null }],
    ["form", { form: { id: "form-1", vendorId: "vendor-1", isActive: false, fields: validFields } }],
    ["email", { messageTemplate: { ...readyRegistrationTemplate, isActive: false } }],
    ["script", { interactionScript: { vendorId: "vendor-1", status: "draft", events: [] } }],
    ["product", { products: [{ vendorId: "vendor-1", offerLabel: null, product: { id: "product-1", vendorId: "vendor-1", isActive: false, fulfillmentTypeConfirmed: true } }] }],
  ])("returns not found when a published sales live has stale %s readiness", async (_label, overrides) => {
    mocks.findFirst.mockResolvedValue({ ...runtimeReadySalesLive(), ...overrides });

    await expect(PublicLivePage({ params: Promise.resolve({ slug: "public-live" }) }))
      .rejects.toThrow("NEXT_NOT_FOUND");
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
          { id: "event-1", eventType: "CTA", triggerSec: 12, title: "第一段", message: "看看課程", productId: "product-1", ctaLabel: "查看", ctaUrl: "/products/1", role: { vendorId: "vendor-1", name: "主持人", avatarUrl: "/host.png", label: "講師", roleType: "HOST" } },
          { id: "event-2", eventType: "MESSAGE", triggerSec: 24, title: "第二段", message: "歡迎", productId: null, ctaLabel: null, ctaUrl: null, role: null },
        ],
      },
      products: [{
        vendorId: "vendor-1",
        offerLabel: "直播優惠", product: { id: "product-1", vendorId: "vendor-1", isActive: true, fulfillmentTypeConfirmed: true, name: "主打課程", description: "完整課程", priceCents: 168000, compareAtCents: 198000, currency: "TWD", imageUrl: "/product.png", checkoutUrl: "/checkout/product-1" },
      }],
    });

    const element = await PublicLivePage({ params: Promise.resolve({ slug: "public-live" }) });
    expect(element.props.live).toEqual({
      id: "live-1", title: "公開直播", slug: "public-live", status: "live", description: "直播說明", accentCopy: "限時優惠", heroImageUrl: "/hero.png", vendorId: "vendor-1", admissionRequired: true,
      brand: { name: "品牌商店", logoUrl: "/logo.png", primaryColor: "#123456", ctaColor: "#654321" },
      form: { id: "form-1", headline: "立即登記", description: "報名說明", submitLabel: "送出資料", successMessage: "已完成", fields: validFields },
      interactionEvents: [
        { id: "event-1", eventType: "CTA", triggerSec: 12, title: "第一段", message: "看看課程", productId: "product-1", ctaLabel: "查看", ctaUrl: "/products/1", role: { name: "主持人", avatarUrl: "/host.png", label: "講師", roleType: "HOST" } },
        { id: "event-2", eventType: "MESSAGE", triggerSec: 24, title: "第二段", message: "歡迎", productId: null, ctaLabel: null, ctaUrl: null, role: null },
      ],
      products: [{ id: "product-1", name: "主打課程", description: "完整課程", priceCents: 168000, compareAtCents: 198000, currency: "TWD", imageUrl: "/product.png", checkoutUrl: "/checkout/product-1", offerLabel: "直播優惠" }],
    });
  });

  it.each([
    ["draft", "vendor-1"],
    ["published", "vendor-2"],
  ])("fails closed for a %s interaction script owned by %s", async (status, vendorId) => {
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

    expect(element.props.live.interactionEvents).toEqual([
      expect.objectContaining({ id: "event-legacy-role", role: null }),
    ]);
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

    expect(element.props.live.interactionEvents.map((event: { id: string }) => event.id)).toEqual([
      "event-system-chat",
      "event-product",
    ]);
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
    expect(element.props.live.videoUrl).toBeUndefined();
    expect(element.props.live.interactionEvents).toEqual([]);
    expect(element.props.live.products).toEqual([]);
    expect(Object.keys(element.props.live)).toEqual([
      "id", "title", "slug", "status", "description", "accentCopy", "heroImageUrl", "vendorId", "admissionRequired", "brand", "form", "formConfigurationUnavailable", "interactionEvents", "products",
    ]);
  });
});
