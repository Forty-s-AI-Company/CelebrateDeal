import { describe, expect, it } from "vitest";
import {
  parseRegistrationFormDraft,
  registrationFormDraftMatches,
  registrationFormDraftStorageKey,
  serializeRegistrationFormDraft,
} from "./registration-form-draft";

const fields = [
  { key: "name", label: "姓名", type: "text" as const, required: true },
  { key: "email", label: "Email", type: "email" as const, required: true },
];
const values = {
  id: "form-1",
  name: "活動報名",
  slug: "summer",
  headline: "立即報名",
  description: "活動說明",
  submitLabel: "送出",
  successMessage: "完成",
  isActive: true,
};
const updatedAt = "2026-08-10T01:02:03.000Z";

describe("registration form draft", () => {
  it("uses a tenant-scoped and form-scoped storage key", () => {
    expect(registrationFormDraftStorageKey("vendor/1", "form 1")).toBe(
      "celebratedeal:registration-form-draft:v1:vendor%2F1:form%201",
    );
    expect(registrationFormDraftStorageKey("vendor/1")).toContain(":new");
  });

  it("round-trips a bounded current draft", () => {
    const raw = serializeRegistrationFormDraft({
      baseUpdatedAt: updatedAt,
      savedAt: "2026-08-10T02:00:00.000Z",
      values,
      fields,
    });
    expect(parseRegistrationFormDraft(raw, { formId: "form-1", baseUpdatedAt: updatedAt })).toEqual({
      status: "ready",
      draft: expect.objectContaining({ values, fields, baseUpdatedAt: updatedAt }),
    });
  });

  it("refuses stale server versions and forged or malformed client data", () => {
    const raw = serializeRegistrationFormDraft({ baseUpdatedAt: updatedAt, values, fields });
    expect(parseRegistrationFormDraft(raw, { formId: "form-1", baseUpdatedAt: "2026-08-10T03:00:00.000Z" })).toEqual({ status: "stale" });
    expect(parseRegistrationFormDraft(raw, { formId: "form-2", baseUpdatedAt: updatedAt })).toEqual({ status: "invalid" });
    expect(parseRegistrationFormDraft("{broken", { formId: "form-1", baseUpdatedAt: updatedAt })).toEqual({ status: "invalid" });
    expect(parseRegistrationFormDraft(JSON.stringify({ ...JSON.parse(raw), fields: fields.slice(1) }), { formId: "form-1", baseUpdatedAt: updatedAt })).toEqual({ status: "invalid" });
  });

  it("detects whether the merchant has changed values or fields", () => {
    const baseline = { values, fields };
    expect(registrationFormDraftMatches(baseline, baseline)).toBe(true);
    expect(registrationFormDraftMatches({ values: { ...values, headline: "新標題" }, fields }, baseline)).toBe(false);
  });
});
