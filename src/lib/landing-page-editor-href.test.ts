import { expect, it } from "vitest";
import { isLandingPageEditorPath, landingPageEditorHref } from "./landing-page-editor-href";

it("recognises only the full-screen editor route", () => {
  expect(isLandingPageEditorPath(landingPageEditorHref("page-1"))).toBe(true);
  expect(isLandingPageEditorPath("/landing-pages/page%201/edit/")).toBe(true);
  for (const pathname of ["/landing-pages", "/landing-pages/page-1", "/landing-pages/page-1/operations", "/landing-pages/page-1/edit/extra", "/lp/demo/edit", null, undefined]) {
    expect(isLandingPageEditorPath(pathname)).toBe(false);
  }
});

it("builds the full-screen editor URL with an optional encoded step", () => {
  expect(landingPageEditorHref("page-1")).toBe("/landing-pages/page-1/edit");
  expect(landingPageEditorHref("page-1", "  ")).toBe("/landing-pages/page-1/edit");
  expect(landingPageEditorHref("page-1", null)).toBe("/landing-pages/page-1/edit");
  expect(landingPageEditorHref("page-1", ["a", "b"])).toBe("/landing-pages/page-1/edit");
  expect(landingPageEditorHref("page 1", "step/1")).toBe("/landing-pages/page%201/edit?step=step%2F1");
});
