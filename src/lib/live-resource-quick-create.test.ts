import { describe, expect, it } from "vitest";
import {
  isLiveQuickTemplateTrigger,
  LIVE_QUICK_DURING_LIVE_TEMPLATE_COPY,
  LIVE_QUICK_TEMPLATE_COPY,
  LIVE_QUICK_TEMPLATE_TRIGGERS,
  liveQuickTemplateCopy,
  liveQuickTemplateFieldErrors,
  LIVE_QUICK_VIDEO_LIMITS,
  liveQuickVideoFieldErrors,
  isLiveQuickProductFulfillmentType,
  LIVE_QUICK_PRODUCT_LIMITS,
  parseLiveQuickProductDraft,
} from "./live-resource-quick-create";
import { MAX_PRODUCT_NAME_LENGTH } from "./product-name-contract";
import { hasUsableMessageTemplateContent, normalizeMessageTemplateDraft } from "./message-template";

describe("live quick template copy", () => {
  it("keeps the before-live and after-live copy for the default entry points", () => {
    for (const trigger of LIVE_QUICK_TEMPLATE_TRIGGERS) {
      expect(liveQuickTemplateCopy(trigger)).toBe(LIVE_QUICK_TEMPLATE_COPY[trigger]);
    }
    expect(liveQuickTemplateCopy("live_reminder", "before_live")).toBe(LIVE_QUICK_TEMPLATE_COPY.live_reminder);
    expect(liveQuickTemplateCopy("post_live_followup", "post_live_followup")).toBe(LIVE_QUICK_TEMPLATE_COPY.post_live_followup);
  });

  it("uses a while-live wording from the 直播中 group for the same live_reminder trigger", () => {
    const copy = liveQuickTemplateCopy("live_reminder", "during_live");

    expect(copy).toBe(LIVE_QUICK_DURING_LIVE_TEMPLATE_COPY);
    expect(copy.label).toBe("直播中通知 Email");
    expect(copy.subject).toBe("{{live_title}} 正在直播中");
    expect(copy.subject).not.toContain("即將開始");
    expect(copy.body).not.toContain("將在");
    expect(isLiveQuickTemplateTrigger("live_reminder")).toBe(true);
  });

  it.each([
    ["registration_confirmed", LIVE_QUICK_TEMPLATE_COPY.registration_confirmed],
    ["live_reminder", LIVE_QUICK_TEMPLATE_COPY.live_reminder],
    ["post_live_followup", LIVE_QUICK_TEMPLATE_COPY.post_live_followup],
    ["live_reminder (during_live)", LIVE_QUICK_DURING_LIVE_TEMPLATE_COPY],
  ])("%s default copy is sendable with only supported variables", (_name, copy) => {
    expect(hasUsableMessageTemplateContent(copy)).toBe(true);
    expect(liveQuickTemplateFieldErrors(copy)).toEqual({});
    expect(normalizeMessageTemplateDraft({
      name: copy.name,
      channel: "email",
      trigger: "live_reminder",
      subject: copy.subject,
      body: copy.body,
      isActive: true,
    }).success).toBe(true);
  });
});

describe("live quick video field errors", () => {
  it("accepts a title and an absolute HTTP(S) URL", () => {
    expect(liveQuickVideoFieldErrors({ title: " 講座 ", videoUrl: " https://media.example.test/a.mp4 " })).toEqual({});
    expect(liveQuickVideoFieldErrors({ title: "講座", videoUrl: "http://media.example.test/a.mp4" })).toEqual({});
  });

  it("points at the field to fix", () => {
    expect(liveQuickVideoFieldErrors({ title: "", videoUrl: "" })).toEqual({ title: "請填寫影片名稱。", videoUrl: "請貼上影片網址。" });
    expect(liveQuickVideoFieldErrors({ title: "x".repeat(LIVE_QUICK_VIDEO_LIMITS.title + 1), videoUrl: "https://a.test/v" }).title).toBeTruthy();
    for (const videoUrl of ["javascript:alert(1)", "/videos/a.mp4", "//cdn.test/a.mp4", "https://user:pass@cdn.test/a.mp4"]) {
      expect(liveQuickVideoFieldErrors({ title: "x", videoUrl }).videoUrl).toBe("影片網址必須是有效的 HTTP 或 HTTPS 完整網址。");
    }
  });
});

