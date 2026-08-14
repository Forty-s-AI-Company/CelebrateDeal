import { describe, expect, it } from "vitest";
import { parseRegistrationFormInput } from "./registration-form-input";

const validFields = [
  { key: "name", label: " 姓名 ", type: "text", required: true },
  { key: "email", label: "Email", type: "email", required: true },
];

function validFormData() {
  const formData = new FormData();
  formData.set("name", " 夏季活動報名 ");
  formData.set("slug", " Summer Launch ");
  formData.set("headline", " 立即報名 ");
  formData.set("description", " 活動說明 ");
  formData.set("fields", JSON.stringify(validFields));
  formData.set("submitLabel", " 送出報名 ");
  formData.set("successMessage", " 已收到資料 ");
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
});

