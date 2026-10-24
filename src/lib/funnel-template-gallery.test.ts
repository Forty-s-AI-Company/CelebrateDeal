import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import path from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { FunnelWebinarExperience, type WebinarExperienceResource } from "@/components/landing-pages/funnel-webinar-experience";
import { createGoalFunnelStepPages } from "./funnel-goal-step-pages";
import { findFunnelContrastIssues } from "./funnel-design-contrast";
import { FUNNEL_CAPABILITIES, parsePageDocument, type FunnelNode } from "./funnel-page-document";
import {
  FUNNEL_TEMPLATE_GALLERY,
  FUNNEL_TEMPLATE_GOALS,
  getFunnelTemplateGalleryItem,
  instantiateFunnelTemplate,
  listFunnelTemplateGallery,
  previewFunnelTemplate,
  FUNNEL_PLACEHOLDER_IMAGE_SRC,
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
    expect(() => instantiateFunnelTemplate("missing")).toThrow("找不到一頁式網站模板");
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

// R3 起模板會調整樣式（字級、間距、配色），但節點 ID、型別與順序必須維持不變：
// 已儲存的頁面、分析與 A/B 設定都以這些 ID 為依據。雜湊以 R3 之前的實作計算。
const TEMPLATE_NODE_ID_HASHES: Record<string, string> = {
  "webinar-broadcast": "93c571e1a2136378fca8757c1344bd9f37c9e5cc01de4d41ae26489264684ce3",
  "webinar-thank-you": "0ca1a349b5fc1982e36ae384a0fb8ea3d320199237d0fd2f6f293429a8b78eb2",
  "webinar-registration": "88e9f41ae0890e3adf007b538ac48a42d5aabb3f768d498558ccb00cfd3bd92d",
  "sell-product-checkout": "dcfbb85a88daae5fc98900cbec0fe80a1672c45b2e21e7a37a9eef9176785dce",
  "sell-simple-checkout": "dcfbb85a88daae5fc98900cbec0fe80a1672c45b2e21e7a37a9eef9176785dce",
  "sell-content-subscription": "f0db8efdcd8fe81f37542d13012f74b2f34b28c0dd937ec6e8d1b295e8d76364",
  "audience-volunteer": "69eb486cc73feda134ae82a4f0df5db05430df2bb95e2454a28d432732bcce2f",
  "audience-charity-event": "69eb486cc73feda134ae82a4f0df5db05430df2bb95e2454a28d432732bcce2f",
  "audience-environment": "69eb486cc73feda134ae82a4f0df5db05430df2bb95e2454a28d432732bcce2f",
  "custom-privacy": "326e011a470c219c8b6ad481321483802ce71d9de435e6ebfa89aba204c37d5c",
  "custom-terms": "326e011a470c219c8b6ad481321483802ce71d9de435e6ebfa89aba204c37d5c",
  "custom-brand-info": "67bc964e06684362b31d46f5c297b54067c7003e9b6bf8ab929084359487582f",
  "audience-course-workbook": "8359d805c3984c8f752223de0444e1adaba3e9f3e9499915513819dd27a19b77",
  "audience-course-consultation": "33391bdf22a392210f1020dd9d9ee80cc969ddbf8be9d3a536c78e4502b2a310",
  "audience-course-lesson": "33391bdf22a392210f1020dd9d9ee80cc969ddbf8be9d3a536c78e4502b2a310",
  "webinar-course-registration": "a22d5a018681e693165a99fbe752eb54116070b4c0c68e09ae49c87a4842c410",
  "webinar-workshop-registration": "caf9714fe0e7237dbc354ff28af52786592348cec9829a56eb50705ca094c5b7",
  "webinar-strategy-registration": "caf9714fe0e7237dbc354ff28af52786592348cec9829a56eb50705ca094c5b7",
};

describe("既有模板相容性", () => {
  it("每個模板的節點 ID、型別與順序與 R3 之前完全相同", () => {
    expect(Object.keys(TEMPLATE_NODE_ID_HASHES).sort()).toEqual(FUNNEL_TEMPLATE_GALLERY.map((template) => template.id).sort());
    for (const [id, expected] of Object.entries(TEMPLATE_NODE_ID_HASHES)) {
      const nodes = flatten(getFunnelTemplateGalleryItem(id)!.build("compat"));
      const actual = createHash("sha256").update(nodes.map((node) => `${node.id}:${node.type}`).join("\n")).digest("hex");
      expect(actual, id).toBe(expected);
    }
  });

  it("模板 ID、分類與預覽資訊維持不變", () => {
    expect(FUNNEL_TEMPLATE_GALLERY.map((template) => `${template.id}|${template.referenceId}|${template.goal}|${template.status}|${template.preview.sectionCount}`)).toMatchInlineSnapshot(`
      [
        "webinar-broadcast|celebratedeal-webinar-broadcast|webinar|available|2",
        "webinar-thank-you|celebratedeal-webinar-thank-you|webinar|available|3",
        "webinar-registration|celebratedeal-webinar-registration|webinar|available|3",
        "sell-product-checkout|25969|sell|limited|2",
        "sell-simple-checkout|25963|sell|limited|2",
        "sell-content-subscription|25957|sell|limited|2",
        "audience-volunteer|26050|audience|available|5",
        "audience-charity-event|26049|audience|available|5",
        "audience-environment|26048|audience|available|5",
        "custom-privacy|3012|custom|available|1",
        "custom-terms|3011|custom|available|1",
        "custom-brand-info|3010|custom|available|4",
        "audience-course-workbook|celebratedeal-course-workbook|audience|available|3",
        "audience-course-consultation|celebratedeal-course-consultation|audience|available|4",
        "audience-course-lesson|celebratedeal-course-lesson|audience|available|4",
        "webinar-course-registration|celebratedeal-webinar-course|webinar|available|4",
        "webinar-workshop-registration|celebratedeal-webinar-workshop|webinar|available|5",
        "webinar-strategy-registration|celebratedeal-webinar-strategy|webinar|available|5",
      ]
    `);
  });
});

describe("模板設計品質（R3）", () => {
  it.each(FUNNEL_TEMPLATE_GALLERY)("$id 的文字、標題與按鈕顏色對比達 WCAG AA", (template) => {
    expect(findFunnelContrastIssues(previewFunnelTemplate(template.id))).toEqual([]);
  });

  it.each(FUNNEL_TEMPLATE_GALLERY)("$id 有清楚的標題層級與手機版區段內距", (template) => {
    const document = previewFunnelTemplate(template.id);
    const nodes = flatten(document.root);
    const levels = nodes.filter((node) => node.type === "headline").map((node) => node.props.level);
    expect(levels.filter((level) => level === "h1").length).toBeLessThanOrEqual(1);
    expect(levels.length).toBeGreaterThan(0);
    expect(document.root.every((section) => typeof section.overrides.mobile?.style?.padding === "string")).toBe(true);
    expect(document.settings.typography).toMatchObject({ headingColor: "#0f172a", bodyLineHeight: 1.7 });
  });

  it("主視覺使用設計過的插圖而不是空白占位圖", () => {
    for (const id of ["audience-volunteer", "audience-charity-event", "audience-environment", "custom-brand-info", "webinar-registration"]) {
      const srcs = flatten(previewFunnelTemplate(id).root).filter((node) => node.type === "image").map((node) => String(node.props.src));
      expect(srcs.length, id).toBeGreaterThan(0);
      expect(srcs.every((src) => src.startsWith("/funnel-illustrations/")), id).toBe(true);
    }
  });

  it("模板中的圖片都是站內檔案且確實存在", () => {
    for (const template of FUNNEL_TEMPLATE_GALLERY) {
      for (const src of flatten(previewFunnelTemplate(template.id).root).filter((node) => node.type === "image").map((node) => String(node.props.src))) {
        expect(src.startsWith("/") && !src.startsWith("//"), src).toBe(true);
        expect(existsSync(path.join(process.cwd(), "public", src)), src).toBe(true);
      }
    }
  });
});

describe("funnel template gallery 預覽與預設圖片", () => {
  it("預覽模板的節點 ID 具決定性，重複建立結果一致", () => {
    for (const template of FUNNEL_TEMPLATE_GALLERY) {
      const ids = (doc: ReturnType<typeof previewFunnelTemplate>) => flatten(doc.root).map((node) => node.id);
      expect(ids(previewFunnelTemplate(template.id))).toEqual(ids(previewFunnelTemplate(template.id)));
    }
  });

  it("套用模板兩次會產生互不重複的節點 ID", () => {
    const ids = (doc: ReturnType<typeof instantiateFunnelTemplate>) => flatten(doc.root).map((node) => node.id);
    const first = ids(instantiateFunnelTemplate("audience-volunteer"));
    const second = ids(instantiateFunnelTemplate("audience-volunteer"));
    expect(new Set(first).size).toBe(first.length);
    expect(first.filter((id) => second.includes(id))).toEqual([]);
  });

  it("預設圖片檔案存在於 public 目錄", () => {
    expect(FUNNEL_PLACEHOLDER_IMAGE_SRC).toBe("/placeholder.svg");
    expect(existsSync(path.join(process.cwd(), "public", FUNNEL_PLACEHOLDER_IMAGE_SRC))).toBe(true);
    const srcs = flatten(instantiateFunnelTemplate("audience-volunteer").root).filter((n) => n.type === "image").map((n) => n.props.src);
    expect(srcs.length).toBeGreaterThan(0);
    for (const src of srcs) expect(existsSync(path.join(process.cwd(), "public", String(src)))).toBe(true);
  });
});
