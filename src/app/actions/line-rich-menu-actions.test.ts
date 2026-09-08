import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  csrf: vi.fn(), owner: vi.fn(), create: vi.fn(), updateMany: vi.fn(), findFirst: vi.fn(), deleteMany: vi.fn(),
  account: vi.fn(), live: vi.fn(), transaction: vi.fn(), providerCreate: vi.fn(), upload: vi.fn(), setDefault: vi.fn(), providerDelete: vi.fn(), revalidate: vi.fn(),
}));

vi.mock("@/lib/csrf", () => ({ assertServerActionSecurity: mocks.csrf }));
vi.mock("@/lib/auth", () => ({ requireVendorOwner: mocks.owner }));
vi.mock("@/lib/app-url", () => ({ getCanonicalAppUrl: () => "https://app.example.test" }));
vi.mock("@/lib/line-credentials", () => ({ unprotectLineOfficialAccountCredentials: () => ({ messagingAccessToken: "test-token" }) }));
vi.mock("@/lib/line-rich-menu", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/line-rich-menu")>()), createLineRichMenu: mocks.providerCreate, uploadLineRichMenuImage: mocks.upload, setDefaultLineRichMenu: mocks.setDefault, deleteLineRichMenu: mocks.providerDelete }));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidate }));
vi.mock("sharp", () => ({ default: () => ({ resize: () => ({ png: () => ({ toBuffer: async () => Buffer.from("png") }) }) }) }));
vi.mock("@/lib/db", () => ({ getDb: () => ({
  lineRichMenu: { create: mocks.create, updateMany: mocks.updateMany, findFirst: mocks.findFirst, deleteMany: mocks.deleteMany },
  lineOfficialAccount: { findUnique: mocks.account }, live: { findFirst: mocks.live },
  $transaction: mocks.transaction,
}) }));

import { deleteRichMenuAction, publishRichMenuToLineAction, saveRichMenuDraftAction } from "./line-rich-menu-actions";
import { createRichMenuTemplate } from "@/lib/line-rich-menu";

function form(id = "") { const value = new FormData(); value.set("_csrf", "valid"); value.set("id", id); value.set("templateType", "golden-6"); value.set("menu", JSON.stringify(createRichMenuTemplate("golden-6"))); return value; }

beforeEach(() => {
  vi.clearAllMocks();
  mocks.owner.mockResolvedValue({ vendor: { id: "vendor-1", slug: "teacher" }, user: { id: "user-1" }, member: { role: "owner" } });
  mocks.create.mockResolvedValue({ id: "menu-1" }); mocks.updateMany.mockResolvedValue({ count: 1 }); mocks.deleteMany.mockResolvedValue({ count: 1 });
  mocks.account.mockResolvedValue({ id: "account-1" }); mocks.live.mockResolvedValue({ slug: "evergreen" }); mocks.providerCreate.mockResolvedValue({ richMenuId: "provider-1" });
  mocks.transaction.mockImplementation(async (callback: (tx: unknown) => unknown) => callback({ lineRichMenu: { create: mocks.create, updateMany: mocks.updateMany } }));
});

describe("LINE rich menu server actions", () => {
  it("requires CSRF and owner authorization and creates a tenant-owned draft", async () => {
    await expect(saveRichMenuDraftAction({ status: "idle", error: null }, form())).resolves.toEqual({ status: "saved", error: null });
    expect(mocks.csrf).toHaveBeenCalledOnce(); expect(mocks.owner).toHaveBeenCalledOnce();
    expect(mocks.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ vendorId: "vendor-1" }) }));
  });

  it("updates only a draft owned by the authenticated vendor", async () => {
    await saveRichMenuDraftAction({ status: "idle", error: null }, form("menu-1"));
    expect(mocks.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "menu-1", vendorId: "vendor-1" } }));
  });

  it("publishes resolved URLs, uploads an image, and scopes default state to the tenant", async () => {
    await expect(publishRichMenuToLineAction({ status: "idle", error: null }, form("menu-1"))).resolves.toEqual({ status: "published", error: null });
    expect(mocks.providerCreate).toHaveBeenCalledWith("test-token", expect.objectContaining({ areas: expect.arrayContaining([expect.objectContaining({ action: expect.objectContaining({ uri: "https://app.example.test/live/evergreen" }) })]) }));
    expect(mocks.upload).toHaveBeenCalled(); expect(mocks.setDefault).toHaveBeenCalledWith("test-token", "provider-1");
    expect(mocks.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: { vendorId: "vendor-1", isDefault: true } }));
  });

  it("never deletes another tenant's record", async () => {
    mocks.findFirst.mockResolvedValue(null);
    await expect(deleteRichMenuAction({ status: "idle", error: null }, form("other-menu"))).resolves.toEqual({ status: "error", error: "not_found" });
    expect(mocks.findFirst).toHaveBeenCalledWith({ where: { id: "other-menu", vendorId: "vendor-1" } });
    expect(mocks.providerDelete).not.toHaveBeenCalled(); expect(mocks.deleteMany).not.toHaveBeenCalled();
  });

  it("stops before authorization when CSRF validation rejects", async () => {
    mocks.csrf.mockRejectedValueOnce(new Error("csrf"));
    await expect(saveRichMenuDraftAction({ status: "idle", error: null }, form())).rejects.toThrow("csrf");
    expect(mocks.owner).not.toHaveBeenCalled(); expect(mocks.create).not.toHaveBeenCalled();
  });
});
