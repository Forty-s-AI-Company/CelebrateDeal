import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  assertServerActionSecurity: vi.fn(),
  requireAuth: vi.fn(),
  requireVendor: vi.fn(),
  getDb: vi.fn(),
  revalidatePath: vi.fn(),
  createShare: vi.fn(),
  disableShare: vi.fn(),
  createOriginalPage: vi.fn(),
  publishVersion: vi.fn(),
  createProductSlot: vi.fn(),
  AccessDeniedError: class AccessDeniedError extends Error {},
  TemplateConflictError: class TemplateConflictError extends Error {},
  ProductSlotConflictError: class ProductSlotConflictError extends Error {},
  ShareConflictError: class ShareConflictError extends Error {},
}));

vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock("@/lib/auth", () => ({ requireAuth: mocks.requireAuth, requireVendor: mocks.requireVendor }));
vi.mock("@/lib/csrf", () => ({ assertServerActionSecurity: mocks.assertServerActionSecurity }));
vi.mock("@/lib/db", () => ({ getDb: mocks.getDb }));
vi.mock("@/lib/team-funnel-access", () => ({ TeamFunnelAccessDeniedError: mocks.AccessDeniedError }));
vi.mock("@/lib/team-funnel-pages", () => ({
  TeamFunnelConflictError: mocks.TemplateConflictError,
  createTeamFunnelOriginalPage: mocks.createOriginalPage,
  publishTeamFunnelTemplateVersion: mocks.publishVersion,
}));
vi.mock("@/lib/team-funnel-product-slots", () => ({
  TeamFunnelProductSlotConflictError: mocks.ProductSlotConflictError,
  createTeamFunnelTemplateProductSlot: mocks.createProductSlot,
}));
vi.mock("@/lib/team-funnel-sharing", () => ({
  TeamFunnelShareConflictError: mocks.ShareConflictError,
  createTeamFunnelShare: mocks.createShare,
  disableTeamFunnelShare: mocks.disableShare,
}));

import { manageTeamFunnelTemplateAction } from "./team-funnel-template-actions";

function formData(fields: Record<string, string> = {}) {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) data.set(key, value);
  return data;
}

const initialState = { status: "idle" as const, message: "" };

beforeEach(() => {
  vi.clearAllMocks();
  mocks.assertServerActionSecurity.mockResolvedValue(undefined);
  mocks.requireAuth.mockResolvedValue({ member: { id: "member-1" } });
  mocks.requireVendor.mockResolvedValue({ id: "vendor-1" });
  mocks.getDb.mockReturnValue({ live: { findFirst: vi.fn() }, partnerFunnelPage: { updateMany: vi.fn() } });
  mocks.createShare.mockResolvedValue({ share: { pageId: "page-1" }, shareCode: "share+code" });
  mocks.disableShare.mockResolvedValue(undefined);
});

describe("manageTeamFunnelTemplateAction", () => {
  it("fails closed for missing share identifiers and invalid content before service calls", async () => {
    await expect(manageTeamFunnelTemplateAction(initialState, formData({ operation: "create-share", teamId: "team-1" }))).resolves.toEqual({
      status: "error",
      message: "找不到可分享的原始頁。",
    });
    await expect(manageTeamFunnelTemplateAction(initialState, formData({ operation: "disable-share", pageId: "page-1" }))).resolves.toEqual({
      status: "error",
      message: "找不到要停用的分享連結。",
    });
    await expect(manageTeamFunnelTemplateAction(initialState, formData({ teamId: "team-1", slug: "valid-slug", ctaLabel: "立即了解" }))).resolves.toEqual({
      status: "error",
      message: "請填寫標題與 CTA 按鈕文字。",
    });
    expect(mocks.createShare).not.toHaveBeenCalled();
    expect(mocks.disableShare).not.toHaveBeenCalled();
  });

  it("accepts create-share and disable-share through the existing service boundaries", async () => {
    await expect(manageTeamFunnelTemplateAction(initialState, formData({ operation: "create-share", teamId: "team-1", pageId: "page-1" }))).resolves.toEqual({
      status: "success",
      message: "分享連結已建立。此連結只會在這次操作後顯示，請立即複製保存。",
      shareUrl: "/team-template?share=share%2Bcode",
      sharePageId: "page-1",
    });
    await expect(manageTeamFunnelTemplateAction(initialState, formData({ operation: "disable-share", teamId: "team-1", pageId: "page-1" }))).resolves.toEqual({
      status: "success",
      message: "分享連結已停用，夥伴之後無法再使用它。",
    });
    expect(mocks.revalidatePath).toHaveBeenCalledTimes(2);
  });

  it("maps conflict, CSRF, and missing-member failures to safe action states", async () => {
    mocks.createShare.mockRejectedValueOnce(new mocks.ShareConflictError("sensitive conflict detail"));
    await expect(manageTeamFunnelTemplateAction(initialState, formData({ operation: "create-share", teamId: "team-1", pageId: "page-1" }))).resolves.toEqual({
      status: "error",
      message: "這項設定與既有資料衝突，請更新頁面後再試一次。",
    });

    mocks.assertServerActionSecurity.mockRejectedValueOnce(new Error("Invalid CSRF token."));
    await expect(manageTeamFunnelTemplateAction(initialState, formData({ operation: "create-share", teamId: "team-1", pageId: "page-1" }))).resolves.toEqual({
      status: "error",
      message: "安全驗證已失效，請重新整理頁面後再送出。",
    });

    mocks.requireAuth.mockResolvedValueOnce({ member: null });
    await expect(manageTeamFunnelTemplateAction(initialState, formData({ teamId: "team-1", slug: "valid-slug", headline: "標題", ctaLabel: "立即了解" }))).resolves.toEqual({
      status: "error",
      message: "你沒有管理這個團隊模板的權限，或該資源已不存在。",
    });
  });

  it("rejects invalid CTA URLs and slugs without reading a database", async () => {
    await expect(manageTeamFunnelTemplateAction(initialState, formData({ teamId: "team-1", slug: "valid-slug", headline: "標題", ctaLabel: "立即了解", ctaUrl: "not-a-url" }))).resolves.toEqual({
      status: "error",
      message: "CTA 連結必須是有效的完整網址。",
    });
    await expect(manageTeamFunnelTemplateAction(initialState, formData({ teamId: "team-1", slug: "../unsafe", headline: "標題", ctaLabel: "立即了解" }))).resolves.toEqual({
      status: "error",
      message: "原始頁網址只能使用小寫英數與連字號。",
    });
    expect(mocks.getDb).not.toHaveBeenCalled();
  });
});
