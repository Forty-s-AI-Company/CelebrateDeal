import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  assertSecurity: vi.fn(),
  requireVendorManager: vi.fn(),
  create: vi.fn(),
  updateMany: vi.fn(),
  imageAssetFindFirst: vi.fn(),
  videoFindFirst: vi.fn(),
  redirect: vi.fn((path: string) => { throw new Error(`redirect:${path}`); }),
  db: {
    registrationForm: { create: vi.fn(), updateMany: vi.fn() },
    imageAsset: { findFirst: vi.fn() },
    video: { findFirst: vi.fn() },
  },
  getDb: vi.fn(),
}));

vi.mock("@/lib/csrf", () => ({ assertServerActionSecurity: mocks.assertSecurity }));
vi.mock("@/lib/auth", () => ({ requireVendorManager: mocks.requireVendorManager }));
vi.mock("@/lib/db", () => ({ getDb: mocks.getDb }));
vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));

import { upsertFormBuilderAction, type FormBuilderActionState } from "./form-actions";

const idleState: FormBuilderActionState = { status: "idle", message: "" };
const fields = [
  { key: "name", label: "姓名", type: "text", required: true },
  { key: "email", label: "Email", type: "email", required: true },
];

function formData(id?: string) {
  const data = new FormData();
  data.set("_csrf", "synthetic");
  if (id) {
    data.set("id", id);
    data.set("expectedUpdatedAt", "2026-08-10T01:02:03.000Z");
  }
  data.set("name", "活動報名");
  data.set("slug", "Summer Launch");
  data.set("headline", "立即報名");
  data.set("description", "活動說明");
  data.set("fields", JSON.stringify(fields));
  data.set("submitLabel", "送出");
  data.set("successMessage", "已完成");
  data.set("isActive", "on");
  return data;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getDb.mockReset();
  mocks.imageAssetFindFirst.mockReset();
  mocks.videoFindFirst.mockReset();
  mocks.create.mockReset();
  mocks.updateMany.mockReset();
  mocks.db.registrationForm.create = mocks.create;
  mocks.db.registrationForm.updateMany = mocks.updateMany;
  mocks.db.imageAsset.findFirst = mocks.imageAssetFindFirst;
  mocks.db.video.findFirst = mocks.videoFindFirst;
  mocks.getDb.mockReturnValue(mocks.db);
  mocks.assertSecurity.mockResolvedValue(undefined);
  mocks.requireVendorManager.mockResolvedValue({ id: "vendor-1" });
  mocks.create.mockResolvedValue({ id: "form-new" });
  mocks.updateMany.mockResolvedValue({ count: 1 });
  mocks.imageAssetFindFirst.mockResolvedValue(null);
  mocks.videoFindFirst.mockResolvedValue(null);
});

