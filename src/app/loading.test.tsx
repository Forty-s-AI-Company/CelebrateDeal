import { existsSync, readdirSync } from "node:fs";
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

  // A root or ancestor loading boundary streams the page behind a Suspense
  // fallback that needs JavaScript to reveal, so a native 303 retry would
  // land on an invisible form. Registration entries render complete HTML.
  it("wires loading UI into non-registration page segments only", () => {
    const app = join(process.cwd(), "src/app");
    // The learner portal keeps no segment-level boundary: its locale switch is a
    // same-path server-action redirect, and an extra Suspense boundary there made
    // the portal browser gate flaky in CI.
    const excluded = new Set(["form", "lp", "p", "registration-error", "browser-qa", "@checkout", "portal"]);
    const hasPage = (path: string): boolean => readdirSync(path, { withFileTypes: true }).some((entry) => entry.isDirectory() ? hasPage(join(path, entry.name)) : entry.name === "page.tsx");
    for (const segment of readdirSync(app, { withFileTypes: true })) {
      if (!segment.isDirectory() || excluded.has(segment.name) || !hasPage(join(app, segment.name))) continue;
      expect(existsSync(join(app, segment.name, "loading.tsx")), segment.name).toBe(true);
    }
    const registrationEntries = ["form", "lp", "p", "registration-error"];
    const loadingFiles = (path: string): string[] => readdirSync(path, { withFileTypes: true }).flatMap((entry) => entry.isDirectory() ? loadingFiles(join(path, entry.name)) : entry.name === "loading.tsx" ? [join(path, entry.name)] : []);
    for (const segment of registrationEntries) expect(loadingFiles(join(app, segment)), segment).toEqual([]);
    expect(existsSync(join(app, "loading.tsx"))).toBe(false);
  });
});
