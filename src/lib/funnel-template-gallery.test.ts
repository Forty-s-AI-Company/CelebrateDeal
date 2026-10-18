import { createHash } from "node:crypto";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { FunnelWebinarExperience, type WebinarExperienceResource } from "@/components/landing-pages/funnel-webinar-experience";
import { createGoalFunnelStepPages } from "./funnel-goal-step-pages";
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
    expect(FUNNEL_TEMPLATE_GALLERY).toHaveLength(18);
    expect(new Set(FUNNEL_TEMPLATE_GALLERY.map(item => item.id)).size).toBe(18);
    expect(listFunnelTemplateGallery("sell").map((item) => item.category)).toEqual(["商品結帳", "簡潔結帳", "內容訂閱"]);
    expect(listFunnelTemplateGallery("audience").map((item) => item.category)).toEqual(["志工招募", "公益活動", "環境倡議", "課程工作表", "課程諮詢", "體驗課程"]);
    expect(listFunnelTemplateGallery("custom").map((item) => item.category)).toEqual(["隱私", "條款", "品牌資訊"]);
    expect(listFunnelTemplateGallery("webinar").map((item) => item.category)).toEqual(["播放會場", "報名完成", "活動報名", "課程說明會", "實作工作坊", "顧問服務銷講"]);
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

  it("依 step type 過濾模板，不把其他用途的模板混入目前步驟", () => {
    expect(listFunnelTemplateGallery("webinar", "webinar_registration_page").map((item) => item.id)).toEqual(["webinar-registration", "webinar-course-registration", "webinar-workshop-registration", "webinar-strategy-registration"]);
    expect(listFunnelTemplateGallery("webinar", "webinar_broadcast_page").map((item) => item.id)).toEqual(["webinar-broadcast"]);
    expect(listFunnelTemplateGallery("sell", "thank_you_page")).toEqual([]);
    expect(listFunnelTemplateGallery("custom", "info_page").map((item) => item.id)).toEqual(["custom-privacy", "custom-terms", "custom-brand-info"]);
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

  it.each([
    "audience-course-workbook", "audience-course-consultation", "audience-course-lesson",
  ])("%s 提供真實表單動作且沒有假的購買、成效或限時宣稱", id => {
    const nodes = flatten(instantiateFunnelTemplate(id).root);
    expect(new Set(nodes.map(n => n.id)).size).toBe(nodes.length);
    const forms = nodes.filter(n => n.type === "form");
    expect(forms).toHaveLength(1);
    const submit = nodes.flatMap(n => n.actions).filter(a => a.type === "submit_form");
    expect(submit).toEqual([{ type: "submit_form", formId: forms[0]!.id }]);
    expect(nodes.filter(n => n.type === "form_input").map(n => n.props.inputType)).toEqual(["text", "email"]);
    expect(nodes.filter(n => n.type === "headline" && n.props.level === "h1")).toHaveLength(1);
    expect(nodes.some(n => ["payment_button", "countdown_timer", "raw_html"].includes(n.type))).toBe(false);
    expect(JSON.stringify(nodes)).not.toMatch(/保證獲利|保證成交|最後\s*\d+\s*席|限時倒數|<script|javascript:/u);
  });

  it("新報名模板只出現在報名步驟，舊的完成頁與播放會場不變", () => {
    expect(listFunnelTemplateGallery("webinar", "webinar_thank_you_page").map(t => t.id)).toEqual(["webinar-thank-you"]);
    expect(listFunnelTemplateGallery("audience", "webinar_registration_page")).toEqual([]);
    expect(listFunnelTemplateGallery("webinar", "opt_in_page")).toEqual([]);
    expect(listFunnelTemplateGallery("audience", "opt_in_page").filter(t => t.id.startsWith("audience-course-"))).toHaveLength(3);
    for (const step of ["inline_form", "popup_form", "link_in_bio"] as const) {
      expect(listFunnelTemplateGallery("audience", step).map(t => t.id)).toEqual(["audience-volunteer", "audience-charity-event", "audience-environment"]);
    }
    for (const id of ["webinar-course-registration", "webinar-workshop-registration", "webinar-strategy-registration"]) {
      const nodes = flatten(instantiateFunnelTemplate(id).root);
      expect(nodes.some(n => n.type === "form")).toBe(false);
      expect(nodes.flatMap(n => n.actions)).toEqual([{ type: "open_url", href: "#webinar-registration", newTab: false }]);
      expect(JSON.stringify(nodes)).not.toMatch(/(?:LINE|SMS|簡訊|結算|自動寄送|自動提醒|會寄到|將寄到|保證收到)/u);
    }
    for (const id of ["audience-course-workbook", "audience-course-consultation", "audience-course-lesson"]) {
      expect(JSON.stringify(instantiateFunnelTemplate(id).root)).not.toContain("報名狀態");
    }
  });

  it("公開 Webinar 元件不承諾尚未開放的外部提醒或結算送達", () => {
    const webinar = createGoalFunnelStepPages({ id: "wp09_flow", name: "Webinar", goal: "webinar", domain: "wp09-webinar" })!;
    webinar.flow.webinar = { timezone: "Asia/Taipei", startsAt: "2030-01-01T01:00:00.000Z", endsAt: "2030-01-01T02:00:00.000Z", replayEndsAt: "2030-01-02T02:00:00.000Z" };
    const resource: WebinarExperienceResource = {
      live: { id: "wp09_live", slug: "wp09-live", videoId: "wp09_video", videoTitle: "合成影片" },
      form: { id: "wp09_form", fields: [{ key: "email", label: "Email", type: "email", required: true }], submitLabel: "送出報名", successMessage: "待確認" },
    };
    for (const stepId of ["webinar_registration", "webinar_thank_you", "webinar_broadcast"] as const) {
      const html = renderToStaticMarkup(createElement(FunnelWebinarExperience, { state: webinar, slug: "wp09-webinar", stepId, resource }));
      expect(html).not.toMatch(/(?:LINE|SMS|簡訊|自動寄送|自動提醒|結算|保證收到|保證送達)/u);
    }
  });
});