describe("upsertFormBuilderAction", () => {
  it("creates a validated form under the authenticated vendor and redirects", async () => {
    await expect(upsertFormBuilderAction(idleState, formData())).rejects.toThrow("redirect:/forms");

    expect(mocks.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        vendorId: "vendor-1",
        slug: "summer-launch",
        fields,
        heroImageUrl: null,
        heroImageAssetId: null,
        backgroundImageUrl: null,
        backgroundImageAssetId: null,
        promoVideoId: null,
        isActive: true,
      }),
    });
    expect(mocks.getDb).toHaveBeenCalledTimes(1);
    expect(mocks.updateMany).not.toHaveBeenCalled();
  });

  it("scopes edits to the authenticated vendor instead of trusting client ownership", async () => {
    await expect(upsertFormBuilderAction(idleState, formData("form-1"))).rejects.toThrow("redirect:/forms");

    expect(mocks.updateMany).toHaveBeenCalledWith({
      where: { id: "form-1", vendorId: "vendor-1", updatedAt: new Date("2026-08-10T01:02:03.000Z") },
      data: expect.objectContaining({ name: "活動報名", fields }),
    });
    expect(mocks.getDb).toHaveBeenCalledTimes(1);
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it("uses ready tenant-owned assets and server URLs instead of client URLs", async () => {
    mocks.imageAssetFindFirst
      .mockResolvedValueOnce({ id: "hero-asset-1", publicUrl: "https://media.example.test/server-hero.webp" })
      .mockResolvedValueOnce({ id: "background-asset-1", publicUrl: "https://media.example.test/server-background.webp" });
    mocks.videoFindFirst.mockResolvedValue({ id: "promo-video-1" });
    const data = formData();
    data.set("heroImageAssetId", "hero-asset-1");
    data.set("heroImageUrl", "javascript:alert(1)");
    data.set("backgroundImageAssetId", "background-asset-1");
    data.set("backgroundImageUrl", "not-a-url");
    data.set("promoVideoId", "promo-video-1");

    await expect(upsertFormBuilderAction(idleState, data)).rejects.toThrow("redirect:/forms");

    expect(mocks.imageAssetFindFirst).toHaveBeenNthCalledWith(1, {
      where: { id: "hero-asset-1", vendorId: "vendor-1", status: "ready" },
      select: { id: true, publicUrl: true },
    });
    expect(mocks.imageAssetFindFirst).toHaveBeenNthCalledWith(2, {
      where: { id: "background-asset-1", vendorId: "vendor-1", status: "ready" },
      select: { id: true, publicUrl: true },
    });
    expect(mocks.videoFindFirst).toHaveBeenCalledWith({
      where: { id: "promo-video-1", vendorId: "vendor-1", status: "ready" },
      select: { id: true },
    });
    expect(mocks.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        heroImageAssetId: "hero-asset-1",
        heroImageUrl: "https://media.example.test/server-hero.webp",
        backgroundImageAssetId: "background-asset-1",
        backgroundImageUrl: "https://media.example.test/server-background.webp",
        promoVideoId: "promo-video-1",
      }),
    });
  });

  it("stores legacy HTTP(S) URLs when no image asset is selected", async () => {
    const data = formData();
    data.set("heroImageUrl", " http://legacy.example.test/hero.webp ");
    data.set("backgroundImageUrl", "https://legacy.example.test/background.webp");

    await expect(upsertFormBuilderAction(idleState, data)).rejects.toThrow("redirect:/forms");

    expect(mocks.imageAssetFindFirst).not.toHaveBeenCalled();
    expect(mocks.videoFindFirst).not.toHaveBeenCalled();
    expect(mocks.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        heroImageUrl: "http://legacy.example.test/hero.webp",
        backgroundImageUrl: "https://legacy.example.test/background.webp",
        heroImageAssetId: null,
        backgroundImageAssetId: null,
      }),
    });
  });

  it("returns an invalid URL field error before persistence", async () => {
    const data = formData();
    data.set("heroImageUrl", "javascript:alert(1)");
    data.set("backgroundImageUrl", "//attacker.example.test/background.webp");

    const result = await upsertFormBuilderAction(idleState, data);

    expect(result).toEqual(expect.objectContaining({
      status: "error",
      message: expect.stringContaining("內容仍保留"),
      fieldErrors: {
        heroImageUrl: expect.stringContaining("HTTP(S)"),
        backgroundImageUrl: expect.stringContaining("HTTP(S)"),
      },
    }));
    expect(mocks.create).not.toHaveBeenCalled();
    expect(mocks.updateMany).not.toHaveBeenCalled();
  });

  it("rejects cross-tenant and pending image assets before updating", async () => {
    const data = formData("form-1");
    data.set("heroImageAssetId", "cross-tenant-asset");
    data.set("backgroundImageAssetId", "pending-asset");
    mocks.imageAssetFindFirst.mockResolvedValue(null);

    const result = await upsertFormBuilderAction(idleState, data);

    expect(result).toEqual(expect.objectContaining({
      status: "error",
      fieldErrors: {
        heroImageAssetId: expect.stringContaining("無效"),
        backgroundImageAssetId: expect.stringContaining("無效"),
      },
    }));
    expect(mocks.imageAssetFindFirst).toHaveBeenNthCalledWith(1, {
      where: { id: "cross-tenant-asset", vendorId: "vendor-1", status: "ready" },
      select: { id: true, publicUrl: true },
    });
    expect(mocks.imageAssetFindFirst).toHaveBeenNthCalledWith(2, {
      where: { id: "pending-asset", vendorId: "vendor-1", status: "ready" },
      select: { id: true, publicUrl: true },
    });
    expect(mocks.create).not.toHaveBeenCalled();
    expect(mocks.updateMany).not.toHaveBeenCalled();
  });

  it.each(["cross-tenant-video", "processing-video", "archived-video"])(
    "rejects a non-ready or cross-tenant promo video (%s) before creating",
    async (promoVideoId) => {
      const data = formData();
      data.set("promoVideoId", promoVideoId);
      mocks.videoFindFirst.mockResolvedValue(null);

      const result = await upsertFormBuilderAction(idleState, data);

      expect(result).toEqual(expect.objectContaining({
        status: "error",
        fieldErrors: { promoVideoId: expect.stringContaining("不存在") },
      }));
      expect(mocks.videoFindFirst).toHaveBeenCalledWith({
        where: { id: promoVideoId, vendorId: "vendor-1", status: "ready" },
        select: { id: true },
      });
      expect(mocks.create).not.toHaveBeenCalled();
      expect(mocks.updateMany).not.toHaveBeenCalled();
    },
  );

  it("returns field errors without persistence when submitted data is invalid", async () => {
    const data = formData();
    data.set("headline", "");
    data.set("fields", JSON.stringify(fields.slice(0, 1)));

    const result = await upsertFormBuilderAction(idleState, data);

    expect(result.status).toBe("error");
    expect(result.message).toContain("內容仍保留");
    expect(result.fieldErrors?.headline).toContain("公開標題");
    expect(result.fieldErrors?.fields).toContain("姓名與 Email");
    expect(mocks.create).not.toHaveBeenCalled();
    expect(mocks.updateMany).not.toHaveBeenCalled();
  });

  it("turns expired security state into a recoverable refresh instruction", async () => {
    mocks.assertSecurity.mockRejectedValue(new Error("Invalid CSRF token."));

    const result = await upsertFormBuilderAction(idleState, formData());

    expect(result).toEqual(expect.objectContaining({ status: "error", message: expect.stringContaining("安全驗證") }));
    expect(mocks.requireVendorManager).not.toHaveBeenCalled();
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it("fails closed when an edit omits its server version or loses a concurrent update", async () => {
    const missingVersion = formData("form-1");
    missingVersion.delete("expectedUpdatedAt");
    await expect(upsertFormBuilderAction(idleState, missingVersion)).resolves.toEqual(expect.objectContaining({
      status: "error",
      message: expect.stringContaining("表單版本"),
    }));
    expect(mocks.updateMany).not.toHaveBeenCalled();

    mocks.updateMany.mockResolvedValueOnce({ count: 0 });
    const conflict = await upsertFormBuilderAction(idleState, formData("form-1"));
    expect(conflict).toEqual(expect.objectContaining({
      status: "error",
      message: expect.stringContaining("較新的版本"),
      fieldErrors: { root: expect.stringContaining("版本衝突") },
    }));
    expect(mocks.redirect).not.toHaveBeenCalled();
  });

  it.each([
    ["P2002", "這個公開網址已被使用", "slug"],
    ["P2025", "這張表單已不存在", "root"],
    ["P1001", "暫時無法儲存", "root"],
  ])("maps database %s failures to sanitized recoverable feedback", async (code, message, field) => {
    mocks.create.mockRejectedValue({ code, detail: "must-not-leak" });

    const result = await upsertFormBuilderAction(idleState, formData());

    expect(result.status).toBe("error");
    expect(result.message).toContain(message);
    expect(result.message).not.toContain("must-not-leak");
    expect(result.fieldErrors?.[field as "root" | "slug"]).toBeTruthy();
    expect(mocks.redirect).not.toHaveBeenCalled();
  });
});
