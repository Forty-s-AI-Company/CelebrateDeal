import { existsSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import {
  FUNNEL_BLOCK_CATEGORIES,
  FUNNEL_BLOCK_CATEGORY_METADATA,
  FUNNEL_BLOCK_REGISTRY,
  getFunnelBlocksByCategory,
  instantiateBlock,
  listFunnelBlockCategories,
  previewBlockInstanceId,
  previewFunnelBlockDocument,
} from "@/lib/funnel-block-library";
import { findFunnelContrastIssues } from "@/lib/funnel-design-contrast";
import { createEmptyPageDocument, parsePageDocument, type FunnelNode } from "@/lib/funnel-page-document";

function flatten(nodes: FunnelNode[]): FunnelNode[] {
  return nodes.flatMap((item) => [item, ...(item.children ? flatten(item.children) : [])]);
}

const MINIMUM_VARIANTS = { opt_in_forms: 3, welcome: 3, features: 3, testimonials: 2, price_plans: 2, page_headers: 2, page_footers: 2, team_presentation: 2 } as const;

describe("Funnel block library", () => {
  it("分類名稱對齊編輯器的版型區塊清單，且只列出有區塊的分類", () => {
    expect(Object.keys(FUNNEL_BLOCK_CATEGORY_METADATA).sort()).toEqual([...FUNNEL_BLOCK_CATEGORIES].sort());
    expect(Object.fromEntries(FUNNEL_BLOCK_CATEGORIES.map((id) => [id, FUNNEL_BLOCK_CATEGORY_METADATA[id].label]))).toEqual({
      order_forms: "訂購表單", opt_in_forms: "名單表單", features: "特色介紹", page_footers: "頁尾", team_presentation: "團隊介紹",
      welcome: "歡迎區塊", price_plans: "方案價格", page_headers: "頁首", testimonials: "客戶見證",
      social_proof: "信任背書", content_showcase: "內容展示", call_to_action: "行動呼籲", webinar_sections: "講座報名",
    });
    const listed = listFunnelBlockCategories();
    expect(listed.every((category) => category.variantCount > 0)).toBe(true);
    expect(listed.map((category) => category.id)).toEqual(FUNNEL_BLOCK_CATEGORIES.filter((id) => getFunnelBlocksByCategory(id).length > 0));
  });

  it("每個顯示的分類至少兩款，主要分類達到目標數量", () => {
    for (const category of listFunnelBlockCategories()) {
      const blocks = getFunnelBlocksByCategory(category.id);
      expect(blocks.length, category.id).toBeGreaterThanOrEqual(2);
      expect(category.variantCount).toBe(blocks.length);
      expect(blocks.every((block) => block.category === category.id && block.variantCount === blocks.length)).toBe(true);
    }
    for (const [category, minimum] of Object.entries(MINIMUM_VARIANTS)) {
      expect(getFunnelBlocksByCategory(category as keyof typeof MINIMUM_VARIANTS).length, category).toBeGreaterThanOrEqual(minimum);
    }
  });

  it.each(Object.values(FUNNEL_BLOCK_REGISTRY))("$id 展開為可編輯的 Section › Row › 子元素並通過驗證", (template) => {
    const root = instantiateBlock(template.id);
    // A navigation bar block is a page-level element (it must sit at the root to stay sticky).
    if (root.type === "nav_bar") {
      expect(template.category).toBe("page_headers");
      expect(parsePageDocument({ ...createEmptyPageDocument(`page-${template.id}`), root: [root] })).not.toBeNull();
      return;
    }
    expect(root.type).toBe("section");
    expect(root.children?.[0]?.type).toBe("row");
    expect(root.children?.[0]?.children?.length).toBeGreaterThan(0);
    const nodes = flatten([root]);
    // Every block carries copy the merchant edits: plain text, or a showcase element whose items hold the text.
    expect(nodes.some((item) => ["headline", "text", "section_title", "stats", "logo_strip", "callout", "value_stack"].includes(item.type))).toBe(true);
    expect(parsePageDocument({ ...createEmptyPageDocument(`page-${template.id}`), root: [root] })).not.toBeNull();
    // 響應式：區段在手機版有自己的內距覆寫。
    expect(root.overrides.mobile?.style?.padding).toBeDefined();
    expect(template.label.length).toBeGreaterThan(2);
    expect(template.description.length).toBeGreaterThan(5);
  });

  it("區塊只使用站內圖片，且檔案確實存在", () => {
    for (const template of Object.values(FUNNEL_BLOCK_REGISTRY)) {
      for (const item of flatten([instantiateBlock(template.id)]).filter((node) => node.type === "image")) {
        const src = String(item.props.src);
        expect(src.startsWith("/") && !src.startsWith("//"), `${template.id}: ${src}`).toBe(true);
        expect(existsSync(path.join(process.cwd(), "public", src)), src).toBe(true);
      }
    }
  });

  it("每次加入都產生唯一 ID", () => {
    const testimonialId = getFunnelBlocksByCategory("testimonials")[0]!.id;
    const firstIds = flatten([instantiateBlock(testimonialId)]).map((item) => item.id);
    const secondIds = flatten([instantiateBlock(testimonialId)]).map((item) => item.id);
    expect(new Set(firstIds).size).toBe(firstIds.length);
    expect(new Set([...firstIds, ...secondIds]).size).toBe(firstIds.length + secondIds.length);
  });

  it("縮圖文件的 ID 只由模板 ID 決定（避免 hydration 不一致）", () => {
    for (const template of Object.values(FUNNEL_BLOCK_REGISTRY)) {
      const first = previewFunnelBlockDocument(template.id);
      const second = previewFunnelBlockDocument(template.id);
      expect(JSON.stringify(first)).toBe(JSON.stringify(second));
      const ids = flatten(first.root).map((item) => item.id);
      expect(ids.every((id) => id.startsWith(previewBlockInstanceId(template.id)))).toBe(true);
      expect(new Set(ids).size).toBe(ids.length);
    }
  });

  it("縮圖沿用目前頁面的設定", () => {
    const settings = createEmptyPageDocument().settings;
    settings.typography.headingFont = "serif-tc";
    const document = previewFunnelBlockDocument("welcome-split", settings);
    expect(document.settings.typography.headingFont).toBe("serif-tc");
    expect(() => previewFunnelBlockDocument("missing")).toThrow("找不到一頁式網站區塊");
  });

  it("文字、標題與按鈕的顏色對比皆達 WCAG AA（4.5:1）", () => {
    for (const template of Object.values(FUNNEL_BLOCK_REGISTRY)) {
      expect(findFunnelContrastIssues(previewFunnelBlockDocument(template.id)), template.id).toEqual([]);
    }
  });

  it("支付 block 明確標記受限制，不建立假的付款流程", () => {
    for (const template of getFunnelBlocksByCategory("order_forms")) {
      expect(template.capability?.status).toBe("limited");
      const paymentNodes = flatten([instantiateBlock(template.id)]).filter((item) => ["offer_price", "payment_method", "payment_button"].includes(item.type));
      expect(paymentNodes.length).toBe(3);
      expect(paymentNodes.every((item) => item.props.disabled === true && item.props.capabilityStatus === "limited")).toBe(true);
      expect(paymentNodes.some((item) => item.actions.length > 0)).toBe(false);
    }
  });

  it("名單表單的送出按鈕綁定同一個表單", () => {
    for (const template of getFunnelBlocksByCategory("opt_in_forms")) {
      const nodes = flatten([instantiateBlock(template.id)]);
      const form = nodes.find((item) => item.type === "form")!;
      expect(form, template.id).toBeDefined();
      expect(form.children?.flatMap((child) => child.actions)).toEqual([{ type: "submit_form", formId: form.id }]);
      expect(form.children?.some((child) => child.type === "form_input" && child.props.inputType === "email")).toBe(true);
    }
  });

  it("未知 template ID 明確失敗", () => {
    expect(() => instantiateBlock("missing-template")).toThrow("找不到一頁式網站區塊");
  });
});
