import { describe, expect, it } from "vitest";
import { findFunnelContrastIssues } from "./funnel-design-contrast";
import { createFunnelFlow, FUNNEL_STEP_TYPES } from "./funnel-flow";
import { createGoalFunnelStepPages } from "./funnel-goal-step-pages";
import type { FunnelNode } from "./funnel-page-document";
import { listFunnelTemplateCatalog } from "./funnel-template-catalog";
import { FUNCTIONAL_PAGE_TEMPLATES, FUNCTIONAL_PAGE_TOKENS } from "./funnel-template-functional-pages";
import {
  FUNNEL_TEMPLATE_GALLERY,
  getFunnelTemplateGalleryItem,
  instantiateFunnelTemplate,
  listFunnelTemplateGallery,
  previewFunnelTemplate,
} from "./funnel-template-gallery";
import { WEBINAR_TEMPLATES } from "./funnel-templates/webinar";
import { LEADS_TEMPLATES } from "./funnel-templates/leads";
import { SALES_TEMPLATES } from "./funnel-templates/sales";

const flatten = (nodes: FunnelNode[]): FunnelNode[] => nodes.flatMap((node) => [node, ...(node.children ? flatten(node.children) : [])]);
const signature = (id: string) => flatten(getFunnelTemplateGalleryItem(id)!.build("snapshot")).map((node) => `${node.id}:${node.type}`);
const strings = (value: unknown): string[] => (typeof value === "string" ? [value] : Array.isArray(value) ? value.flatMap(strings) : value && typeof value === "object" ? Object.values(value).flatMap(strings) : []);

const RETIRED: ReadonlyArray<[string, string]> = [
  ["webinar-registration", "webinar-saas-split"],
  ["webinar-course-registration", "webinar-saas-split"],
  ["webinar-workshop-registration", "webinar-design-workshop"],
  ["webinar-strategy-registration", "webinar-saas-split"],
  ["custom-brand-info", "custom-luxury-course"],
  ["webinar-thank-you", "webinar-thank-you-v2"],
  ["webinar-broadcast", "webinar-broadcast-v2"],
  ["custom-privacy", "custom-privacy-v2"],
  ["custom-terms", "custom-terms-v2"],
  // 名單頁與結帳／訂閱舊範本（docs/product/funnel-templates）。
  ["audience-volunteer", "leads-checklist-minimal"],
  ["audience-charity-event", "leads-newsletter-editorial"],
  ["audience-environment", "leads-newsletter-editorial"],
  ["audience-course-workbook", "leads-toolkit-freelance"],
  ["audience-course-consultation", "leads-consult-interior"],
  ["audience-course-lesson", "leads-email-course-photo"],
  ["sell-product-checkout", "sales-product-coffee"],
  ["sell-simple-checkout", "sales-digital-planner"],
  ["sell-content-subscription", "sales-saas-plans"],
];

