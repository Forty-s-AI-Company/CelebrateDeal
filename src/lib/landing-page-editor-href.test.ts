import { expect, it } from "vitest";
import { landingPageEditorHref } from "./landing-page-editor-href";

it("builds the full-screen editor URL with an optional encoded step", () => {
  expect(landingPageEditorHref("page-1")).toBe("/landing-pages/page-1/edit");
  expect(landingPageEditorHref("page-1", "  ")).toBe("/landing-pages/page-1/edit");
  expect(landingPageEditorHref("page-1", null)).toBe("/landing-pages/page-1/edit");
  expect(landingPageEditorHref("page-1", ["a", "b"])).toBe("/landing-pages/page-1/edit");
  expect(landingPageEditorHref("page 1", "step/1")).toBe("/landing-pages/page%201/edit?step=step%2F1");
});
