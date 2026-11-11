import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  assertSecurity: vi.fn(),
  requireVendorManager: vi.fn(),
  requireVendorManagerContext: vi.fn(),
  revalidatePath: vi.fn(),
  saveRegistrationForm: vi.fn(),
  saveMessageTemplate: vi.fn(),
}));

vi.mock("@/lib/csrf", () => ({ assertServerActionSecurity: mocks.assertSecurity }));
vi.mock("@/lib/auth", () => ({
  requireVendorManager: mocks.requireVendorManager,
  requireVendorManagerContext: mocks.requireVendorManagerContext,
}));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock("@/lib/registration-form-save", () => ({ saveRegistrationForm: mocks.saveRegistrationForm }));
vi.mock("@/lib/message-template-save", () => ({ saveMessageTemplate: mocks.saveMessageTemplate }));

import { createMessageTemplateQuickAction, createRegistrationFormQuickAction } from "./live-resource-quick-create";

function formInput(values: Record<string, string>) {
  const data = new FormData();
  data.set("_csrf", "synthetic");
  for (const [key, value] of Object.entries(values)) data.set(key, value);
  return data;
}

function submitted(call: number) {
  return Object.fromEntries((mocks.saveRegistrationForm.mock.calls[call]![1] as FormData).entries());
}

const slugTaken = { ok: false, reason: "slug_taken", state: { status: "error", message: "這個公開網址已被使用；請換一個後再儲存。", fieldErrors: { slug: "這個公開網址已被使用。" } } };

beforeEach(() => {
  vi.clearAllMocks();
  mocks.assertSecurity.mockResolvedValue(undefined);
  mocks.requireVendorManager.mockResolvedValue({ id: "vendor-session" });
  mocks.requireVendorManagerContext.mockResolvedValue({ auth: { user: { id: "user-1" }, member: { role: "owner" } }, vendor: { id: "vendor-session" } });
  mocks.saveRegistrationForm.mockResolvedValue({ ok: true, form: { id: "form-new", name: "週五講座報名表" } });
  mocks.saveMessageTemplate.mockResolvedValue({
    ok: true,
    template: { id: "template-new", name: "報名成功通知", channel: "email", trigger: "registration_confirmed", subject: "{{live_title}} 報名成功", body: "{{name}} 你好", isActive: true },
    reconciliationStatuses: [],
  });
});

