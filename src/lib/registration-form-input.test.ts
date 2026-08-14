import { describe, expect, it } from "vitest";
import { parseRegistrationFormInput } from "./registration-form-input";

const validFields = [
  { key: "name", label: " 姓名 ", type: "text", required: true },
  { key: "email", label: "Email", type: "email", required: true },
];

const mediaFields = [
  "heroImageUrl",
  "heroImageAssetId",
  "backgroundImageUrl",
  "backgroundImageAssetId",
  "promoVideoId",
] as const;

function validFormData() {
  const formData = new FormData();
  formData.set("name", " 夏季活動報名 ");
  formData.set("slug", " Summer Launch ");
  formData.set("headline", " 立即報名 ");
  formData.set("description", " 活動說明 ");
  formData.set("fields", JSON.stringify(validFields));
  formData.set("submitLabel", " 送出報名 ");
  formData.set("successMessage", " 已收到資料 ");
  formData.set("heroImageUrl", " https://media.example.test/hero.webp ");
  formData.set("heroImageAssetId", " hero-asset-1 ");
  formData.set("backgroundImageUrl", " https://media.example.test/background.webp ");
  formData.set("backgroundImageAssetId", " background-asset-1 ");
  formData.set("promoVideoId", " promo-video-1 ");
  formData.set("themeColor", " #12aBc9 ");
  formData.set("countdownMinutes", " 120 ");
  formData.set("stickyText", " 直播限定 ");
  formData.set("bodyContent", " 活動內文 ");
  formData.set("notice", " 注意事項 ");
  formData.set("seoTitle", " SEO 標題 ");
  formData.set("seoDescription", " SEO 說明 ");
  formData.set("maxVisibleSessions", " 3 ");
  formData.set("hideExpiredSessions", "on");
  formData.set("isActive", "on");
  return formData;
}

