import { describe, expect, it } from "vitest";
import { FunnelPageBlocksSchema } from "@/lib/funnel-blocks-schema";
import { FUNNEL_TEMPLATES } from "@/lib/funnel-templates";

describe("funnel template library", () => {
  it("ships exactly three uniquely identified, schema-valid presets", () => {
    expect(FUNNEL_TEMPLATES).toHaveLength(3);
    expect(new Set(FUNNEL_TEMPLATES.map((template) => template.id)).size).toBe(3);
    for (const template of FUNNEL_TEMPLATES) {
      expect(FunnelPageBlocksSchema.safeParse(template.pageBlocks).success).toBe(true);
      expect(template).toMatchObject({ thumbnailUrl: expect.any(String), estimatedCvr: expect.any(String), headline: expect.any(String) });
    }
  });

  it("covers every requested sales archetype", () => {
    expect(FUNNEL_TEMPLATES.map((template) => template.archetype).sort()).toEqual(["high_ticket", "lead_magnet", "summit"]);
  });
});
