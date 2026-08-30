import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  findFirst: vi.fn(),
  findMany: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  getDb: () => ({
    registrationForm: { findFirst: mocks.findFirst },
    live: { findMany: mocks.findMany },
  }),
}));

import { loadPublicRegistrationForm, selectPublicRegistrationSessions } from "./public-registration-form";

const validFields = [
  { key: "name", label: "姓名", type: "text", required: true },
  { key: "email", label: "Email", type: "email", required: true },
];

function formRecord(overrides: Record<string, unknown> = {}) {
  return {
    id: "form-1",
    vendorId: "vendor-1",
    slug: "summer",
    headline: "夏季活動",
    description: "說明",
    submitLabel: "送出報名",
    successMessage: "已收到",
    fields: validFields,
    heroImageUrl: "https://cdn.example.test/hero.jpg",
    backgroundImageUrl: "https://cdn.example.test/background.jpg",
    themeColor: "#123456",
    stickyText: "提醒",
    bodyContent: "內容",
    notice: "注意",
    seoTitle: "SEO 標題",
    seoDescription: "SEO 說明",
    maxVisibleSessions: 0,
    hideExpiredSessions: true,
    vendor: { name: "測試商家" },
    promoVideo: {
      vendorId: "vendor-1",
      title: "預告",
      videoUrl: "https://cdn.example.test/promo.m3u8",
      sourceType: "url",
      status: "ready",
      cloudflareReadyToStream: false,
      cloudflareLiveInputUid: null,
      liveInputStatus: null,
    },
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.findFirst.mockResolvedValue(formRecord());
  mocks.findMany.mockResolvedValue([]);
});

describe("public registration form DAL", () => {
  it("loads only active forms, scopes sessions to the same tenant/form, and strips internal fields", async () => {
    mocks.findMany.mockResolvedValue([
      { id: "past", title: "過期", description: null, scheduledAt: new Date("2026-08-10T01:00:00Z"), status: "scheduled", endedAt: null },
      { id: "live", title: "直播中", description: null, scheduledAt: new Date("2026-08-20T01:00:00Z"), status: "live", endedAt: null },
    ]);

    const result = await loadPublicRegistrationForm("summer", new Date("2026-08-15T00:00:00Z"));
    expect(mocks.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: { slug: "summer", isActive: true },
      select: expect.objectContaining({ vendor: { select: { name: true } } }),
    }));
    expect(mocks.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        formId: "form-1",
        vendorId: "vendor-1",
        OR: [
          { status: { in: ["scheduled", "live"] } },
          { status: "ended", replayEnabled: true },
        ],
      },
      select: { id: true, title: true, description: true, scheduledAt: true, status: true, endedAt: true },
    }));
    expect(result?.sessions.map((session) => session.id)).toEqual(["live"]);
    expect(result?.promoVideo).toEqual({ title: "預告", videoUrl: "https://cdn.example.test/promo.m3u8" });
    expect(result).not.toHaveProperty("vendorId");
    expect(result?.sessions[0]).not.toHaveProperty("endedAt");
  });

  it("sorts live, future scheduled, and ended replay sessions and applies the limit", () => {
    const sessions = selectPublicRegistrationSessions([
      { id: "ended-old", title: "舊回放", description: null, scheduledAt: new Date("2026-08-10T01:00:00Z"), status: "ended", endedAt: new Date("2026-08-10T02:00:00Z") },
      { id: "scheduled", title: "未來", description: null, scheduledAt: new Date("2026-08-20T01:00:00Z"), status: "scheduled", endedAt: null },
      { id: "ended-new", title: "新回放", description: null, scheduledAt: new Date("2026-08-11T01:00:00Z"), status: "ended", endedAt: new Date("2026-08-11T02:00:00Z") },
      { id: "live", title: "直播", description: null, scheduledAt: new Date("2026-08-21T01:00:00Z"), status: "live", endedAt: null },
      { id: "expired", title: "過期場", description: null, scheduledAt: new Date("2026-08-01T01:00:00Z"), status: "scheduled", endedAt: null },
    ], { now: new Date("2026-08-15T00:00:00Z"), hideExpiredSessions: true, maxVisibleSessions: 3 });

    expect(sessions.map((session) => session.id)).toEqual(["live", "scheduled", "ended-new"]);
  });

  it("does not gate replay by replayAvailableUntil and treats zero as unlimited", () => {
    const sessions = selectPublicRegistrationSessions([
      { id: "ended", title: "已結束", description: null, scheduledAt: new Date("2026-08-01T01:00:00Z"), status: "ended", endedAt: new Date("2026-08-01T02:00:00Z") },
      { id: "past-scheduled", title: "過期場", description: null, scheduledAt: new Date("2026-08-01T01:00:00Z"), status: "scheduled", endedAt: null },
    ], { now: new Date("2026-08-15T00:00:00Z"), hideExpiredSessions: false, maxVisibleSessions: 0 });

    expect(sessions.map((session) => session.id)).toEqual(["past-scheduled", "ended"]);
  });

  it("fails closed for invalid fields, theme, images and promo video", async () => {
    mocks.findFirst.mockResolvedValue(formRecord({
      fields: [{ key: "email", label: "Email", type: "email", required: true }],
      themeColor: "red",
      heroImageUrl: "javascript:alert(1)",
      backgroundImageUrl: "//unsafe.example.test/image.jpg",
      promoVideo: { vendorId: "vendor-1", title: "不安全", videoUrl: "javascript:alert(1)", status: "ready" },
    }));

    const result = await loadPublicRegistrationForm("summer");
    expect(result?.fields).toBeNull();
    expect(result?.themeColor).toBeNull();
    expect(result?.heroImageUrl).toBeNull();
    expect(result?.backgroundImageUrl).toBeNull();
    expect(result?.promoVideo).toBeNull();
  });

  it("returns no form and does not query sessions when the slug is missing", async () => {
    mocks.findFirst.mockResolvedValue(null);
    await expect(loadPublicRegistrationForm("missing")).resolves.toBeNull();
    expect(mocks.findMany).not.toHaveBeenCalled();
  });
});
