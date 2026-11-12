import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  assertSecurity: vi.fn(),
  requireVendorManager: vi.fn(),
  requireVendorManagerContext: vi.fn(),
  revalidatePath: vi.fn(),
  saveRegistrationForm: vi.fn(),
  saveMessageTemplate: vi.fn(),
  saveVideo: vi.fn(),
  mutateProduct: vi.fn(),
}));

vi.mock("@/lib/csrf", () => ({ assertServerActionSecurity: mocks.assertSecurity }));
vi.mock("@/lib/auth", () => ({
  requireVendorManager: mocks.requireVendorManager,
  requireVendorManagerContext: mocks.requireVendorManagerContext,
}));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock("@/lib/registration-form-save", () => ({ saveRegistrationForm: mocks.saveRegistrationForm }));
vi.mock("@/lib/message-template-save", () => ({ saveMessageTemplate: mocks.saveMessageTemplate }));
vi.mock("@/lib/video-save", () => ({ saveVideo: mocks.saveVideo }));
vi.mock("@/lib/product-save", () => ({ mutateProduct: mocks.mutateProduct }));

import { createMessageTemplateQuickAction, createProductQuickAction, createRegistrationFormQuickAction, createUrlVideoQuickAction } from "./live-resource-quick-create";

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
  mocks.saveVideo.mockResolvedValue({ ok: true, video: { id: "video-new", title: "週五講座錄影", created: true, liveReady: true } });
  mocks.mutateProduct.mockResolvedValue({ ok: true, destination: "/products?updated=created", product: { id: "product-new", name: "原型食物餐盒" } });
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

