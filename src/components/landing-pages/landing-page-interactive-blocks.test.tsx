import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { LandingPageCountdown } from "./landing-page-interactive-blocks";

describe("LandingPageCountdown", () => {
  it("renders four stable countdown cells and preserves the CTA link", () => {
    const html = renderToStaticMarkup(<LandingPageCountdown targetAt="2030-01-01T00:00:00+08:00" expiredMessage="已截止" cta={{ label: "立即報名", href: "/form/demo", pageId: "page_1" }} />);
    expect(html).toContain("立即報名");
    expect(html).toContain("/form/demo?lp=page_1");
    expect(html).toContain("grid-cols-4");
  });

  it("hides the countdown content after expiry when configured to hide its CTA", () => {
    const html = renderToStaticMarkup(<LandingPageCountdown targetAt="2020-01-01T00:00:00+08:00" expiredMessage="已截止" expiredAction="hide_cta" cta={{ label: "立即報名", href: "/form/demo" }} />);
    expect(html).toBe("");
  });
});
