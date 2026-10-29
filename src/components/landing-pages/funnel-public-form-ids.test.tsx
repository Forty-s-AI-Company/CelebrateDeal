import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { previewFunnelTemplate } from "@/lib/funnel-template-gallery";
import { FunnelPageDocumentRenderer, type FunnelSubmissionContext } from "./funnel-page-document-renderer";

const submission: FunnelSubmissionContext = {
  form: { id: "lead-form", fields: [{ key: "name", label: "姓名", type: "text", required: true }, { key: "email", label: "Email", type: "email", required: true }], submitLabel: "送出", successMessage: "ok" },
  landingPageId: "lp",
};

describe("public designed forms", () => {
  it("keeps label/input ids unique when one page has two forms bound to the same registration form", () => {
    // leads-checklist-minimal has a hero form and a closing form.
    const html = renderToStaticMarkup(<FunnelPageDocumentRenderer document={previewFunnelTemplate("leads-checklist-minimal")} viewport="desktop" mode="preview" submission={submission} publicSurface />);
    const ids = [...html.matchAll(/<input id="(funnel-field-[^"]+)"/gu)].map((match) => match[1]!);
    expect(ids).toHaveLength(4);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(html.match(new RegExp(`for="${id}"`, "gu"))).toHaveLength(1);
  });
});
