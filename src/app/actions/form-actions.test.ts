import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  assertSecurity: vi.fn(),
  requireVendorManager: vi.fn(),
  create: vi.fn(),
  updateMany: vi.fn(),
  redirect: vi.fn((path: string) => { throw new Error(`redirect:${path}`); }),
}));

vi.mock("@/lib/csrf", () => ({ assertServerActionSecurity: mocks.assertSecurity }));
vi.mock("@/lib/auth", () => ({ requireVendorManager: mocks.requireVendorManager }));
vi.mock("@/lib/db", () => ({ getDb: () => ({ registrationForm: { create: mocks.create, updateMany: mocks.updateMany } }) }));
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
  mocks.assertSecurity.mockResolvedValue(undefined);
  mocks.requireVendorManager.mockResolvedValue({ id: "vendor-1" });
  mocks.create.mockResolvedValue({ id: "form-new" });
  mocks.updateMany.mockResolvedValue({ count: 1 });
});

describe("upsertFormBuilderAction", () => {
  it("creates a validated form under the authenticated vendor and redirects", async () => {
    await expect(upsertFormBuilderAction(idleState, formData())).rejects.toThrow("redirect:/forms");

    expect(mocks.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        vendorId: "vendor-1",
        slug: "summer-launch",
        fields,
        isActive: true,
      }),
    });
    expect(mocks.updateMany).not.toHaveBeenCalled();
  });

  it("scopes edits to the authenticated vendor instead of trusting client ownership", async () => {
    await expect(upsertFormBuilderAction(idleState, formData("form-1"))).rejects.toThrow("redirect:/forms");

    expect(mocks.updateMany).toHaveBeenCalledWith({
      where: { id: "form-1", vendorId: "vendor-1", updatedAt: new Date("2026-08-10T01:02:03.000Z") },
      data: expect.objectContaining({ name: "活動報名", fields }),
    });
    expect(mocks.create).not.toHaveBeenCalled();
  });

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