describe("live quick product draft", () => {
  const valid = { name: " 原型食物餐盒 ", price: " 1290 ", inventory: "20", fulfillmentType: "physical" };

  it("parses a trimmed name and whole numbers for a physical product", () => {
    expect(parseLiveQuickProductDraft(valid)).toEqual({
      success: true,
      data: { name: "原型食物餐盒", priceTwd: 1290, inventory: 20, fulfillmentType: "physical" },
    });
  });

  it("uses the product editor's bounds: name length, a positive whole price that fits the cents column, positive stock", () => {
    expect(LIVE_QUICK_PRODUCT_LIMITS.name).toBe(MAX_PRODUCT_NAME_LENGTH);
    expect(LIVE_QUICK_PRODUCT_LIMITS.priceMax).toBe(21_474_836);
    // The largest price still fits the 32-bit cents column the product core checks.
    expect(LIVE_QUICK_PRODUCT_LIMITS.priceMax * 100).toBeLessThanOrEqual(2_147_483_647);
    expect((LIVE_QUICK_PRODUCT_LIMITS.priceMax + 1) * 100).toBeGreaterThan(2_147_483_647);
    expect(parseLiveQuickProductDraft({ ...valid, price: "1" }).success).toBe(true);
    expect(parseLiveQuickProductDraft({ ...valid, price: "21474836" }).success).toBe(true);
    expect(parseLiveQuickProductDraft({ ...valid, inventory: "2147483647" }).success).toBe(true);
    expect(parseLiveQuickProductDraft({ ...valid, name: "x".repeat(MAX_PRODUCT_NAME_LENGTH) }).success).toBe(true);
  });

  it.each([
    [{ name: "   " }, "name", "請填寫商品名稱。"],
    [{ name: "x".repeat(MAX_PRODUCT_NAME_LENGTH + 1) }, "name", "商品名稱最多 200 字。"],
    [{ price: "" }, "price", "請填寫售價。"],
    [{ price: "0" }, "price", "售價必須大於 0。"],
    [{ price: "21474837" }, "price", "售價不可超過 NT$21,474,836。"],
    [{ price: "99999999999999999999" }, "price", "售價不可超過 NT$21,474,836。"],
    [{ price: "1290.5" }, "price", "售價須為新台幣整數元，不含小數點、逗號或符號。"],
    [{ price: "12.00" }, "price", "售價須為新台幣整數元，不含小數點、逗號或符號。"],
    [{ price: "1,290" }, "price", "售價須為新台幣整數元，不含小數點、逗號或符號。"],
    [{ price: "-5" }, "price", "售價須為新台幣整數元，不含小數點、逗號或符號。"],
    [{ price: "1e3" }, "price", "售價須為新台幣整數元，不含小數點、逗號或符號。"],
    [{ price: "１２９０" }, "price", "售價須為新台幣整數元，不含小數點、逗號或符號。"],
    [{ inventory: "" }, "inventory", "請填寫可售庫存。"],
    [{ inventory: "0" }, "inventory", "可售庫存至少為 1，庫存為 0 的商品無法結帳。"],
    [{ inventory: "2.5" }, "inventory", "可售庫存須為整數。"],
    [{ inventory: "2147483648" }, "inventory", "可售庫存不可超過 2,147,483,647。"],
    [{ fulfillmentType: "digital" }, "fulfillmentType", "這裡只能建立實體商品；數位內容、服務或課程請到完整商品頁設定。"],
    [{ fulfillmentType: "course" }, "fulfillmentType", "這裡只能建立實體商品；數位內容、服務或課程請到完整商品頁設定。"],
    [{ fulfillmentType: "" }, "fulfillmentType", "這裡只能建立實體商品；數位內容、服務或課程請到完整商品頁設定。"],
  ])("refuses %j", (patch, field, message) => {
    const result = parseLiveQuickProductDraft({ ...valid, ...patch });
    expect(result).toEqual({ success: false, errors: { [field]: message } });
  });

  it("only offers types that can be listed without a delivery setup", () => {
    expect(isLiveQuickProductFulfillmentType("physical")).toBe(true);
    for (const type of ["digital", "service", "course", "PHYSICAL", undefined, null, 1]) {
      expect(isLiveQuickProductFulfillmentType(type)).toBe(false);
    }
  });
});
