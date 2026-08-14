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
  themeColor: "#12aBc9",
  countdownMinutes: 120,
  stickyText: "直播限定",
  bodyContent: "活動內文",
  notice: "注意事項",
  seoTitle: "SEO 標題",
  seoDescription: "SEO 說明",
  maxVisibleSessions: 3,
  hideExpiredSessions: false,
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

  it("restores schema defaults when a legacy draft omits the new values", () => {
    const raw = JSON.stringify({
      version: 1,
      baseUpdatedAt: updatedAt,
      savedAt: "2026-08-10T02:00:00.000Z",
      values: {
        id: values.id,
        name: values.name,
        slug: values.slug,
        headline: values.headline,
        description: values.description,
        submitLabel: values.submitLabel,
        successMessage: values.successMessage,
        isActive: values.isActive,
      },
      fields,
    });

    expect(parseRegistrationFormDraft(raw, { formId: "form-1", baseUpdatedAt: updatedAt })).toEqual({
      status: "ready",
      draft: expect.objectContaining({
        values: {
          ...values,
          themeColor: null,
          countdownMinutes: null,
          stickyText: null,
          bodyContent: null,
          notice: null,
          seoTitle: null,
          seoDescription: null,
          maxVisibleSessions: 0,
          hideExpiredSessions: true,
        },
      }),
    });
  });

  it("rejects invalid new draft boundaries instead of restoring them", () => {
    const rawFor = (overrides: Record<string, unknown>) => JSON.stringify({
      version: 1,
      baseUpdatedAt: updatedAt,
      savedAt: "2026-08-10T02:00:00.000Z",
      values: { ...values, ...overrides },
      fields,
    });
    const expected = { formId: "form-1", baseUpdatedAt: updatedAt };

    expect(parseRegistrationFormDraft(rawFor({ themeColor: "#12345" }), expected)).toEqual({ status: "invalid" });
    expect(parseRegistrationFormDraft(rawFor({ countdownMinutes: 10_081 }), expected)).toEqual({ status: "invalid" });
    expect(parseRegistrationFormDraft(rawFor({ stickyText: "x".repeat(301) }), expected)).toEqual({ status: "invalid" });
    expect(parseRegistrationFormDraft(rawFor({ bodyContent: "x".repeat(10_001) }), expected)).toEqual({ status: "invalid" });
    expect(parseRegistrationFormDraft(rawFor({ notice: "x".repeat(1_001) }), expected)).toEqual({ status: "invalid" });
    expect(parseRegistrationFormDraft(rawFor({ seoTitle: "x".repeat(201) }), expected)).toEqual({ status: "invalid" });
    expect(parseRegistrationFormDraft(rawFor({ seoDescription: "x".repeat(501) }), expected)).toEqual({ status: "invalid" });
    expect(parseRegistrationFormDraft(rawFor({ maxVisibleSessions: 100 }), expected)).toEqual({ status: "invalid" });
    expect(parseRegistrationFormDraft(rawFor({ hideExpiredSessions: "true" }), expected)).toEqual({ status: "invalid" });
  });

  it("detects whether the merchant has changed values or fields", () => {
    const baseline = { values, fields };
    expect(registrationFormDraftMatches(baseline, baseline)).toBe(true);
    expect(registrationFormDraftMatches({ values: { ...values, headline: "新標題" }, fields }, baseline)).toBe(false);
  });
});
