import { Prisma } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createRichMenuTemplate } from "@/lib/line-rich-menu";

const mocks = vi.hoisted(() => ({ security: vi.fn(), auth: vi.fn(), create: vi.fn(), updateMany: vi.fn(), deleteMany: vi.fn(), revalidate: vi.fn() }));
vi.mock("@/lib/csrf", () => ({ assertServerActionSecurity: mocks.security }));
vi.mock("@/lib/auth", () => ({ requireVendorOwner: mocks.auth }));
vi.mock("@/lib/db", () => ({ getDb: () => ({ lineRichMenuDraft: { create: mocks.create, updateMany: mocks.updateMany, deleteMany: mocks.deleteMany } }) }));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidate }));
import { updateRichMenuDraftAction, type RichMenuActionState } from "./line-rich-menu-actions";
const initial: RichMenuActionState = { status: "idle", error: null, reference: null };
function form(id = "", revision = "0", intent = "save") {
  const data = new FormData();
  for (const [key, value] of Object.entries({ id, revision, intent, _csrf: "synthetic", menu: JSON.stringify(createRichMenuTemplate("golden-6")) })) data.set(key, value);
  return data;
}
beforeEach(() => {
  vi.resetAllMocks();
  mocks.auth.mockResolvedValue({ vendor: { id: "vendor-a" } });
  mocks.create.mockResolvedValue({ id: "draft-a", revision: 1 });
  mocks.updateMany.mockResolvedValue({ count: 1 });
  mocks.deleteMany.mockResolvedValue({ count: 1 });
});
describe("owner-scoped rich menu draft actions", () => {
  it("creates only for the authenticated vendor after security checks", async () => {
    const data = form(); data.set("vendorId", "attacker-selected-vendor");
    expect(await updateRichMenuDraftAction(initial, data)).toEqual({ status: "saved", error: null, reference: { id: "draft-a", revision: 1 } });
    expect(mocks.security).toHaveBeenCalledWith(data);
    expect(mocks.security.mock.invocationCallOrder[0]).toBeLessThan(mocks.auth.mock.invocationCallOrder[0]!);
    expect(mocks.auth.mock.invocationCallOrder[0]).toBeLessThan(mocks.create.mock.invocationCallOrder[0]!);
    expect(mocks.create).toHaveBeenCalledWith({ data: { vendorId: "vendor-a", menu: createRichMenuTemplate("golden-6") }, select: { id: true, revision: true } });
    expect(mocks.revalidate).toHaveBeenCalledWith("/settings/line");
  });
  it.each(["security", "auth"] as const)("stops before writes when %s fails", async (guard) => {
    mocks[guard].mockRejectedValueOnce(new Error("forbidden"));
    await expect(updateRichMenuDraftAction(initial, form())).rejects.toThrow("forbidden");
    expect(mocks.create).not.toHaveBeenCalled();
    expect(mocks.updateMany).not.toHaveBeenCalled();
    expect(mocks.deleteMany).not.toHaveBeenCalled();
  });
  it("uses posted identity and revision with tenant scope, never the previous action state", async () => {
    const previous = { ...initial, reference: { id: "untrusted", revision: 99 } };
    expect(await updateRichMenuDraftAction(previous, form("draft-a", "2"))).toMatchObject({ status: "saved", reference: { id: "draft-a", revision: 3 } });
    expect(mocks.updateMany).toHaveBeenCalledWith({ where: { vendorId: "vendor-a", id: "draft-a", revision: 2 }, data: { menu: createRichMenuTemplate("golden-6"), revision: { increment: 1 } } });
  });
  it.each(["save", "delete"])("rejects stale or cross-tenant %s without revalidating", async (intent) => {
    mocks.updateMany.mockResolvedValueOnce({ count: 0 }); mocks.deleteMany.mockResolvedValueOnce({ count: 0 });
    expect(await updateRichMenuDraftAction(initial, form("other-draft", "3", intent))).toMatchObject({ status: "error", error: "conflict" });
    expect(mocks.revalidate).not.toHaveBeenCalled();
  });
  it("deletes only the scoped revision and returns an empty reference for a fresh draft", async () => {
    expect(await updateRichMenuDraftAction(initial, form("draft-a", "2", "delete"))).toEqual({ status: "deleted", error: null, reference: null });
    expect(mocks.deleteMany).toHaveBeenCalledWith({ where: { vendorId: "vendor-a", id: "draft-a", revision: 2 } });
  });
  it.each([["id", "x".repeat(129)], ["revision", "-1"], ["revision", "1.5"], ["revision", "2147483648"], ["intent", "publish"], ["menu", "{"], ["menu", "{}"], ["menu", "x".repeat(40001)]])("rejects malformed %s", async (key, value) => {
    const data = form(); data.set(key!, value!);
    expect(await updateRichMenuDraftAction(initial, data)).toMatchObject({ status: "error", error: "invalid_input" });
    expect(mocks.create).not.toHaveBeenCalled();
    expect(mocks.updateMany).not.toHaveBeenCalled();
  });
  it("rejects deleting an absent draft and non-text inputs", async () => {
    expect(await updateRichMenuDraftAction(initial, form("", "0", "delete"))).toMatchObject({ error: "invalid_input" });
    const data = form(); data.delete("id");
    expect(await updateRichMenuDraftAction(initial, data)).toMatchObject({ error: "invalid_input" });
    data.set("id", ""); data.set("menu", new Blob(["payload"]));
    expect(await updateRichMenuDraftAction(initial, data)).toMatchObject({ error: "invalid_input" });
    expect(mocks.create).not.toHaveBeenCalled();
    expect(mocks.deleteMany).not.toHaveBeenCalled();
  });
  it("returns conflict for a concurrent first save and sanitizes database failures", async () => {
    mocks.create.mockRejectedValueOnce(new Prisma.PrismaClientKnownRequestError("unique", { code: "P2002", clientVersion: "test" }));
    expect(await updateRichMenuDraftAction(initial, form())).toMatchObject({ error: "conflict" });
    mocks.create.mockRejectedValueOnce(new Error("internal connection details"));
    expect(await updateRichMenuDraftAction(initial, form())).toEqual({ status: "error", error: "save_failed", reference: null });
  });
});