describe("功能頁 v2 的統一設計", () => {
  it.each(FUNCTIONAL_PAGE_TEMPLATES)("$id 可實例化，且沒有 raw_html、寫死日期或外部圖片", (page) => {
    const document = instantiateFunnelTemplate(page.id);
    const nodes = flatten(document.root);
    expect(document.root).toHaveLength(page.preview.sectionCount);
    expect(nodes.some((node) => node.type === "raw_html")).toBe(false);
    expect(nodes.filter((node) => node.type === "headline" && node.props.level === "h1")).toHaveLength(1);
    const text = strings(nodes.map((node) => node.props)).join("\n");
    expect(text).not.toMatch(/20\d\d\s*[年/-]/u);
    expect(text).not.toMatch(/<script|javascript:|https?:\/\//iu);
    expect(findFunnelContrastIssues(previewFunnelTemplate(page.id))).toEqual([]);
  });

  it.each(FUNCTIONAL_PAGE_TEMPLATES)("$id 套用統一的設計 token，每個區段都有手機內距", (page) => {
    const document = previewFunnelTemplate(page.id);
    expect(document.settings.background.color).toBe(FUNCTIONAL_PAGE_TOKENS.pageBackground);
    expect(document.settings.typography).toMatchObject({
      headingFont: "sans-tc", bodyFont: "sans-tc", textColor: "#334155", headingColor: "#0f172a", linkColor: "#1d4ed8",
    });
    const maxWidth = page.goal === "custom" ? 720 : 960;
    for (const section of document.root) {
      expect(section.type).toBe("section");
      expect(typeof section.overrides.mobile?.style?.padding).toBe("string");
      expect(section.children?.[0]?.props.maxWidth).toBe(maxWidth);
    }
  });

  it.each(FUNCTIONAL_PAGE_TEMPLATES)("$id 的節點 id、型別與順序固定", (page) => {
    expect(signature(page.id)).toMatchSnapshot();
  });

  it("感謝頁：成功狀態、三步驟、加入行事曆與活動資訊", () => {
    const nodes = flatten(previewFunnelTemplate("webinar-thank-you-v2").root);
    const steps = nodes.find((node) => node.type === "icon_list" && node.props.numbered === true);
    expect(steps?.props.items).toHaveLength(3);
    expect(nodes.some((node) => node.type === "add_to_calendar")).toBe(true);
    expect(nodes.some((node) => node.type === "event_facts")).toBe(true);
    expect(nodes.some((node) => node.type === "speaker_profiles" && node.props.layout === "featured" && node.props.size === "small")).toBe(true);
    expect(strings(nodes.map((node) => node.props)).join("\n")).toContain("{{webinar.title}}");
  });

  it("播放頁：不含影片節點，並提供摘要、講者卡與直播常見問題", () => {
    const nodes = flatten(previewFunnelTemplate("webinar-broadcast-v2").root);
    expect(nodes.some((node) => ["video", "raw_html", "media_frame", "video_gallery"].includes(node.type))).toBe(false);
    expect(nodes.some((node) => node.type === "icon_list")).toBe(true);
    expect(nodes.some((node) => node.type === "speaker_profiles")).toBe(true);
    expect(nodes.find((node) => node.type === "faq")?.props.items).toHaveLength(4);
    expect(nodes.some((node) => node.type === "headline" && node.props.text === "直播常見問題")).toBe(true);
  });

  it.each(["custom-privacy-v2", "custom-terms-v2"])("%s：頁首目錄的每個錨點都指向一個章節", (id) => {
    const nodes = flatten(previewFunnelTemplate(id).root);
    const menu = nodes.find((node) => node.type === "menu")!;
    const items = menu.props.items as Array<{ label: string; href: string }>;
    const anchors = new Set(nodes.map((node) => node.attributes.id).filter(Boolean));
    expect(items.length).toBeGreaterThanOrEqual(5);
    for (const item of items) expect(anchors.has(item.href.slice(1)), item.href).toBe(true);
    const callout = nodes.find((node) => node.type === "callout")!;
    expect(String(callout.props.title)).toContain("請依實際營運內容與法律意見修改");
    expect(strings(nodes.map((node) => node.props)).join("\n")).toContain("最後更新日期");
    expect(nodes.filter((node) => node.type === "headline" && node.props.level === "h2")).toHaveLength(items.length);
  });
});

describe("舊範本退役", () => {
  it.each(RETIRED)("%s 已退役但仍可解析與實例化，替代品可用", (id, replacedBy) => {
    const item = getFunnelTemplateGalleryItem(id)!;
    expect(item.retired).toEqual({ since: "2026-10-29", replacedBy });
    const replacement = getFunnelTemplateGalleryItem(replacedBy)!;
    expect(replacement.retired).toBeUndefined();
    expect(instantiateFunnelTemplate(id).root.length).toBeGreaterThan(0);
    expect(previewFunnelTemplate(id).root).toHaveLength(item.preview.sectionCount);
  });

  it("退役的 id 不在任何列表、步驟選單或範本庫中", () => {
    const retiredIds = new Set(RETIRED.map(([id]) => id));
    expect(FUNNEL_TEMPLATE_GALLERY.filter((item) => item.retired).map((item) => item.id).sort()).toEqual([...retiredIds].sort());
    const offered = new Set<string>();
    for (const goal of ["sell", "audience", "custom", "webinar"] as const) {
      for (const item of listFunnelTemplateGallery(goal)) offered.add(item.id);
      for (const type of FUNNEL_STEP_TYPES) for (const item of listFunnelTemplateGallery(goal, type)) offered.add(item.id);
    }
    for (const item of listFunnelTemplateGallery()) offered.add(item.id);
    for (const id of retiredIds) expect(offered.has(id), id).toBe(false);
    const catalog = listFunnelTemplateCatalog().map((entry) => entry.id);
    for (const id of retiredIds) expect(catalog).not.toContain(id);
  });

  it("20 個新範本與黑金範本不受影響，00 範例仍隱藏", () => {
    for (const template of WEBINAR_TEMPLATES) {
      const item = getFunnelTemplateGalleryItem(template.id)!;
      expect(item.retired).toBeUndefined();
      expect(Boolean(item.hidden)).toBe(Boolean(template.hidden));
    }
    expect(WEBINAR_TEMPLATES.filter((template) => !template.hidden)).toHaveLength(20);
    expect(getFunnelTemplateGalleryItem("custom-luxury-course")).toMatchObject({ goal: "custom" });
    expect(getFunnelTemplateGalleryItem("custom-luxury-course")!.retired).toBeUndefined();
    expect(listFunnelTemplateGallery("custom").map((item) => item.id)).toContain("custom-luxury-course");
  });
});

describe("新預設值", () => {
  it("Webinar 漏斗的預設步驟指向新報名頁與 v2 感謝頁、播放頁", () => {
    const flow = createFunnelFlow({ id: "migration_flow", name: "Webinar", goal: "webinar", domain: "migration-webinar" })!;
    const byType = Object.fromEntries(flow.steps.map((step) => [step.type, step.template.templateId]));
    expect(byType).toMatchObject({
      webinar_registration_page: "webinar-saas-split",
      webinar_thank_you_page: "webinar-thank-you-v2",
      webinar_broadcast_page: "webinar-broadcast-v2",
    });
  });

  it("新建 Webinar 漏斗的三個頁面都由新範本實例化", () => {
    const state = createGoalFunnelStepPages({ id: "migration_funnel", name: "Webinar", goal: "webinar", domain: "migration-webinar" })!;
    const hero = flatten(state.pages["webinar_registration"]!.root);
    expect(hero.some((node) => node.type === "form")).toBe(true);
    expect(hero.some((node) => node.id.startsWith("gallery_webinar-saas-split_"))).toBe(true);
    expect(flatten(state.pages["webinar_thank_you"]!.root).some((node) => node.id.startsWith("gallery_webinar-thank-you-v2_"))).toBe(true);
    expect(flatten(state.pages["webinar_broadcast"]!.root).some((node) => node.id.startsWith("gallery_webinar-broadcast-v2_"))).toBe(true);
  });
});

describe("步驟選單：每個步驟都有範本可選", () => {
  const ids = (goal: Parameters<typeof listFunnelTemplateGallery>[0], type: Parameters<typeof listFunnelTemplateGallery>[1]) => listFunnelTemplateGallery(goal, type).map((item) => item.id);
  const leads = LEADS_TEMPLATES.filter((template) => !template.hidden).map((template) => template.id);
  const sales = SALES_TEMPLATES.filter((template) => !template.hidden).map((template) => template.id);

  it("名單目標：內容步驟列出名單頁，名單感謝頁步驟列出對應感謝頁", () => {
    expect(leads).toHaveLength(8);
    for (const type of ["opt_in_page", "inline_form", "popup_form", "link_in_bio"] as const) expect(ids("audience", type)).toEqual(leads);
    expect(ids("audience", "opt_in_thank_you_page")).toEqual(leads.map((id) => `${id}-thanks`));
  });

  it("銷售目標：銷售與訂單步驟列出銷售頁，感謝頁步驟列出訂單感謝頁", () => {
    expect(sales).toHaveLength(8);
    for (const type of ["order_form", "sales_page", "upsell", "downsell"] as const) expect(ids("sell", type)).toEqual(sales);
    expect(ids("sell", "thank_you_page")).toEqual(sales.map((id) => `${id}-thanks`));
  });

  it("其他目標的步驟仍有範本", () => {
    for (const type of ["webinar_registration_page", "webinar_thank_you_page", "webinar_broadcast_page"] as const) {
      expect(listFunnelTemplateGallery("webinar", type).length).toBeGreaterThan(0);
    }
    for (const type of ["info_page", "contact_us_page"] as const) expect(listFunnelTemplateGallery("custom", type).length).toBeGreaterThan(0);
  });

  it("感謝頁只在感謝頁步驟，不在範本庫瀏覽", () => {
    const catalog = listFunnelTemplateCatalog().map((entry) => entry.id);
    for (const id of [...leads, ...sales]) {
      const thanks = getFunnelTemplateGalleryItem(`${id}-thanks`)!;
      expect(thanks.libraryHidden).toBe(true);
      expect(catalog).not.toContain(thanks.id);
      expect(catalog).toContain(id);
      expect(instantiateFunnelTemplate(thanks.id).root.length).toBeGreaterThan(0);
    }
  });

  it("v2 功能頁只出現在對應步驟", () => {
    expect(listFunnelTemplateGallery("webinar", "webinar_thank_you_page").map((item) => item.id)).toEqual(["webinar-thank-you-v2"]);
    expect(listFunnelTemplateGallery("webinar", "webinar_broadcast_page").map((item) => item.id)).toEqual(["webinar-broadcast-v2"]);
    expect(listFunnelTemplateGallery("webinar", "webinar_registration_page").map((item) => item.id)).not.toContain("webinar-thank-you-v2");
    expect(listFunnelTemplateGallery("custom", "info_page").map((item) => item.id)).toEqual(expect.arrayContaining(["custom-privacy-v2", "custom-terms-v2"]));
  });
});
