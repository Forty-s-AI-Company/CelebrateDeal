import { describe, expect, it } from "vitest";

import { FUNNEL_CAPABILITIES, parsePageDocument, type FunnelNode } from "./funnel-page-document";
import {
  FUNNEL_TEMPLATE_GALLERY,
  FUNNEL_TEMPLATE_GOALS,
  getFunnelTemplateGalleryItem,
  instantiateFunnelTemplate,
  listFunnelTemplateGallery,
} from "./funnel-template-gallery";

function flatten(nodes: FunnelNode[]): FunnelNode[] {
  return nodes.flatMap((node) => [node, ...(node.children ? flatten(node.children) : [])]);
}

describe("funnel template gallery", () => {
  it("提供四個 goal 與獨立 Webinar 模板", () => {
    expect(FUNNEL_TEMPLATE_GOALS).toEqual(["sell", "audience", "custom", "webinar"]);
    expect(FUNNEL_TEMPLATE_GALLERY).toHaveLength(12);
    expect(listFunnelTemplateGallery("sell").map((item) => item.category)).toEqual(["商品結帳", "簡潔結帳", "內容訂閱"]);
    expect(listFunnelTemplateGallery("audience").map((item) => item.category)).toEqual(["志工招募", "公益活動", "環境倡議"]);
    expect(listFunnelTemplateGallery("custom").map((item) => item.category)).toEqual(["隱私", "條款", "品牌資訊"]);
    expect(listFunnelTemplateGallery("webinar").map((item) => item.category)).toEqual(["播放會場", "報名完成", "活動報名"]);
  });

  it.each(FUNNEL_TEMPLATE_GALLERY)("$id 可實例化為有效且可編輯的 PageDocument", (template) => {
    const document = instantiateFunnelTemplate(template.id, `page_${template.referenceId}`);
    expect(parsePageDocument(document)).not.toBeNull();
    expect(document.root).toHaveLength(template.preview.sectionCount);
    expect(flatten(document.root).some((node) => ["headline", "text", "form_input", "button"].includes(node.type))).toBe(true);
    expect(template.preview.palette).toHaveLength(3);
    expect(template.description.length).toBeGreaterThan(8);
  });

  it("每次 instantiate 都產生不同 ID 與獨立物件", () => {
    const first = instantiateFunnelTemplate("audience-volunteer");
    const second = instantiateFunnelTemplate("audience-volunteer");
    const firstIds = flatten(first.root).map((node) => node.id);
    const secondIds = flatten(second.root).map((node) => node.id);
    expect(new Set([...firstIds, ...secondIds]).size).toBe(firstIds.length + secondIds.length);
    expect(first.id).not.toBe(second.id);
    expect(first.root[0]).not.toBe(second.root[0]);
    first.root[0]!.props.changed = true;
    expect(second.root[0]!.props).not.toHaveProperty("changed");
  });

  it.each(["sell-product-checkout", "sell-simple-checkout", "sell-content-subscription"])("%s 不會建立假的付款流程", (templateId) => {
    const template = getFunnelTemplateGalleryItem(templateId);
    const document = instantiateFunnelTemplate(templateId);
    const paymentNodes = flatten(document.root).filter((node) => ["offer_price", "payment_method", "payment_button"].includes(node.type));
    expect(template?.status).toBe("limited");
    expect(paymentNodes.length).toBeGreaterThan(0);
    expect(paymentNodes.every((node) => node.props.disabled === true && node.props.capabilityStatus === FUNNEL_CAPABILITIES.payment.status)).toBe(true);
    expect(paymentNodes.every((node) => node.actions.length === 0)).toBe(true);
  });

  it("法務模板明確要求發布前人工審閱，不含 script 或 Raw HTML", () => {
    for (const templateId of ["custom-privacy", "custom-terms"]) {
      const nodes = flatten(instantiateFunnelTemplate(templateId).root);
      expect(nodes.some((node) => node.type === "raw_html")).toBe(false);
      expect(JSON.stringify(nodes)).toContain("發布前");
      expect(JSON.stringify(nodes)).not.toMatch(/<script|javascript:/iu);
    }
  });

  it("Webinar 三階段具備可辨識且用途不同的節點結構", () => {
    const registration = flatten(instantiateFunnelTemplate("webinar-registration").root);
    const thankYou = flatten(instantiateFunnelTemplate("webinar-thank-you").root);
    const broadcast = flatten(instantiateFunnelTemplate("webinar-broadcast").root);
    expect(registration.some((node) => node.type === "form")).toBe(true);
    expect(JSON.stringify(thankYou)).toContain("確認 Email");
    expect(JSON.stringify(broadcast)).toContain("播放入口");
    expect([registration.length, thankYou.length, broadcast.length]).not.toEqual([registration.length, registration.length, registration.length]);
  });

  it("未知模板明確拒絕", () => {
    expect(getFunnelTemplateGalleryItem("missing")).toBeNull();
    expect(() => instantiateFunnelTemplate("missing")).toThrow("找不到 Funnel template");
  });
});
