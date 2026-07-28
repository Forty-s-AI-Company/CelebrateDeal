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
});
