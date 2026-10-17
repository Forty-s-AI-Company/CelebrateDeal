import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import RootLoading from "./root-loading";

describe("root loading state", () => {
  it("renders an accessible, non-blocking skeleton", () => {
    const html = renderToStaticMarkup(<RootLoading />);

    expect(html).toContain('aria-busy="true"');
    expect(html).toContain('aria-live="polite"');
    expect(html).toContain("正在載入頁面");
    expect(html).toContain("animate-pulse");
  });
});


it("wires loading UI into non-registration page segments only", () => {
  const app = join(process.cwd(), "src/app");
  const excluded = new Set(["form", "lp", "p", "registration-error", "browser-qa", "@checkout"]);
  const hasPage = (path: string): boolean => readdirSync(path, { withFileTypes: true }).some((entry) => entry.isDirectory() ? hasPage(join(path, entry.name)) : entry.name === "page.tsx");
  for (const segment of readdirSync(app, { withFileTypes: true })) {
    if (!segment.isDirectory() || excluded.has(segment.name) || !hasPage(join(app, segment.name))) continue;
    expect(existsSync(join(app, segment.name, "loading.tsx")), segment.name).toBe(true);
  }
  for (const segment of ["form", "lp", "p", "registration-error"]) {
    expect(existsSync(join(app, segment, "loading.tsx"))).toBe(false);
  }
  expect(existsSync(join(app, "loading.tsx"))).toBe(false);
  expect(readFileSync(join(app, "page.tsx"), "utf8")).not.toContain("<Suspense");
});