describe("createUrlVideoQuickAction", () => {
  function sentVideo(call = 0) {
    return Object.fromEntries((mocks.saveVideo.mock.calls[call]![1] as FormData).entries());
  }

  it("creates an external URL video for the session vendor from whitelisted fields only", async () => {
    const result = await createUrlVideoQuickAction(formInput({
      title: " 週五講座錄影 ",
      videoUrl: " https://media.example.test/live.mp4 ",
      id: "video-existing",
      vendorId: "vendor-forged",
      sourceType: "cloudflare_live",
      status: "archived",
      thumbnailAssetId: "asset-foreign",
      durationSec: "999",
    }));

    expect(result).toEqual({ status: "success", option: { id: "video-new", title: "週五講座錄影" }, ready: true });
    expect(mocks.saveVideo).toHaveBeenCalledOnce();
    expect(mocks.saveVideo.mock.calls[0]![0]).toBe("vendor-session");
    // No id reaches the core, so it can only create; nothing else the client sent passes through.
    expect(sentVideo()).toEqual({
      title: "週五講座錄影",
      videoUrl: "https://media.example.test/live.mp4",
      durationSec: "0",
      estimatedMinutes: "0",
    });
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it.each([
    [{ title: "x", videoUrl: "javascript:alert(1)" }, "videoUrl"],
    [{ title: "x", videoUrl: "ftp://media.example.test/a.mp4" }, "videoUrl"],
    [{ title: "x", videoUrl: "" }, "videoUrl"],
    [{ title: "   ", videoUrl: "https://media.example.test/a.mp4" }, "title"],
    [{ title: "x".repeat(161), videoUrl: "https://media.example.test/a.mp4" }, "title"],
    [{ title: "x", videoUrl: `https://media.example.test/${"a".repeat(2048)}` }, "videoUrl"],
  ])("refuses %j before writing", async (values, field) => {
    const result = await createUrlVideoQuickAction(formInput(values));

    expect(result).toMatchObject({ status: "error", fieldErrors: { [field]: expect.any(String) } });
    expect(mocks.saveVideo).not.toHaveBeenCalled();
  });

  it("refuses an over-long URL instead of saving a truncated one", async () => {
    const tooLong = `https://media.example.test/${"a".repeat(2048 - "https://media.example.test/".length)}b`;
    const result = await createUrlVideoQuickAction(formInput({ title: "x", videoUrl: `  ${tooLong}  ` }));
    expect(result).toMatchObject({ status: "error", fieldErrors: { videoUrl: expect.any(String) } });
    expect(mocks.saveVideo).not.toHaveBeenCalled();
  });

  it("accepts a URL of exactly the limit even with surrounding whitespace", async () => {
    const atLimit = `https://media.example.test/${"a".repeat(2048 - "https://media.example.test/".length)}`;
    expect(atLimit).toHaveLength(2048);
    const result = await createUrlVideoQuickAction(formInput({ title: "x", videoUrl: `
  ${atLimit}  ` }));
    expect(result.status).toBe("success");
    expect(sentVideo().videoUrl).toBe(atLimit);
  });

  it("refuses duplicated fields instead of picking one", async () => {
    const data = formInput({ title: "x" });
    data.append("videoUrl", "https://media.example.test/a.mp4");
    data.append("videoUrl", "https://media.example.test/b.mp4");
    expect((await createUrlVideoQuickAction(data)).status).toBe("error");
    expect(mocks.saveVideo).not.toHaveBeenCalled();
  });

  it("keeps the drawer open when the core refuses the URL", async () => {
    mocks.saveVideo.mockResolvedValueOnce({ ok: false, reason: "invalid_video" });
    expect(await createUrlVideoQuickAction(formInput({ title: "x", videoUrl: "https://media.example.test/a.mp4" }))).toMatchObject({
      status: "error",
      fieldErrors: { videoUrl: "影片網址無法使用。" },
    });
  });

  it("passes on a created row that is not live ready so the studio waits instead of selecting it", async () => {
    mocks.saveVideo.mockResolvedValueOnce({ ok: true, video: { id: "video-new", title: "x", created: true, liveReady: false } });
    expect(await createUrlVideoQuickAction(formInput({ title: "x", videoUrl: "https://media.example.test/a.mp4" }))).toEqual({
      status: "success",
      option: { id: "video-new", title: "x" },
      ready: false,
    });
  });

  it("rejects an expired CSRF token before reading the session or writing", async () => {
    mocks.assertSecurity.mockRejectedValueOnce(new Error("Invalid CSRF token."));
    expect((await createUrlVideoQuickAction(formInput({ title: "x", videoUrl: "https://media.example.test/a.mp4" }))).status).toBe("error");
    expect(mocks.requireVendorManager).not.toHaveBeenCalled();
    expect(mocks.saveVideo).not.toHaveBeenCalled();
  });
});

describe("createProductQuickAction", () => {
  const valid = { name: " 原型食物餐盒 ", price: "1290", inventory: "20", fulfillmentType: "physical" };

  function sentProduct(call = 0) {
    return Object.fromEntries((mocks.mutateProduct.mock.calls[call]![2] as FormData).entries());
  }

  it("creates a listed physical product for the session vendor from whitelisted fields and the editor's defaults", async () => {
    const result = await createProductQuickAction(formInput({
      ...valid,
      projectId: "project-1",
      // Everything below is forged and must never reach the core.
      vendorId: "vendor-forged",
      id: "product-existing",
      revision: "3",
      inventoryBaseline: "20",
      priceCents: "1",
      compareAt: "99999",
      currency: "USD",
      commerceDomain: "course",
      checkoutUrl: "https://evil.example.test/pay",
      imageAssetId: "asset-foreign",
      upsellProductId: "product-foreign",
      upsellDiscount: "1000",
      deliveryUrl: "https://evil.example.test/file",
      customCheckoutFields: JSON.stringify([{ key: "x" }]),
      isActive: "",
    }));

    expect(result).toEqual({ status: "success", option: { id: "product-new", name: "原型食物餐盒", inventory: 20 } });
    expect(mocks.mutateProduct).toHaveBeenCalledOnce();
    expect(mocks.mutateProduct.mock.calls[0]![0]).toBe("vendor-session");
    expect(mocks.mutateProduct.mock.calls[0]![1]).toEqual({ version: 0 });
    // Exactly the product editor's fields for a new listed physical product; no id, so it can only create.
    expect(sentProduct()).toEqual({
      name: "原型食物餐盒",
      slug: "原型食物餐盒",
      price: "1290",
      compareAt: "",
      currency: "TWD",
      inventory: "20",
      fulfillmentType: "physical",
      description: "",
      imageUrl: "",
      imageAssetId: "",
      checkoutUrl: "",
      customCheckoutFields: "[]",
      upsellProductId: "",
      downsellProductId: "",
      upsellDiscount: "0",
      isActive: "on",
      projectId: "project-1",
    });
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/(app)", "layout");
  });

  it("forwards the parsed whole-dollar price, never the submitted text", async () => {
    await createProductQuickAction(formInput({ ...valid, price: " 0001290 ", inventory: " 007 " }));
    expect(sentProduct()).toMatchObject({ price: "1290", inventory: "7" });
  });

  it.each([
    [{ price: "1290.5" }, "price"],
    [{ price: "0" }, "price"],
    [{ price: "21474837" }, "price"],
    [{ price: "-1" }, "price"],
    [{ inventory: "0" }, "inventory"],
    [{ name: "" }, "name"],
    [{ name: "x".repeat(201) }, "name"],
    [{ fulfillmentType: "digital" }, "fulfillmentType"],
    [{ fulfillmentType: "service" }, "fulfillmentType"],
    [{ fulfillmentType: "course" }, "fulfillmentType"],
  ])("refuses %j before writing", async (patch, field) => {
    const result = await createProductQuickAction(formInput({ ...valid, ...patch }));

    expect(result).toMatchObject({ status: "error", fieldErrors: { [field]: expect.any(String) } });
    expect(mocks.mutateProduct).not.toHaveBeenCalled();
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it("refuses duplicated fields instead of picking one", async () => {
    for (const key of ["price", "inventory", "fulfillmentType", "name"]) {
      const data = formInput(valid);
      data.append(key, key === "fulfillmentType" ? "physical" : "1");
      expect((await createProductQuickAction(data)).status).toBe("error");
    }
    const projects = formInput(valid);
    projects.append("projectId", "project-1");
    projects.append("projectId", "project-2");
    expect((await createProductQuickAction(projects)).status).toBe("error");
    expect(mocks.mutateProduct).not.toHaveBeenCalled();
  });

  it("retries a taken product address with a random suffix", async () => {
    mocks.mutateProduct.mockResolvedValueOnce({ ok: false, state: { version: 1, error: "duplicate_slug" } });

    const result = await createProductQuickAction(formInput({ ...valid, name: "Whole Food Box" }));

    expect(result.status).toBe("success");
    expect(mocks.mutateProduct).toHaveBeenCalledTimes(2);
    expect(sentProduct(0).slug).toBe("whole-food-box");
    expect(sentProduct(1).slug).toMatch(/^whole-food-box-[0-9a-f]{6}$/u);
  });

  it("always suffixes a name without address characters and gives up after four taken addresses", async () => {
    mocks.mutateProduct.mockResolvedValue({ ok: false, state: { version: 1, error: "duplicate_slug" } });

    const result = await createProductQuickAction(formInput({ ...valid, name: "！！！" }));

    expect(result).toEqual({ status: "error", message: expect.stringContaining("商品網址"), fieldErrors: { root: "商品網址產生失敗。" } });
    expect(mocks.mutateProduct).toHaveBeenCalledTimes(4);
    for (let call = 0; call < 4; call += 1) expect(sentProduct(call).slug).toMatch(/^product-[0-9a-f]{6}$/u);
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it("passes the core's field errors for the drawer's fields and keeps the rest at the root", async () => {
    mocks.mutateProduct.mockResolvedValueOnce({ ok: false, state: { version: 1, error: "invalid_product", fieldErrors: { price: "售價須為整數新台幣元。", slug: "請填寫商品網址（可用英數字與連字號）。" } } });
    expect(await createProductQuickAction(formInput(valid))).toEqual({
      status: "error",
      message: "有幾個欄位需要調整；內容仍保留在抽屜中。",
      fieldErrors: { price: "售價須為整數新台幣元。" },
    });

    mocks.mutateProduct.mockResolvedValueOnce({ ok: false, state: { version: 1, error: "not_found" } });
    expect(await createProductQuickAction(formInput({ ...valid, projectId: "project-foreign" }))).toEqual({
      status: "error",
      message: "找不到目前商家可用的專案，未儲存本次變更。",
      fieldErrors: { root: "請重新整理頁面後再建立。" },
    });
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it("reports a failed write without claiming success when the core throws", async () => {
    mocks.mutateProduct.mockRejectedValueOnce(new Error("synthetic database detail"));
    const result = await createProductQuickAction(formInput(valid));
    expect(result).toEqual({ status: "error", message: expect.stringContaining("商品沒有建立"), fieldErrors: { root: "商品暫時無法建立。" } });
    expect(JSON.stringify(result)).not.toContain("synthetic database detail");
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it("uses the product editor's permission check and never writes when it refuses", async () => {
    mocks.requireVendorManager.mockRejectedValueOnce(new Error("NEXT_REDIRECT:/dashboard?error=insufficient_role"));
    await expect(createProductQuickAction(formInput(valid))).rejects.toThrow("insufficient_role");
    expect(mocks.requireVendorManager).toHaveBeenCalledOnce();
    expect(mocks.mutateProduct).not.toHaveBeenCalled();
  });

  it("rejects an expired CSRF token before reading the session or writing", async () => {
    mocks.assertSecurity.mockRejectedValueOnce(new Error("Invalid CSRF token."));
    expect(await createProductQuickAction(formInput(valid))).toMatchObject({ status: "error", fieldErrors: { root: "本頁的安全驗證已過期。" } });
    expect(mocks.requireVendorManager).not.toHaveBeenCalled();
    expect(mocks.mutateProduct).not.toHaveBeenCalled();
  });
});
