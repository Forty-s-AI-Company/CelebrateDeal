import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ pathname: "/affiliates/commissions" }));
vi.mock("next/navigation", () => ({ usePathname: () => mocks.pathname }));

import { FeatureAccessBoundary } from "./feature-access-boundary";

describe("FeatureAccessBoundary", () => {
  it("shows a graceful settings link instead of disabled module page content", () => {
    const html = renderToStaticMarkup(<FeatureAccessBoundary enabledModules={["funnel_builder"]}><p>private module content</p></FeatureAccessBoundary>);
    expect(html).toContain("該功能目前尚未在此特店啟用");
    expect(html).toContain('href="/settings/features"');
    expect(html).not.toContain("private module content");
  });

  it("keeps enabled module routes available", () => {
    const html = renderToStaticMarkup(<FeatureAccessBoundary enabledModules={["affiliate_program"]}><p>module content</p></FeatureAccessBoundary>);
    expect(html).toContain("module content");
    expect(html).not.toContain("功能尚未啟用");
  });
});
