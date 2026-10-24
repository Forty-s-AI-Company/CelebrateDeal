import { describe, expect, it } from "vitest";
import { createEmptyPageDocument, FunnelNodeSchema, FunnelPopupSchema } from "@/lib/funnel-page-document";
import { pageDocumentHasCommerce, pageDocumentRendersRegistrationForm, surveyLeadFormFields } from "./funnel-registration-surface";

const node = (value: Record<string, unknown>) => FunnelNodeSchema.parse({ schemaVersion: 1, ...value });

describe("registration form surface", () => {
  it("finds nested lead forms, surveys and popup forms", () => {
    const nested = createEmptyPageDocument();
    nested.root = [node({ id: "section", type: "section", children: [node({ id: "lead", type: "form" })] })];
    expect(pageDocumentRendersRegistrationForm(nested)).toBe(true);
    const survey = createEmptyPageDocument();
    survey.root = [node({ id: "survey", type: "survey" })];
    expect(pageDocumentRendersRegistrationForm(survey)).toBe(true);
    const popup = createEmptyPageDocument();
    popup.popups = [FunnelPopupSchema.parse({ schemaVersion: 1, id: "popup", name: "Popup", root: [node({ id: "popup-form", type: "form" })] })];
    expect(pageDocumentRendersRegistrationForm(popup)).toBe(true);
  });

  it("ignores pages without a lead form and checkout-contact forms", () => {
    expect(pageDocumentRendersRegistrationForm(createEmptyPageDocument())).toBe(false);
    const contact = createEmptyPageDocument();
    contact.root = [node({ id: "contact", type: "form", props: { variant: "checkout-contact" } })];
    expect(pageDocumentRendersRegistrationForm(contact)).toBe(false);
  });

  it("detects every purchase surface that rules out independent publication", () => {
    const plain = createEmptyPageDocument();
    plain.root = [node({ id: "lead", type: "form" })];
    expect(pageDocumentHasCommerce(plain)).toBe(false);
    const payment = createEmptyPageDocument();
    payment.root = [node({ id: "row", type: "row", children: [node({ id: "pay", type: "payment_button" })] })];
    expect(pageDocumentHasCommerce(payment)).toBe(true);
    const contact = createEmptyPageDocument();
    contact.popups = [FunnelPopupSchema.parse({ schemaVersion: 1, id: "popup", name: "Popup", root: [node({ id: "contact", type: "form", props: { variant: "checkout-contact" } })] })];
    expect(pageDocumentHasCommerce(contact)).toBe(true);
    expect(pageDocumentHasCommerce({ ...createEmptyPageDocument(), commerce: { productId: "product-1" } } as never)).toBe(true);
  });

  it("derives survey answer fields with the renderer's key rule and skips unusable keys", () => {
    const document = createEmptyPageDocument();
    document.root = [
      node({ id: "survey_named", type: "survey", props: { name: "preference", question: "偏好時段", required: true } }),
      node({ id: "survey_default", type: "survey", props: { name: "壞掉的 key" } }),
      node({ id: "survey_reserved", type: "survey", props: { name: "formId" } }),
      node({ id: "survey_taken", type: "survey", props: { name: "email" } }),
      node({ id: "survey_duplicate", type: "survey", props: { name: "preference" } }),
    ];
    expect(surveyLeadFormFields(document, new Set(["name", "email"]))).toEqual([
      { key: "preference", label: "偏好時段", type: "text", required: true },
      { key: "survey_default", label: "請選擇一個答案", type: "text", required: false },
    ]);
  });
});