describe("createRegistrationFormQuickAction", () => {
  it("creates an active form with the default fields for the session vendor and returns the studio option", async () => {
    const result = await createRegistrationFormQuickAction(formInput({ name: "週五講座報名表", headline: "週五講座", projectId: "project-1", vendorId: "vendor-forged" }));

    expect(result).toEqual({ status: "success", option: { id: "form-new", name: "週五講座報名表" } });
    expect(mocks.saveRegistrationForm).toHaveBeenCalledOnce();
    expect(mocks.saveRegistrationForm.mock.calls[0]![0]).toBe("vendor-session");
    const data = submitted(0);
    expect(data).toMatchObject({
      name: "週五講座報名表",
      slug: "週五講座報名表",
      headline: "週五講座",
      submitLabel: "送出報名",
      successMessage: "已收到你的資料，開播前會再提醒你。",
      isActive: "on",
      projectId: "project-1",
    });
    expect(data).not.toHaveProperty("vendorId");
    expect(data).not.toHaveProperty("id");
    expect(JSON.parse(String(data.fields))).toEqual([
      { key: "name", label: "姓名", type: "text", required: true },
      { key: "email", label: "Email", type: "email", required: true },
      { key: "phone", label: "手機", type: "tel", required: false },
    ]);
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/(app)", "layout");
  });

  it("retries a taken public address with a random suffix instead of failing", async () => {
    mocks.saveRegistrationForm.mockResolvedValueOnce(slugTaken);

    const result = await createRegistrationFormQuickAction(formInput({ name: "Summer Launch", headline: "Summer" }));

    expect(result.status).toBe("success");
    expect(mocks.saveRegistrationForm).toHaveBeenCalledTimes(2);
    expect(submitted(0).slug).toBe("summer-launch");
    expect(submitted(1).slug).toMatch(/^summer-launch-[0-9a-f]{6}$/u);
  });

  it("gives up after four taken addresses without revalidating", async () => {
    mocks.saveRegistrationForm.mockResolvedValue(slugTaken);

    const result = await createRegistrationFormQuickAction(formInput({ name: "Summer Launch", headline: "Summer" }));

    expect(result).toEqual({ status: "error", message: expect.stringContaining("公開網址"), fieldErrors: { root: "公開網址產生失敗。" } });
    expect(mocks.saveRegistrationForm).toHaveBeenCalledTimes(4);
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it("always suffixes a name without address characters", async () => {
    await createRegistrationFormQuickAction(formInput({ name: "！！！", headline: "Summer" }));
    expect(submitted(0).slug).toMatch(/^form-[0-9a-f]{6}$/u);
  });

  it("returns the core's field errors for name and headline and keeps other messages at the root", async () => {
    mocks.saveRegistrationForm.mockResolvedValueOnce({
      ok: false,
      state: { status: "error", message: "有幾個欄位需要調整；內容仍保留在畫面上。", fieldErrors: { name: "請填寫表單名稱。", headline: "請填寫公開標題。" } },
    });
    expect(await createRegistrationFormQuickAction(formInput({ name: "", headline: "" }))).toEqual({
      status: "error",
      message: "有幾個欄位需要調整；內容仍保留在畫面上。",
      fieldErrors: { name: "請填寫表單名稱。", headline: "請填寫公開標題。" },
    });

    mocks.saveRegistrationForm.mockResolvedValueOnce({
      ok: false,
      state: { status: "error", message: "找不到目前商家可用的專案，未儲存本次變更。", fieldErrors: { root: "請返回專案頁重新開啟新增流程。" } },
    });
    expect(await createRegistrationFormQuickAction(formInput({ name: "A", headline: "B", projectId: "foreign" }))).toEqual({
      status: "error",
      message: "找不到目前商家可用的專案，未儲存本次變更。",
      fieldErrors: { root: "請返回專案頁重新開啟新增流程。" },
    });
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it("rejects an expired CSRF token before reading the session or writing", async () => {
    mocks.assertSecurity.mockRejectedValueOnce(new Error("Invalid CSRF token."));

    const result = await createRegistrationFormQuickAction(formInput({ name: "A", headline: "B" }));

    expect(result).toMatchObject({ status: "error", fieldErrors: { root: "本頁的安全驗證已過期。" } });
    expect(mocks.requireVendorManager).not.toHaveBeenCalled();
    expect(mocks.saveRegistrationForm).not.toHaveBeenCalled();
  });

  it("refuses several or non-text project values", async () => {
    const data = formInput({ name: "A", headline: "B" });
    data.append("projectId", "project-1");
    data.append("projectId", "project-2");
    expect((await createRegistrationFormQuickAction(data)).status).toBe("error");
    expect(mocks.saveRegistrationForm).not.toHaveBeenCalled();
  });
});

describe("createMessageTemplateQuickAction", () => {
  const sendable = { name: "報名成功通知", subject: "{{live_title}} 報名成功", body: "{{name}} 你好，開播時間 {{live_start_at}}。" };

  it.each(["registration_confirmed", "live_reminder", "post_live_followup"])("creates an active Email template for %s", async (trigger) => {
    const result = await createMessageTemplateQuickAction(formInput({ ...sendable, trigger, channel: "line", id: "template-forged", expectedUpdatedAt: "2026-01-01T00:00:00.000Z" }));

    expect(result.status).toBe("success");
    const call = mocks.saveMessageTemplate.mock.calls[0]![0] as { vendorId: string; auditActor: unknown; formData: FormData };
    expect(call.vendorId).toBe("vendor-session");
    expect(call.auditActor).toEqual({ actorId: "user-1", actorLabel: "owner" });
    expect(Object.fromEntries(call.formData.entries())).toEqual({ ...sendable, trigger, channel: "email", isActive: "on" });
  });

  it.each(["order_paid", "live_started", "commission_credited", "", "REGISTRATION_CONFIRMED"])("rejects the %s trigger without writing", async (trigger) => {
    const result = await createMessageTemplateQuickAction(formInput({ ...sendable, trigger }));

    expect(result).toMatchObject({ status: "error", fieldErrors: { trigger: "不支援的模板用途。" } });
    expect(mocks.saveMessageTemplate).not.toHaveBeenCalled();
  });

  it("points at the field to fix when the template could not be sent", async () => {
    const result = await createMessageTemplateQuickAction(formInput({ trigger: "live_reminder", name: " ", subject: "{{coupon_code}}", body: "" }));

    expect(result).toEqual({
      status: "error",
      message: "有幾個欄位需要調整；內容仍保留在抽屜中。",
      fieldErrors: {
        name: "請填寫模板名稱。",
        subject: "主旨含有不支援的變數，只能使用下方列出的變數。",
        body: "請填寫 Email 內容。",
      },
    });
    expect(mocks.saveMessageTemplate).not.toHaveBeenCalled();
  });

  it("returns the studio option shape from the saved template", async () => {
    mocks.saveMessageTemplate.mockResolvedValueOnce({
      ok: true,
      template: { id: "template-reminder", name: "開播提醒", channel: "email", trigger: "live_reminder", subject: "{{live_title}} 即將開始", body: "{{live_url}}", isActive: true },
      reconciliationStatuses: [],
    });

    expect(await createMessageTemplateQuickAction(formInput({ ...sendable, trigger: "live_reminder" }))).toEqual({
      status: "success",
      option: { id: "template-reminder", name: "開播提醒", channel: "email", trigger: "live_reminder" },
    });
  });

  it("never turns an already written template into an error after the write", async () => {
    mocks.saveMessageTemplate.mockResolvedValueOnce({
      ok: true,
      template: { id: "template-x", name: "x", channel: "email", trigger: "live_reminder", subject: "", body: "x", isActive: true },
      reconciliationStatuses: [],
    });

    // An error here would leave this template behind while the drawer asks to create it again.
    expect(await createMessageTemplateQuickAction(formInput({ ...sendable, trigger: "live_reminder" }))).toEqual({
      status: "success",
      option: { id: "template-x", name: "x", channel: "email", trigger: "live_reminder" },
    });
    expect(mocks.saveMessageTemplate).toHaveBeenCalledOnce();
  });

  it("still refuses unsendable content before anything is written", async () => {
    for (const draft of [
      { ...sendable, subject: "   " },
      { ...sendable, body: "{{not_a_variable}}" },
      { ...sendable, name: "" },
    ]) {
      expect((await createMessageTemplateQuickAction(formInput({ ...draft, trigger: "live_reminder" }))).status).toBe("error");
    }
    expect(mocks.saveMessageTemplate).not.toHaveBeenCalled();
  });

  it("keeps the drawer open when the core refuses the template", async () => {
    mocks.saveMessageTemplate.mockResolvedValueOnce({ ok: false, state: { status: "error", error: "invalid_template", draft: null, expectedUpdatedAt: null, version: 1 } });
    expect(await createMessageTemplateQuickAction(formInput({ ...sendable, trigger: "post_live_followup" }))).toMatchObject({ status: "error", fieldErrors: { root: "模板沒有建立。" } });
  });

  it("rejects an expired CSRF token before reading the session or writing", async () => {
    mocks.assertSecurity.mockRejectedValueOnce(new Error("Invalid CSRF token."));
    expect((await createMessageTemplateQuickAction(formInput({ ...sendable, trigger: "live_reminder" }))).status).toBe("error");
    expect(mocks.requireVendorManagerContext).not.toHaveBeenCalled();
    expect(mocks.saveMessageTemplate).not.toHaveBeenCalled();
  });
});