describe("registration form input", () => {
  it("normalizes bounded metadata and the validated legacy-compatible field schema", () => {
    const result = parseRegistrationFormInput(validFormData());

    expect(result).toEqual({
      success: true,
      data: {
        id: null,
        name: "夏季活動報名",
        slug: "summer-launch",
        headline: "立即報名",
        description: "活動說明",
        fields: [
          { key: "name", label: "姓名", type: "text", required: true },
          { key: "email", label: "Email", type: "email", required: true },
        ],
        submitLabel: "送出報名",
        successMessage: "已收到資料",
        heroImageUrl: "https://media.example.test/hero.webp",
        heroImageAssetId: "hero-asset-1",
        backgroundImageUrl: "https://media.example.test/background.webp",
        backgroundImageAssetId: "background-asset-1",
        promoVideoId: "promo-video-1",
        themeColor: "#12aBc9",
        countdownMinutes: 120,
        stickyText: "直播限定",
        bodyContent: "活動內文",
        notice: "注意事項",
        seoTitle: "SEO 標題",
        seoDescription: "SEO 說明",
        maxVisibleSessions: 3,
        hideExpiredSessions: true,
        isActive: true,
      },
    });
  });

  it("returns specific recoverable errors for missing metadata and invalid fields", () => {
    const formData = validFormData();
    formData.set("name", "");
    formData.set("slug", "---");
    formData.set("fields", JSON.stringify(validFields.slice(0, 1)));

    const result = parseRegistrationFormInput(formData);

    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.errors.name).toContain("表單名稱");
    expect(result.errors.slug).toContain("至少要包含");
    expect(result.errors.fields).toContain("姓名與 Email");
  });

  it("rejects malformed, oversized, and forged editor data before persistence", () => {
    const malformed = validFormData();
    malformed.set("fields", "{not-json}");
    const malformedResult = parseRegistrationFormInput(malformed);
    expect(malformedResult.success).toBe(false);
    if (!malformedResult.success) expect(malformedResult.errors.fields).toContain("無法解析");

    const forged = validFormData();
    forged.set("id", "x".repeat(129));
    forged.set("description", "x".repeat(5_001));
    const forgedResult = parseRegistrationFormInput(forged);
    expect(forgedResult.success).toBe(false);
    if (!forgedResult.success) {
      expect(forgedResult.errors.root).toContain("返回列表");
      expect(forgedResult.errors.description).toContain("5,000");
    }
  });

  it("accepts numeric and text boundaries, defaults omitted values, and requires an on checkbox", () => {
    const formData = validFormData();
    formData.set("themeColor", "");
    formData.set("countdownMinutes", "10080");
    formData.set("stickyText", "x".repeat(300));
    formData.set("bodyContent", "x".repeat(10_000));
    formData.set("notice", "x".repeat(1_000));
    formData.set("seoTitle", "x".repeat(200));
    formData.set("seoDescription", "x".repeat(500));
    formData.set("maxVisibleSessions", "99");
    formData.delete("hideExpiredSessions");

    const result = parseRegistrationFormInput(formData);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toMatchObject({
        themeColor: null,
        countdownMinutes: 10080,
        stickyText: "x".repeat(300),
        bodyContent: "x".repeat(10_000),
        notice: "x".repeat(1_000),
        seoTitle: "x".repeat(200),
        seoDescription: "x".repeat(500),
        maxVisibleSessions: 99,
        hideExpiredSessions: false,
      });
    }
  });

  it("normalizes empty media fields to null without applying URL protocol validation", () => {
    const formData = validFormData();
    for (const field of mediaFields) formData.delete(field);
    formData.set("heroImageUrl", "not-a-url");
    formData.set("backgroundImageUrl", " javascript:alert(1) ");

    const result = parseRegistrationFormInput(formData);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toMatchObject({
        heroImageUrl: "not-a-url",
        heroImageAssetId: null,
        backgroundImageUrl: "javascript:alert(1)",
        backgroundImageAssetId: null,
        promoVideoId: null,
      });
    }
  });

  it("rejects media URLs over 2048 characters and IDs over 128 characters", () => {
    const formData = validFormData();
    formData.set("heroImageUrl", "x".repeat(2_049));
    formData.set("heroImageAssetId", "x".repeat(129));
    formData.set("backgroundImageUrl", "x".repeat(2_049));
    formData.set("backgroundImageAssetId", "x".repeat(129));
    formData.set("promoVideoId", "x".repeat(129));

    const result = parseRegistrationFormInput(formData);

    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.errors.heroImageUrl).toContain("2048");
    expect(result.errors.heroImageAssetId).toContain("128");
    expect(result.errors.backgroundImageUrl).toContain("2048");
    expect(result.errors.backgroundImageAssetId).toContain("128");
    expect(result.errors.promoVideoId).toContain("128");
  });

  it("rejects duplicate and File values for every media field", () => {
    for (const field of mediaFields) {
      const duplicate = validFormData();
      duplicate.delete(field);
      duplicate.append(field, "first");
      duplicate.append(field, "second");

      const duplicateResult = parseRegistrationFormInput(duplicate);
      expect(duplicateResult.success).toBe(false);
      if (!duplicateResult.success) expect(duplicateResult.errors[field]).toContain("單一文字");

      const fileValue = validFormData();
      fileValue.delete(field);
      fileValue.append(field, new File(["value"], `${field}.txt`));

      const fileResult = parseRegistrationFormInput(fileValue);
      expect(fileResult.success).toBe(false);
      if (!fileResult.success) expect(fileResult.errors[field]).toContain("單一文字");
    }
  });

  it("rejects invalid color, integer ranges, integer formats, and text lengths", () => {
    const formData = validFormData();
    formData.set("themeColor", "red");
    formData.set("countdownMinutes", "10080.5");
    formData.set("maxVisibleSessions", "100");
    formData.set("stickyText", "x".repeat(301));
    formData.set("bodyContent", "x".repeat(10_001));
    formData.set("notice", "x".repeat(1_001));
    formData.set("seoTitle", "x".repeat(201));
    formData.set("seoDescription", "x".repeat(501));

    const result = parseRegistrationFormInput(formData);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.errors.themeColor).toContain("#RRGGBB");
      expect(result.errors.countdownMinutes).toContain("整數");
      expect(result.errors.maxVisibleSessions).toContain("0 到 99");
      expect(result.errors.stickyText).toContain("300");
      expect(result.errors.bodyContent).toContain("10000");
      expect(result.errors.notice).toContain("1000");
      expect(result.errors.seoTitle).toContain("200");
      expect(result.errors.seoDescription).toContain("500");
    }
  });

  it("requires single string values for scalar fields", () => {
    const valid = validFormData();
    valid.set("countdownMinutes", "0");
    const validResult = parseRegistrationFormInput(valid);
    expect(validResult.success).toBe(true);
    if (validResult.success) expect(validResult.data.countdownMinutes).toBe(0);

    const nanDuplicate = validFormData();
    nanDuplicate.delete("countdownMinutes");
    nanDuplicate.append("countdownMinutes", "NaN");
    nanDuplicate.append("countdownMinutes", "NaN");
    const nanDuplicateResult = parseRegistrationFormInput(nanDuplicate);
    expect(nanDuplicateResult.success).toBe(false);
    if (!nanDuplicateResult.success) expect(nanDuplicateResult.errors.countdownMinutes).toContain("單一文字");

    const huge = validFormData();
    huge.set("countdownMinutes", "9".repeat(1_000));
    const hugeResult = parseRegistrationFormInput(huge);
    expect(hugeResult.success).toBe(false);
    if (!hugeResult.success) expect(hugeResult.errors.countdownMinutes).toContain("整數");

    const repeatedTheme = validFormData();
    repeatedTheme.delete("themeColor");
    repeatedTheme.append("themeColor", "#123456");
    repeatedTheme.append("themeColor", "#654321");
    const repeatedThemeResult = parseRegistrationFormInput(repeatedTheme);
    expect(repeatedThemeResult.success).toBe(false);
    if (!repeatedThemeResult.success) expect(repeatedThemeResult.errors.themeColor).toContain("單一文字");

    const fileValue = validFormData();
    fileValue.delete("countdownMinutes");
    fileValue.append("countdownMinutes", new File(["0"], "countdown.txt"));
    const fileValueResult = parseRegistrationFormInput(fileValue);
    expect(fileValueResult.success).toBe(false);
    if (!fileValueResult.success) expect(fileValueResult.errors.countdownMinutes).toContain("單一文字");
  });

  it("accepts only a single on value for checkboxes", () => {
    const repeated = validFormData();
    repeated.append("isActive", "on");
    const repeatedResult = parseRegistrationFormInput(repeated);
    expect(repeatedResult.success).toBe(false);
    if (!repeatedResult.success) expect(repeatedResult.errors.isActive).toContain("單一 on");

    const invalid = validFormData();
    invalid.set("hideExpiredSessions", "true");
    const invalidResult = parseRegistrationFormInput(invalid);
    expect(invalidResult.success).toBe(false);
    if (!invalidResult.success) expect(invalidResult.errors.hideExpiredSessions).toContain("單一 on");

    const fileValue = validFormData();
    fileValue.delete("hideExpiredSessions");
    fileValue.append("hideExpiredSessions", new File(["on"], "checked.txt"));
    const fileValueResult = parseRegistrationFormInput(fileValue);
    expect(fileValueResult.success).toBe(false);
    if (!fileValueResult.success) expect(fileValueResult.errors.hideExpiredSessions).toContain("單一 on");
  });
});
