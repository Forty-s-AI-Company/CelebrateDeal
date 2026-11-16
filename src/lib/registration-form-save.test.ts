import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const db = {
    $transaction: vi.fn(),
    salesProject: { findFirst: vi.fn() },
    registrationForm: { create: vi.fn(), updateMany: vi.fn() },
    imageAsset: { findFirst: vi.fn() },
    video: { findFirst: vi.fn() },
  };
  return { db };
});

vi.mock("@/lib/db", () => ({ getDb: () => mocks.db }));

import { saveRegistrationForm } from "./registration-form-save";

function formData(values: Record<string, string> = {}) {
  const data = new FormData();
  const defaults = {
    name: "週五講座報名表",
    slug: "Friday Talk",
    headline: "週五講座",
    fields: JSON.stringify([
      { key: "name", label: "姓名", type: "text", required: true },
      { key: "email", label: "Email", type: "email", required: true },
    ]),
    submitLabel: "送出報名",
    successMessage: "已收到",
    isActive: "on",
  };
  for (const [key, value] of Object.entries({ ...defaults, ...values })) data.set(key, value);
  return data;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.db.$transaction.mockImplementation((callback: (tx: typeof mocks.db) => unknown) => callback(mocks.db));
  mocks.db.salesProject.findFirst.mockResolvedValue(null);
  mocks.db.registrationForm.create.mockResolvedValue({ id: "form-created" });
  mocks.db.registrationForm.updateMany.mockResolvedValue({ count: 1 });
  mocks.db.imageAsset.findFirst.mockResolvedValue(null);
  mocks.db.video.findFirst.mockResolvedValue(null);
});

describe("saveRegistrationForm", () => {
  it("returns the new form id and name for the given vendor", async () => {
    await expect(saveRegistrationForm("vendor-1", formData())).resolves.toEqual({ ok: true, form: { id: "form-created", name: "週五講座報名表" } });
    expect(mocks.db.registrationForm.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ vendorId: "vendor-1", slug: "friday-talk", isActive: true }),
    });
  });

  it("binds a project of the same vendor inside the create transaction", async () => {
    mocks.db.salesProject.findFirst.mockResolvedValue({ id: "project-1" });
    await expect(saveRegistrationForm("vendor-1", formData({ projectId: "project-1" }))).resolves.toMatchObject({ ok: true });
    expect(mocks.db.salesProject.findFirst).toHaveBeenCalledWith({ where: { id: "project-1", vendorId: "vendor-1", status: { not: "archived" } }, select: { id: true } });
    expect(mocks.db.registrationForm.create).toHaveBeenCalledWith({ data: expect.objectContaining({ vendorId: "vendor-1", projectId: "project-1" }) });
  });

  it("refuses a project the vendor does not own without writing", async () => {
    const result = await saveRegistrationForm("vendor-1", formData({ projectId: "project-of-another-vendor" }));
    expect(result).toEqual({
      ok: false,
      state: { status: "error", message: "找不到目前商家可用的專案，未儲存本次變更。", fieldErrors: { root: "請返回專案頁重新開啟新增流程。" } },
    });
    expect(mocks.db.registrationForm.create).not.toHaveBeenCalled();
  });

  it("returns field errors without writing when the input is invalid", async () => {
    const result = await saveRegistrationForm("vendor-1", formData({ name: "", headline: "" }));
    expect(result).toEqual({
      ok: false,
      state: {
        status: "error",
        message: "有幾個欄位需要調整；內容仍保留在畫面上。",
        fieldErrors: { name: "請填寫表單名稱。", headline: "請填寫公開標題。" },
      },
    });
    expect(mocks.db.registrationForm.create).not.toHaveBeenCalled();
  });

  it("marks a taken public address so a caller can choose another", async () => {
    mocks.db.registrationForm.create.mockRejectedValue({ code: "P2002" });
    await expect(saveRegistrationForm("vendor-1", formData())).resolves.toEqual({
      ok: false,
      reason: "slug_taken",
      state: { status: "error", message: "這個公開網址已被使用；請換一個後再儲存。", fieldErrors: { slug: "這個公開網址已被使用。" } },
    });
  });

  it("updates only the vendor's form at the expected version and returns its id", async () => {
    const result = await saveRegistrationForm("vendor-1", formData({ id: "form-1", expectedUpdatedAt: "2026-08-10T01:02:03.000Z" }));
    expect(result).toEqual({ ok: true, form: { id: "form-1", name: "週五講座報名表" } });
    expect(mocks.db.registrationForm.updateMany).toHaveBeenCalledWith({
      where: { id: "form-1", vendorId: "vendor-1", updatedAt: new Date("2026-08-10T01:02:03.000Z") },
      data: expect.any(Object),
    });
  });
});
