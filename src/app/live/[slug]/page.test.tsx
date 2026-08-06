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
  video: null,
  form: null,
  interactionScript: null,
  products: [],
};

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

  it("filters inactive products and omits an inactive registration form", async () => {
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
          where: { product: { isActive: true } },
          orderBy: { sortOrder: "asc" },
          include: { product: true },
        },
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

  it("maps active form fields, video, brand, interaction roles, and products through the public boundary", async () => {
    mocks.findFirst.mockResolvedValue({
      ...publicLive,
      status: "live",
      description: "直播說明",
      accentCopy: "限時優惠",
      heroImageUrl: "/hero.png",
      vendor: { name: "品牌商店", logoUrl: "/logo.png", primaryColor: "#123456", ctaColor: "#654321" },
      video: { videoUrl: "https://video.example/live.m3u8" },
      form: {
        id: "form-1", isActive: true, headline: "立即登記", description: "報名說明", submitLabel: "送出資料", successMessage: "已完成",
        fields: [null, "malformed", { label: "缺少 key" }, { key: "phone", label: "電話", type: "tel", required: 1 }, { key: 42, label: 0, type: 17, required: false }, { key: "notes", label: "備註", required: "yes" }],
      },
      interactionScript: {
        events: [
          { id: "event-1", eventType: "CTA", triggerSec: 12, title: "第一段", message: "看看課程", productId: "product-1", ctaLabel: "查看", ctaUrl: "/products/1", role: { name: "主持人", avatarUrl: "/host.png", label: "講師", roleType: "HOST" } },
          { id: "event-2", eventType: "MESSAGE", triggerSec: 24, title: "第二段", message: "歡迎", productId: null, ctaLabel: null, ctaUrl: null, role: null },
        ],
      },
      products: [{
        offerLabel: "直播優惠", product: { id: "product-1", name: "主打課程", description: "完整課程", priceCents: 168000, compareAtCents: 198000, currency: "TWD", imageUrl: "/product.png", checkoutUrl: "/checkout/product-1" },
      }],
    });

    const element = await PublicLivePage({ params: Promise.resolve({ slug: "public-live" }) });
    expect(element.props.live).toEqual({
      id: "live-1", title: "公開直播", slug: "public-live", status: "live", description: "直播說明", accentCopy: "限時優惠", heroImageUrl: "/hero.png", videoUrl: "https://video.example/live.m3u8", vendorId: "vendor-1",
      brand: { name: "品牌商店", logoUrl: "/logo.png", primaryColor: "#123456", ctaColor: "#654321" },
      form: {
        id: "form-1", headline: "立即登記", description: "報名說明", submitLabel: "送出資料", successMessage: "已完成",
        fields: [
          { key: "phone", label: "電話", type: "tel", required: true },
          { key: "42", label: "0", type: "text", required: false },
          { key: "notes", label: "備註", type: "text", required: true },
        ],
      },
      interactionEvents: [
        { id: "event-1", eventType: "CTA", triggerSec: 12, title: "第一段", message: "看看課程", productId: "product-1", ctaLabel: "查看", ctaUrl: "/products/1", role: { name: "主持人", avatarUrl: "/host.png", label: "講師", roleType: "HOST" } },
        { id: "event-2", eventType: "MESSAGE", triggerSec: 24, title: "第二段", message: "歡迎", productId: null, ctaLabel: null, ctaUrl: null, role: null },
      ],
      products: [{ id: "product-1", name: "主打課程", description: "完整課程", priceCents: 168000, compareAtCents: 198000, currency: "TWD", imageUrl: "/product.png", checkoutUrl: "/checkout/product-1", offerLabel: "直播優惠" }],
    });
  });

  it("uses safe empty fallbacks for missing interaction scripts, video, products, and malformed form fields", async () => {
    mocks.findFirst.mockResolvedValue({
      ...publicLive,
      form: { id: "form-2", isActive: true, headline: "表單", description: null, fields: { unexpected: true }, submitLabel: "送出", successMessage: "完成" },
      interactionScript: null,
      video: null,
      products: [],
    });

    const element = await PublicLivePage({ params: Promise.resolve({ slug: "public-live" }) });
    expect(element.props.live.form).toEqual({ id: "form-2", headline: "表單", description: null, fields: [], submitLabel: "送出", successMessage: "完成" });
    expect(element.props.live.videoUrl).toBeNull();
    expect(element.props.live.interactionEvents).toEqual([]);
    expect(element.props.live.products).toEqual([]);
    expect(Object.keys(element.props.live)).toEqual([
      "id", "title", "slug", "status", "description", "accentCopy", "heroImageUrl", "videoUrl", "vendorId", "brand", "form", "interactionEvents", "products",
    ]);
  });
});
