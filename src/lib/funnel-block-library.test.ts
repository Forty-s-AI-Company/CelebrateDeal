import { describe, expect, it } from "vitest";

import {
  FUNNEL_BLOCK_CATEGORIES,
  FUNNEL_BLOCK_CATEGORY_METADATA,
  FUNNEL_BLOCK_REGISTRY,
  getFunnelBlocksByCategory,
  instantiateBlock,
} from "@/lib/funnel-block-library";
import { parsePageDocument, type FunnelNode } from "@/lib/funnel-page-document";

function flatten(nodes: FunnelNode[]): FunnelNode[] {
  return nodes.flatMap((item) => [item, ...(item.children ? flatten(item.children) : [])]);
}

describe("Funnel block library", () => {
  it("九個實測分類都有代表 block 與分類 metadata", () => {
    expect(Object.keys(FUNNEL_BLOCK_CATEGORY_METADATA).sort()).toEqual([...FUNNEL_BLOCK_CATEGORIES].sort());
    for (const category of FUNNEL_BLOCK_CATEGORIES) {
      const blocks = getFunnelBlocksByCategory(category);
      expect(blocks.length).toBeGreaterThanOrEqual(1);
      expect(blocks.every((block) => block.category === category)).toBe(true);
      expect(blocks[0]?.variantCount).toBe(FUNNEL_BLOCK_CATEGORY_METADATA[category].variantCount);
    }
  });

  it("每個代表 block 都是可直接插入 root 的 Section > Row > Column 樹", () => {
    for (const template of Object.values(FUNNEL_BLOCK_REGISTRY)) {
      const root = instantiateBlock(template.id);
      expect(root.type).toBe("section");
      expect(root.children?.[0]?.type).toBe("row");
      expect(root.children?.[0]?.children?.[0]?.type).toMatch(/^columns_[234]$/u);
      expect(parsePageDocument({ schemaVersion: 1, id: `page-${template.id}`, name: template.label, root: [root], popups: [], settings: {} })).not.toBeNull();
    }
  });

  it("每次加入都產生唯一 ID，且 block 內節點可獨立選取", () => {
    const first = instantiateBlock("testimonials-three-column");
    const second = instantiateBlock("testimonials-three-column");
    const firstIds = flatten([first]).map((item) => item.id);
    const secondIds = flatten([second]).map((item) => item.id);
    expect(new Set(firstIds).size).toBe(firstIds.length);
    expect(new Set(secondIds).size).toBe(secondIds.length);
    expect(new Set([...firstIds, ...secondIds]).size).toBe(firstIds.length + secondIds.length);
    expect(flatten([first]).filter((item) => item.type === "text").length).toBeGreaterThan(0);
    expect(flatten([first]).filter((item) => item.type === "image").length).toBeGreaterThan(0);
    expect(flatten([first]).filter((item) => item.type === "headline").length).toBeGreaterThan(0);
  });

  it("支付 block 明確標記受限制，不建立假的付款流程", () => {
    const root = instantiateBlock("order-form-two-step");
    const paymentNodes = flatten([root]).filter((item) => ["offer_price", "payment_method", "payment_button"].includes(item.type));
    expect(paymentNodes.length).toBe(3);
    expect(paymentNodes.every((item) => item.props.disabled === true && item.props.capabilityStatus === "limited")).toBe(true);
    expect(paymentNodes.some((item) => item.actions.length > 0)).toBe(false);
  });

  it("未知 template ID 明確失敗", () => {
    expect(() => instantiateBlock("missing-template")).toThrow("找不到 Funnel block");
  });
});