// 在新增課程銷講模板之前，以 master 的實作計算出的內容雜湊；任何既有模板的輸出改變都會讓這裡失敗。
const LEGACY_TEMPLATE_HASHES: Record<string, string> = {
  "webinar-broadcast": "784a2b7cd39e1286bdd14a185601bb479281a186d190177ec703e8fd6ad0f769",
  "webinar-thank-you": "f28e222e617a0783ed1321fc87d4f019398aafe9c6ba3c4847a7f292e8be8536",
  "webinar-registration": "196db99560f5a613556d6a8ebbdd7e53cb176f9c4df1a4a4a4756b322e9d7a76",
  "sell-product-checkout": "87c1ac5faf610440b42afd7ae52e7e2f3c15bdf25970de12a1be40bfae8e61ff",
  "sell-simple-checkout": "08c4ce2d8804802a0fb0018d648a0b335c9951ee53b59a61f7b39c78f2871c53",
  "sell-content-subscription": "78775c66c4f9d976875a569a1796d6cccf705df50581dfcc473c7a754734a944",
  "audience-volunteer": "23dee2ade5e0b6f377439c8b1c4db510a166338a5fe484ffd23b60a1190eae1d",
  "audience-charity-event": "6cd6df2f9debacf17157f16b14057b25de1ff6968a1bcaab2d2456b1218a2237",
  "audience-environment": "9f7f3499298d889ae492bb07767c77a4b8d20dac4976eb5fbb014e0b4c07d671",
  "custom-privacy": "6f7f5966cbc33b2c360b7cbe12299e28b16f44320e61995b1d5ac019dbcdeb41",
  "custom-terms": "b1539a67757987e63dcf6886c17a6eadd19eff73ad77a9d0b4f707ef43a81234",
  "custom-brand-info": "ae58b0b34f72de1f6285a9c76317c454471bc7c85c16ea42f886b4753d05586c",
};

describe("既有模板相容性", () => {
  it("原本 12 個模板的中繼資料與節點輸出與新增前完全相同", () => {
    for (const [id, expected] of Object.entries(LEGACY_TEMPLATE_HASHES)) {
      const template = getFunnelTemplateGalleryItem(id)!;
      const { build, ...meta } = template;
      const actual = createHash("sha256").update(JSON.stringify({ meta, nodes: build("compat") })).digest("hex");
      expect(actual, id).toBe(expected);
    }
  });
});
