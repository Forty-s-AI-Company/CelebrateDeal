import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { PricingTableBlock } from "@/components/funnel-blocks/pricing-table-block";
import type { PricingTableBlock as PricingBlock } from "@/lib/funnel-blocks-schema";

function settings(layout: PricingBlock["settings"]["layout"], count: number): PricingBlock["settings"] {
  return { layout, title: "選擇方案", cards: Array.from({ length: count }, (_, index) => ({ id: `plan-${index}`, name: `方案 ${index}`, salePrice: 1_000 + index, currency: "TWD", features: ["權益"], isFeatured: index === 1, badgeText: "熱門首選", showBuyButton: index !== 0, buyButtonLabel: "立即購買", checkoutUrl: `/checkout/${index}`, showMoreInfoButton: index === 0, moreInfoButtonLabel: "了解更多", moreInfoText: "方案說明" })) };
}

describe("pricing table block", () => {
  it.each([["two_column", 2], ["three_column", 3], ["carousel", 4]] as const)("renders %s layout", (layout, count) => {
    const html = renderToStaticMarkup(<PricingTableBlock settings={settings(layout, count)} />);
    expect(html).toContain(`data-layout="${layout}"`);
    expect((html.match(/<article/g) ?? [])).toHaveLength(count);
    if (layout === "carousel") expect(html).toContain("snap-x");
  });

  it("controls buy and more-info buttons independently", () => {
    const html = renderToStaticMarkup(<PricingTableBlock settings={settings("two_column", 2)} />);
    expect((html.match(/立即購買/g) ?? [])).toHaveLength(1);
    expect((html.match(/了解更多/g) ?? [])).toHaveLength(1);
    expect(html).toContain("熱門首選");
  });
});
