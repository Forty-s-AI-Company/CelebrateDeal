import { describe, expect, it } from "vitest";
import { createEmptyPageDocument, FunnelNodeSchema, FunnelPopupSchema } from "@/lib/funnel-page-document";
import { pageDocumentRendersRegistrationForm } from "./funnel-registration-surface";

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
});
