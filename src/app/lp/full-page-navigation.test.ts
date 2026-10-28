import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { relativeSource, SRC_ROOT, sourceFiles, walkImports } from "@/test/import-graph";

/**
 * /lp 會載入商家的 GA4／Meta Pixel。從 /lp 文件樹（與從那裡可達的政策頁、404）
 * 連往平台其他路由時必須整頁載入，不可用 next/link 或 router 做 client 導覽，
 * 否則商家腳本會留在平台頁（甚至後台）繼續送 page_view。
 */
describe("public funnel pages leave through full page loads", () => {
  it("no module reachable from /lp, the policy pages or the root 404 uses client-side navigation", () => {
    const entries = [...sourceFiles(path.join(SRC_ROOT, "app/lp")), ...sourceFiles(path.join(SRC_ROOT, "app/policies")), path.join(SRC_ROOT, "app/not-found.tsx")];
    const graph = walkImports(entries);
    const reachable = [...graph.keys()].map(relativeSource);
    // Sanity: the walk really covers the public renderer, the disclosure, the checkout form and the policy shell.
    for (const expected of ["components/landing-pages/funnel-page-document-renderer.tsx", "components/landing-pages/funnel-custom-code-disclosure.tsx", "components/commerce-checkout-form.tsx", "components/public-policy.tsx"]) {
      expect(reachable).toContain(expected);
    }
    const clientNavigation = [...graph].flatMap(([file, specifiers]) => [
      ...(specifiers.includes("next/link") ? [`${relativeSource(file)} imports next/link`] : []),
      ...(/\brouter\.(push|replace|prefetch)\(/u.test(fs.readFileSync(file, "utf8")) ? [`${relativeSource(file)} uses router navigation`] : []),
    ]);
    expect(clientNavigation).toEqual([]);
  }, 60_000);
});

describe("custom code emergency switch reaches every route that renders custom code", () => {
  it("each non-QA route that can render the custom code iframe is wrapped in the server runtime", () => {
    const target = path.join(SRC_ROOT, "components/landing-pages/sandboxed-html.tsx");
    const routes = sourceFiles(path.join(SRC_ROOT, "app"), /^(page|layout)\.tsx$/u).filter((file) => !relativeSource(file).startsWith("app/browser-qa/"));
    const rendering = routes.filter((route) => walkImports([route]).has(target)).map(relativeSource).sort();
    expect(rendering).toEqual([
      "app/(app)/landing-pages/[id]/operations/layout.tsx",
      "app/(app)/landing-pages/[id]/operations/page.tsx",
      "app/(app)/landing-pages/templates/layout.tsx",
      "app/(app)/landing-pages/templates/page.tsx",
      "app/(editor)/landing-pages/[id]/edit/layout.tsx",
      "app/(editor)/landing-pages/[id]/edit/page.tsx",
      "app/lp/[slug]/[stepPath]/page.tsx",
      "app/lp/[slug]/layout.tsx",
      "app/lp/[slug]/page.tsx",
    ]);
    // Each of those routes sits under a layout that provides the server runtime.
    for (const route of ["app/(app)/landing-pages/[id]/operations/layout.tsx", "app/(app)/landing-pages/templates/layout.tsx", "app/(editor)/landing-pages/[id]/edit/layout.tsx", "app/lp/[slug]/layout.tsx"]) {
      expect(fs.readFileSync(path.join(SRC_ROOT, route), "utf8")).toMatch(/<FunnelCustomCodeRuntime[\s>]/u);
    }
  }, 60_000);
});
