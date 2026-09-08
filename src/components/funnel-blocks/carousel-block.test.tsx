import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { CarouselBlock } from "@/components/funnel-blocks/carousel-block";

describe("carousel block", () => {
  it("renders lazy slides, dots, arrows and accessible controls", () => {
    const html = renderToStaticMarkup(<CarouselBlock settings={{ ariaLabel: "作品輪播", slides: [{ id: "one", imageUrl: "/one.jpg", imageAlt: "第一張", title: "作品一" }, { id: "two", imageUrl: "/two.jpg", imageAlt: "第二張" }], autoPlay: true, intervalMs: 3000, showDots: true, showArrows: true }} />);
    expect(html).toContain('aria-roledescription="carousel"');
    expect(html).toContain('loading="lazy"');
    expect(html).toContain('aria-label="上一張"');
    expect(html).toContain('aria-label="下一張"');
    expect(html).toContain("前往第 2 張");
  });
});
