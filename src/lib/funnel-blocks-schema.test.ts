import { describe, expect, it } from "vitest";
import { FunnelPageBlocksSchema, parseFunnelPageBlocks } from "@/lib/funnel-blocks-schema";

const pricingBlock = {
  id: "pricing",
  type: "pricing_table" as const,
  sortOrder: 2,
  isVisible: true,
  settings: {
    layout: "two_column" as const,
    cards: ["basic", "pro"].map((id, index) => ({
      id, name: id, salePrice: (index + 1) * 1_000, features: ["完整課程"],
      showBuyButton: true, checkoutUrl: `/checkout/vendor/${id}`,
    })),
  },
};

describe("funnel blocks schema", () => {
  it("parses supported blocks and applies safe defaults", () => {
    const parsed = FunnelPageBlocksSchema.parse([pricingBlock]);
    expect(parsed[0]?.type).toBe("pricing_table");
    if (parsed[0]?.type === "pricing_table") {
      expect(parsed[0].settings.cards[0]).toMatchObject({ currency: "TWD", badgeText: "熱門首選" });
    }
  });

  it("keeps null as the legacy-renderer signal", () => {
    expect(parseFunnelPageBlocks(null)).toBeNull();
  });

  it("rejects unsafe URLs, duplicate ids and incorrect fixed layouts", () => {
    expect(FunnelPageBlocksSchema.safeParse([{ ...pricingBlock, settings: { ...pricingBlock.settings, cards: pricingBlock.settings.cards.slice(0, 1) } }]).success).toBe(false);
    expect(FunnelPageBlocksSchema.safeParse([pricingBlock, pricingBlock]).success).toBe(false);
    expect(FunnelPageBlocksSchema.safeParse([{ ...pricingBlock, settings: { ...pricingBlock.settings, cards: pricingBlock.settings.cards.map((card) => ({ ...card, checkoutUrl: "javascript:alert(1)" })) } }]).success).toBe(false);
  });

  it("rejects a visible action without its required destination", () => {
    const cards = pricingBlock.settings.cards.map((card) => ({ ...card, checkoutUrl: undefined }));
    expect(FunnelPageBlocksSchema.safeParse([{ ...pricingBlock, settings: { ...pricingBlock.settings, cards } }]).success).toBe(false);
  });

  it("requires lead identity fields and an honest price anchor", () => {
    expect(FunnelPageBlocksSchema.safeParse([{ id: "lead", type: "lead_form", sortOrder: 1, isVisible: true, settings: { variant: "inline", fieldKeys: ["phone"] } }]).success).toBe(false);
    const cards = pricingBlock.settings.cards.map((card) => ({ ...card, originalPrice: card.salePrice - 1 }));
    expect(FunnelPageBlocksSchema.safeParse([{ ...pricingBlock, settings: { ...pricingBlock.settings, cards } }]).success).toBe(false);
  });

  it("accepts consultation booking settings and rejects duplicate intake ids", () => {
    const block = { id: "consult", type: "consultation_booking" as const, sortOrder: 1, isVisible: true, settings: { intakeFields: [{ id: "topic", label: "討論主題", type: "textarea" as const, required: false }] } };
    expect(FunnelPageBlocksSchema.safeParse([block]).success).toBe(true);
    expect(FunnelPageBlocksSchema.safeParse([{ ...block, settings: { intakeFields: [{ id: "topic", label: "A", type: "text" as const }, { id: "topic", label: "B", type: "text" as const }] } }]).success).toBe(false);
  });
});
