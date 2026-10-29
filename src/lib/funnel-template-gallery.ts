import {
  FUNNEL_CAPABILITIES,
  createEmptyPageDocument,
  parsePageDocument,
  type FunnelNode,
  type FunnelNodeAction,
  type FunnelNodeType,
  type PageDocument,
} from "@/lib/funnel-page-document";
import type { FunnelStepType } from "@/lib/funnel-flow";
import { FUNNEL_ILLUSTRATIONS } from "@/lib/funnel-block-library";
import { buildLuxuryCourseTemplate, LUXURY_COURSE_THEME } from "@/lib/funnel-template-luxury-course";
import { WEBINAR_TEMPLATES, type WebinarTemplateDefinition } from "@/lib/funnel-templates/webinar";
import { FUNCTIONAL_PAGE_TEMPLATES, functionalPageGalleryItem } from "@/lib/funnel-template-functional-pages";
import { LEADS_TEMPLATES } from "@/lib/funnel-templates/leads";
import { SALES_TEMPLATES } from "@/lib/funnel-templates/sales";
import { buildConversionThankYou, conversionThankYouTheme } from "@/lib/funnel-templates/conversion/thank-you";
import type { ConversionTemplateDefinition } from "@/lib/funnel-templates/conversion/types";

export const FUNNEL_TEMPLATE_GOALS = ["sell", "audience", "custom", "webinar"] as const;
export type FunnelTemplateGoal = (typeof FUNNEL_TEMPLATE_GOALS)[number];
export type FunnelTemplateStatus = "available" | "limited";

export type FunnelTemplatePreviewSnapshot = {
  eyebrow: string;
  headline: string;
  summary: string;
  palette: readonly [string, string, string];
  sectionCount: number;
};

export type FunnelTemplateGalleryItem = {
  id: string;
  referenceId: string;
  goal: FunnelTemplateGoal;
  category: string;
  name: string;
  description: string;
  status: FunnelTemplateStatus;
  statusReason: string;
  preview: FunnelTemplatePreviewSnapshot;
  build: (prefix: string) => FunnelNode[];
  /** Page typography / background of this template; templates without one use FUNNEL_TEMPLATE_TYPOGRAPHY on white. */
  theme?: { typography?: Partial<PageDocument["settings"]["typography"]>; background?: { color: string } };
  /** Page-level settings applied with the template (event title, scroll reveal, sticky CTA). */
  pageSettings?: Partial<Pick<PageDocument["settings"], "eventTitle" | "scrollReveal" | "stickyCta">>;
  /** Library labels declared by the template itself (webinar templates); otherwise `funnel-template-catalog.ts` decides. */
  tags?: { purposes: readonly FunnelTemplatePurposeTag[]; styles: readonly FunnelTemplateStyleTag[] };
  /**
   * Retired templates stay resolvable (saved funnels still instantiate their id),
   * but are no longer offered as a new choice.
   */
  retired?: { since: string; replacedBy?: string };
  /**
   * Step-only templates: offered in the step menu for their step types, but left out of the library's
   * unfiltered browse (the matching thank-you pages of list and sales templates).
   */
  libraryHidden?: boolean;
  /** Development example: resolvable by id (harness, tests), never listed. */
  hidden?: boolean;
};
type FunnelTemplatePurposeTag = WebinarTemplateDefinition["purposes"][number];
type FunnelTemplateStyleTag = WebinarTemplateDefinition["styles"][number];

/** Gallery entry of a webinar registration template (`src/lib/funnel-templates/webinar`). */
export function webinarTemplateGalleryItem(template: WebinarTemplateDefinition): FunnelTemplateGalleryItem {
  return {
    id: template.id, referenceId: `celebratedeal-${template.id}`, goal: "webinar", category: template.category, name: template.name, description: template.description,
    status: "available", statusReason: "可套用並在公開頁顯示；報名表單會綁定此一頁式網站的報名表與活動。", preview: template.preview,
    theme: template.theme, pageSettings: template.settings, tags: { purposes: template.purposes, styles: template.styles },
    build: template.build, ...(template.hidden ? { hidden: true } : {}),
  };
}

const CONVERSION_GOAL = { leads: "audience", sales: "sell" } as const;
const CONVERSION_STATUS = {
  leads: { status: "available", reason: "可套用並在公開頁顯示；名單表單會綁定此一頁式網站的名單表單。" },
  sales: { status: "limited", reason: "用於「訂單表單」步驟：價格與結帳按鈕來自此步驟在「商品與結帳」綁定的商品，未綁定時不可付款。" },
} as const;

/** Gallery entry of a list (leads) or sales page template (`src/lib/funnel-templates/{leads,sales}`). */
export function conversionTemplateGalleryItem(template: ConversionTemplateDefinition): FunnelTemplateGalleryItem {
  const status = CONVERSION_STATUS[template.kind];
  return {
    id: template.id, referenceId: `celebratedeal-${template.id}`, goal: CONVERSION_GOAL[template.kind], category: template.category, name: template.name, description: template.description,
    status: status.status, statusReason: status.reason, preview: template.preview,
    theme: template.theme, pageSettings: template.settings, tags: { purposes: template.purposes, styles: template.styles },
    build: template.build, ...(template.hidden ? { hidden: true } : {}),
  };
}

/** Matching thank-you page (`${id}-thanks`): offered for the thank-you step, not browsed in the library. */
export function conversionThankYouGalleryItem(template: ConversionTemplateDefinition): FunnelTemplateGalleryItem {
  const design = template.thankYou;
  return {
    id: `${template.id}-thanks`, referenceId: `celebratedeal-${template.id}-thanks`, goal: CONVERSION_GOAL[template.kind], category: template.kind === "leads" ? "名單感謝頁" : "訂單感謝頁",
    name: design.name, description: design.description, status: "available", statusReason: "可展開為獨立編輯的 CelebrateDeal 節點",
    preview: { eyebrow: template.kind === "leads" ? "名單感謝頁" : "訂單感謝頁", headline: design.title, summary: design.description, palette: [design.tokens.background, design.tokens.accent, design.tokens.surface], sectionCount: 3 + (design.next ? 1 : 0) + (design.faq?.length ? 1 : 0) },
    theme: conversionThankYouTheme(template), tags: { purposes: template.purposes, styles: template.styles },
    build: (prefix) => buildConversionThankYou(template, prefix), libraryHidden: true, ...(template.hidden ? { hidden: true } : {}),
  };
}

/*
 * Node IDs and types of every template are pinned by tests (saved documents
 * and analytics refer to them). Design polish therefore only changes props
 * and styles — never adds, removes or reorders nodes.
 */
type Style = FunnelNode["style"];
const INK = "#0f172a";
const BODY = "#334155";
const MUTED = "#475569";
const LINE = "#e2e8f0";
const NIGHT_MUTED = "#cbd5e1";

const node = (
  prefix: string,
  id: string,
  type: FunnelNodeType,
  props: Record<string, unknown> = {},
  children?: FunnelNode[],
  style: Style = {},
  actions: FunnelNodeAction[] = [],
  mobileStyle?: Style,
): FunnelNode => ({
  schemaVersion: 1,
  id: `${prefix}_${id}`,
  type,
  props,
  style,
  overrides: mobileStyle ? { mobile: { style: mobileStyle } } : {},
  visible: true,
  actions,
  attributes: {},
  ...(children ? { children } : {}),
});

const text = (prefix: string, id: string, value: string, style: Style = {}) =>
  node(prefix, id, "text", { text: value }, undefined, style);
/** Small uppercase label above a headline (colour: page link colour unless given). */
const eyebrow = (prefix: string, id: string, value: string, color?: string) =>
  node(prefix, id, "text", { text: value, textStyle: "eyebrow" }, undefined, color ? { color } : {});
const lead = (prefix: string, id: string, value: string, style: Style = {}) =>
  node(prefix, id, "text", { text: value, textStyle: "lead" }, undefined, style);
const small = (prefix: string, id: string, value: string, style: Style = {}) =>
  node(prefix, id, "text", { text: value, textStyle: "small" }, undefined, style);
const headline = (prefix: string, id: string, value: string, level: "h1" | "h2" | "h3" = "h2", style: Style = {}) =>
  node(prefix, id, "headline", { text: value, level }, undefined, style);
type ButtonTone = "amber" | "blue" | "dark";
const BUTTON_TONES: Readonly<Record<ButtonTone, Style>> = { amber: { backgroundColor: "#f59e0b", color: INK }, blue: { backgroundColor: "#1d4ed8", color: "#ffffff" }, dark: { backgroundColor: INK, color: "#ffffff" } };
const button = (prefix: string, id: string, label: string, action: FunnelNodeAction, tone: ButtonTone = "amber", extra: Style = {}) =>
  node(prefix, id, "button", { label }, undefined, { ...BUTTON_TONES[tone], borderRadius: 10, ...extra }, [action]);
const image = (prefix: string, id: string, alt: string, src: string = FUNNEL_PLACEHOLDER_IMAGE_SRC, style: Style = {}) =>
  node(prefix, id, "image", { src, alt, objectFit: "cover" }, undefined, { imageWidth: 100, borderRadius: 20, ...style });

type BoxVariant = "card" | "plain" | "dark" | "tint";
const BOX_STYLES: Readonly<Record<BoxVariant, Style>> = {
  card: { backgroundColor: "#ffffff", borderColor: LINE, borderWidth: 1, borderRadius: 16, padding: 28, shadow: "soft" },
  plain: { padding: 0 },
  dark: { backgroundColor: INK, color: "#ffffff", borderRadius: 20, padding: 36, shadow: "medium" },
  tint: { backgroundColor: "#f8fafc", borderColor: LINE, borderWidth: 1, borderRadius: 16, padding: 28 },
};
const box = (prefix: string, id: string, children: FunnelNode[], variant: BoxVariant = "card", extra: Style = {}) =>
  node(prefix, id, "content_box", { gap: variant === "plain" ? 18 : 12 }, children, { ...BOX_STYLES[variant], ...extra }, [], variant === "plain" ? undefined : { padding: 22 });
const columns = (prefix: string, id: string, children: FunnelNode[], count: 2 | 3 = 2, align?: Style["align"]) =>
  node(prefix, id, count === 3 ? "columns_3" : "columns_2", { gap: count === 3 ? 24 : 48 }, children, align ? { align } : {});

type SectionOptions = { align?: "left" | "center"; paddingY?: number; paddingYMobile?: number; maxWidth?: number; color?: string; direction?: "row" };
/** Section › Row with responsive padding; `direction: "row"` lays the row's children side by side (headers). */
const section = (prefix: string, id: string, children: FunnelNode[], backgroundColor?: string, options: SectionOptions = {}) => {
  const { align, paddingY = 88, paddingYMobile = 56, maxWidth = 1120, color, direction } = options;
  const style: Style = { padding: `${paddingY}px 32px` };
  if (backgroundColor) style.backgroundColor = backgroundColor;
  if (color) style.color = color;
  if (align) style.textAlign = align;
  return node(prefix, id, "section", {}, [node(prefix, `${id}_row`, "row", { maxWidth, gap: 24 }, children, direction ? { direction } : {})], style, [], { padding: `${paddingYMobile}px 20px` });
};
const list = (prefix: string, id: string, items: string[], style: Style = {}) => node(prefix, id, "bulleted_list", { items }, undefined, style);

const form = (prefix: string, id: string, heading: string, buttonLabel: string) => {
  const formId = `${prefix}_${id}`;
  return node(prefix, id, "form", { variant: "opt-in" }, [
    text(prefix, `${id}_title`, heading, { fontSize: 22, lineHeight: 1.35, color: INK }),
    node(prefix, `${id}_name`, "form_input", { inputType: "text", label: "姓名", placeholder: "請輸入姓名" }),
    node(prefix, `${id}_email`, "form_input", { inputType: "email", label: "電子信箱", placeholder: "name@example.com" }),
    node(prefix, `${id}_consent`, "checkbox", { label: "我同意接收本活動相關資訊", required: true }),
    button(prefix, `${id}_submit`, buttonLabel, { type: "submit_form", formId }, "amber", { width: 100 }),
  ], { backgroundColor: "#ffffff", borderColor: LINE, borderWidth: 1, borderRadius: 18, padding: 32, shadow: "medium", textAlign: "left" }, [], { padding: 22 });
};

/** Page-level typography every gallery template starts with (editable in 頁面設定). */
export const FUNNEL_TEMPLATE_TYPOGRAPHY = { textColor: BODY, headingColor: INK, linkColor: "#1d4ed8", bodyLineHeight: 1.7 } as const;

const limitedPayment = {
  capabilityStatus: FUNNEL_CAPABILITIES.payment.status,
  capabilityReason: FUNNEL_CAPABILITIES.payment.reason,
  disabled: true,
};

const checkoutForm: Style = { backgroundColor: "#ffffff", borderColor: LINE, borderWidth: 1, borderRadius: 18, padding: 32, shadow: "soft" };
const checkout = (prefix: string, compact = false) => [
  section(prefix, "checkout", [columns(prefix, "checkout_columns", [
    node(prefix, "customer", "form", { variant: "checkout-contact" }, [
      text(prefix, "customer_title", compact ? "聯絡資料" : "完成訂購資料", { fontSize: 26, lineHeight: 1.3, color: INK }),
      node(prefix, "customer_name", "form_input", { inputType: "text", label: "姓名" }),
      node(prefix, "customer_email", "form_input", { inputType: "email", label: "電子信箱" }),
      small(prefix, "customer_notice", "請前往安全結帳頁填寫聯絡資料與配送地址；此處僅展示版面，不收集訂購資料。", { color: MUTED }),
    ], checkoutForm, [], { padding: 22 }),
    node(prefix, "order", "form", { variant: "checkout-summary", ...limitedPayment }, [
      text(prefix, "order_title", "方案摘要", { fontSize: 26, lineHeight: 1.3, color: INK }),
      lead(prefix, "order_name", compact ? "你的精選方案" : "CelebrateDeal 成長方案", { color: INK }),
      node(prefix, "order_price", "offer_price", limitedPayment),
      node(prefix, "payment_method", "payment_method", limitedPayment),
      node(prefix, "payment_button", "payment_button", { ...limitedPayment, label: "前往安全結帳" }),
    ], { ...checkoutForm, backgroundColor: compact ? "#f8fafc" : "#ffffff", shadow: compact ? "none" : "medium" }, [], { padding: 22 }),
  ], 2, "start")], compact ? "white" : "#fff7ed", { paddingY: 72 }),
  section(prefix, "trust", [columns(prefix, "trust_columns", [
    box(prefix, "support", [headline(prefix, "support_title", "有問題嗎？", "h3"), text(prefix, "support_text", "請先聯絡客服確認方案與付款方式。")], "tint"),
    box(prefix, "promise", [headline(prefix, "promise_title", "安心確認", "h3"), text(prefix, "promise_text", "金額以安全結帳頁為準。只有付款服務確認成功後，訂單才會更新付款狀態。")], "tint"),
  ], 2)], undefined, { paddingY: 56, paddingYMobile: 40 }),
];

const subscription = (prefix: string) => [
  section(prefix, "hero", [columns(prefix, "hero_columns", [
    box(prefix, "hero_copy", [
      eyebrow(prefix, "eyebrow", "內容訂閱計畫", "#92400e"),
      headline(prefix, "hero_title", "讓好內容陪你持續成長", "h1"),
      lead(prefix, "hero_text", "每週整理實作方法、案例與行動清單，幫你穩定推進。"),
      list(prefix, "hero_list", ["每週主題內容", "可重複使用的工作表", "會員限定交流"]),
    ], "plain"),
    node(prefix, "plan", "form", { variant: "subscription-summary", ...limitedPayment }, [
      text(prefix, "plan_title", "每月內容方案", { fontSize: 26, lineHeight: 1.3, color: INK }),
      lead(prefix, "plan_price", "NT$ 方案價格待設定", { color: INK }),
      node(prefix, "plan_offer", "offer_price", limitedPayment),
      node(prefix, "plan_payment", "payment_method", limitedPayment),
      node(prefix, "plan_button", "payment_button", { ...limitedPayment, label: "訂閱付款尚未啟用" }),
    ], { ...checkoutForm, shadow: "medium" }, [], { padding: 22 }),
  ], 2, "center")], "#fffbeb", { paddingY: 104, paddingYMobile: 56 }),
  section(prefix, "bonus", [headline(prefix, "bonus_title", "訂閱加值內容"), columns(prefix, "bonus_columns", [
    box(prefix, "bonus_one", [headline(prefix, "bonus_one_title", "範本資料庫", "h3"), text(prefix, "bonus_one_text", "直接套用常見行銷與內容範本。")]),
    box(prefix, "bonus_two", [headline(prefix, "bonus_two_title", "每月回顧", "h3"), text(prefix, "bonus_two_text", "用簡單方法整理成果與下一步。")]),
  ], 2)], undefined, { align: "center", maxWidth: 960 }),
];

const header = (prefix: string, brand: string, items: Array<{ label: string; href: string }>) =>
  section(prefix, "header", [
    headline(prefix, "brand", brand, "h2", { fontSize: 22, lineHeight: 1.3 }),
    node(prefix, "menu", "menu", { items }, undefined, { color: BODY }),
  ], "white", { paddingY: 20, paddingYMobile: 16, maxWidth: 1200, direction: "row" });

const audiencePage = (prefix: string, variant: "volunteer" | "charity" | "environment") => {
  const copy = {
    volunteer: { eyebrow: "志工招募", title: "一起把時間變成真正的改變", intro: "加入在地志工團隊，找到適合你的參與方式。", cta: "我要加入志工", theme: "#eff6ff", image: FUNNEL_ILLUSTRATIONS.heroCommunity },
    charity: { eyebrow: "公益活動", title: "每一次參與，都能讓社區更靠近希望", intro: "掌握近期活動與服務消息，一起支持需要被看見的人。", cta: "收到活動通知", theme: "#fdf2f8", image: FUNNEL_ILLUSTRATIONS.heroCommunity },
    environment: { eyebrow: "環境倡議", title: "守護土地，從今天的一個選擇開始", intro: "關注棲地、減塑與公民行動，把關心變成可持續的力量。", cta: "加入倡議名單", theme: "#ecfdf5", image: FUNNEL_ILLUSTRATIONS.heroNature },
  }[variant];
  return [
    header(prefix, "CelebrateDeal 公益行動", [{ label: "關於行動", href: "#about" }, { label: "參與方式", href: "#join" }, { label: "常見問題", href: "#faq" }]),
    section(prefix, "hero", [columns(prefix, "hero_columns", [
      box(prefix, "hero_copy", [eyebrow(prefix, "eyebrow", copy.eyebrow), headline(prefix, "hero_title", copy.title, "h1"), lead(prefix, "hero_intro", copy.intro), image(prefix, "hero_image", `${copy.eyebrow}主視覺`, copy.image, { imageHeight: 260 })], "plain"),
      form(prefix, "hero_form", "留下聯絡方式", copy.cta),
    ], 2, "center")], copy.theme, { paddingY: 96, paddingYMobile: 56 }),
    section(prefix, "impact", [headline(prefix, "impact_title", "我們正在推進的事"), columns(prefix, "impact_columns", [
      box(prefix, "impact_one", [headline(prefix, "impact_one_title", "在地連結", "h3"), text(prefix, "impact_one_text", "串連社群夥伴，把資源送到真正需要的地方。")]),
      box(prefix, "impact_two", [headline(prefix, "impact_two_title", "透明行動", "h3"), text(prefix, "impact_two_text", "定期分享進度與成果，讓每份支持都有跡可循。")]),
      box(prefix, "impact_three", [headline(prefix, "impact_three_title", "長期陪伴", "h3"), text(prefix, "impact_three_text", "以可持續的方法累積影響，而非一次性的熱度。")]),
    ], 3)], undefined, { align: "center" }),
    section(prefix, "faq", [headline(prefix, "faq_title", "常見問題", "h2", { textAlign: "center" }), node(prefix, "faq_list", "faq", { items: [
      { question: "需要具備經驗嗎？", answer: "不需要，我們會依參與方式提供清楚說明。" },
      { question: "留下資料後會發生什麼？", answer: "你會收到活動資訊，不會觸發付款或正式寄信測試。" },
    ] }, [])], "#f8fafc", { maxWidth: 760 }),
    section(prefix, "footer", [small(prefix, "footer_text", "© CelebrateDeal 公益行動。聯絡資訊與隱私說明皆可自行編輯。", { color: NIGHT_MUTED })], INK, { align: "center", paddingY: 40, paddingYMobile: 32, color: "#ffffff" }),
  ];
};

const legalPage = (prefix: string, kind: "privacy" | "terms") => {
  const privacy = kind === "privacy";
  return [section(prefix, "legal", [box(prefix, "legal_content", [
    headline(prefix, "legal_title", privacy ? "隱私權政策" : "服務條款", "h1"),
    small(prefix, "legal_updated", "最後更新日期：請在發布前填寫", { color: MUTED }),
    headline(prefix, "legal_scope_title", privacy ? "我們如何處理資料" : "服務使用範圍", "h2", { fontSize: 24, margin: "16px 0 0" }),
    text(prefix, "legal_scope_text", privacy ? "此範本提供可編輯的基本章節，發布前應由負責人依實際資料流程與法規完成審閱。" : "此範本提供可編輯的基本章節，發布前應依實際服務內容與權利義務完成審閱。"),
    headline(prefix, "legal_rights_title", privacy ? "你的權利" : "使用者責任", "h2", { fontSize: 24, margin: "16px 0 0" }),
    text(prefix, "legal_rights_text", privacy ? "你可以聯絡服務提供者提出查詢、更正或刪除請求。請補上正式聯絡方式。" : "使用者應提供正確資料並遵守適用規範。請補上完整責任與終止條款。"),
    headline(prefix, "legal_contact_title", "聯絡方式", "h2", { fontSize: 24, margin: "16px 0 0" }),
    text(prefix, "legal_contact_text", "請在發布前填入正式公司名稱、地址與聯絡管道。"),
  ], "plain")], undefined, { maxWidth: 760, paddingY: 72, paddingYMobile: 40 })];
};

const brandInfo = (prefix: string) => [
  header(prefix, "CelebrateDeal", [{ label: "品牌故事", href: "#story" }, { label: "服務原則", href: "#principles" }, { label: "聯絡我們", href: "#contact" }]),
  section(prefix, "hero", [columns(prefix, "hero_columns", [box(prefix, "hero_copy", [headline(prefix, "hero_title", "讓值得慶祝的成果，被更多人看見", "h1"), lead(prefix, "hero_text", "用清楚、可信任的資訊，介紹品牌使命與服務方式。")], "plain"), image(prefix, "hero_image", "品牌故事主視覺", FUNNEL_ILLUSTRATIONS.heroWorkspace)], 2, "center")], "#f5f3ff", { paddingY: 104, paddingYMobile: 56 }),
  section(prefix, "principles", [headline(prefix, "principles_title", "我們重視的事"), columns(prefix, "principles_columns", [
    box(prefix, "principle_one", [headline(prefix, "principle_one_title", "清楚", "h3"), text(prefix, "principle_one_text", "重要資訊以自然、容易理解的方式呈現。")]),
    box(prefix, "principle_two", [headline(prefix, "principle_two_title", "負責", "h3"), text(prefix, "principle_two_text", "功能限制與資料用途都明確說明。")]),
    box(prefix, "principle_three", [headline(prefix, "principle_three_title", "同行", "h3"), text(prefix, "principle_three_text", "陪伴團隊把每個想法落實成下一步。")]),
  ], 3)], undefined, { align: "center" }),
  section(prefix, "contact", [headline(prefix, "contact_title", "想進一步認識我們？", "h2", { color: "#ffffff" }), button(prefix, "contact_button", "聯絡 CelebrateDeal", { type: "open_url", href: "#contact", newTab: false })], INK, { align: "center", color: "#ffffff", maxWidth: 760 }),
];

const availableReason = "可展開為獨立編輯的 CelebrateDeal 節點";
const limitedReason = "版面可編輯；需在訂單步驟綁定有效商品，付款方式由既有結帳服務提供。未綁定時不可付款";

const webinarPage = (prefix: string, stage: "registration" | "thank-you" | "broadcast") => {
  // 真正報名與播放能力仍由公開頁綁定的已驗證資源提供；模板只組合一般可編輯節點。
  if (stage === "registration") return [
    section(prefix, "hero", [columns(prefix, "hero_columns", [
      box(prefix, "hero_copy", [eyebrow(prefix, "eyebrow", "CelebrateDeal 線上講堂"), headline(prefix, "title", "把模糊的想法，整理成能落地的行動", "h1"), lead(prefix, "intro", "60 分鐘實作分享，帶你拆解方法、案例與下一步。"), list(prefix, "highlights", ["真實案例拆解", "現場提問交流", "課後行動清單"])], "plain"),
      form(prefix, "registration_form", "免費保留席次", "我要報名"),
    ], 2, "center")], "#eff6ff", { paddingY: 104, paddingYMobile: 56 }),
    section(prefix, "speaker", [columns(prefix, "speaker_columns", [image(prefix, "speaker_image", "講者形象照", FUNNEL_ILLUSTRATIONS.heroLearning), box(prefix, "speaker_copy", [eyebrow(prefix, "speaker_eyebrow", "本場講者"), headline(prefix, "speaker_name", "林怡安｜內容策略顧問", "h2"), lead(prefix, "speaker_intro", "擅長把複雜策略整理成團隊可以一起執行的清楚步驟。")], "plain")], 2, "center")]),
    section(prefix, "agenda", [headline(prefix, "agenda_title", "這場分享會會帶走什麼？"), columns(prefix, "agenda_columns", [box(prefix, "agenda_one", [headline(prefix, "agenda_one_title", "看懂卡點", "h3"), text(prefix, "agenda_one_text", "用簡單框架找出轉換流程真正卡住的位置。")]), box(prefix, "agenda_two", [headline(prefix, "agenda_two_title", "帶走做法", "h3"), text(prefix, "agenda_two_text", "把概念變成明天就能開始的小步驟。")]), box(prefix, "agenda_three", [headline(prefix, "agenda_three_title", "持續優化", "h3"), text(prefix, "agenda_three_text", "建立能被團隊共同追蹤的迭代節奏。")])], 3)], "#f8fafc", { align: "center" }),
  ];
  if (stage === "thank-you") return [
    section(prefix, "hero", [eyebrow(prefix, "eyebrow", "報名完成", "#047857"), headline(prefix, "title", "席次已為你保留，接下來做三件小事", "h1"), lead(prefix, "intro", "把活動放進行事曆，也記得查看收件匣中的參與資訊。")], "#ecfdf5", { align: "center", maxWidth: 820, paddingY: 104, paddingYMobile: 56 }),
    section(prefix, "checklist", [columns(prefix, "checklist_columns", [box(prefix, "check_mail", [headline(prefix, "check_mail_title", "01｜確認 Email", "h3"), text(prefix, "check_mail_text", "活動連結與注意事項會寄到報名信箱。")]), box(prefix, "check_calendar", [headline(prefix, "check_calendar_title", "02｜記下時間", "h3"), text(prefix, "check_calendar_text", "預留不被打擾的學習時間，準時加入。")]), box(prefix, "check_question", [headline(prefix, "check_question_title", "03｜準備問題", "h3"), text(prefix, "check_question_text", "先記下最想解決的一個問題，現場會更有收穫。")])], 3)]),
    section(prefix, "share", [headline(prefix, "share_title", "也想邀請夥伴一起參加？"), lead(prefix, "share_text", "把活動頁分享給正在面對相同挑戰的朋友。"), button(prefix, "share_button", "返回活動資訊", { type: "open_url", href: "#top", newTab: false }, "dark")], "#f8fafc", { align: "center", maxWidth: 760 }),
  ];
  return [
    section(prefix, "hero", [columns(prefix, "hero_columns", [box(prefix, "player", [eyebrow(prefix, "live_badge", "LIVE｜活動進行中", "#fbbf24"), headline(prefix, "title", "歡迎來到 CelebrateDeal 線上講堂", "h1", { color: "#ffffff" }), lead(prefix, "player_notice", "播放入口會依已綁定的 Webinar 場次與開放狀態顯示。", { color: NIGHT_MUTED })], "dark"), box(prefix, "session", [headline(prefix, "session_title", "本場重點", "h3"), list(prefix, "session_list", ["釐清目前最重要的目標", "拆解可執行的轉換路徑", "完成一份下一步行動清單"])])], 2, "stretch")], "#f8fafc", { paddingY: 72 }),
    section(prefix, "notes", [columns(prefix, "notes_columns", [box(prefix, "notes_copy", [headline(prefix, "notes_title", "先把問題寫下來", "h2"), text(prefix, "notes_text", "觀看過程若有疑問，先記錄情境與期待結果，提問時會更容易得到具體建議。")], "plain"), box(prefix, "support", [headline(prefix, "support_title", "遇到播放問題？", "h3"), text(prefix, "support_text", "請先重新整理頁面並確認網路連線；仍無法觀看時，再聯絡主辦單位。")], "tint")], 2, "center")]),
  ];
};

// 課程與銷講內容只提供可編輯起點；不內建虛構成效、名額或成交保證。
const courseLeadPage = (prefix: string, variant: "workbook" | "consultation" | "lesson") => {
  const copy = {
    workbook: { title: "把專業整理成第一份課程大綱", eyebrow: "課程規劃工作表", intro: "從受眾、學習目標到單元安排，用一份工作表整理你的開課想法。", cta: "索取課程規劃資訊", theme: "#eff6ff", items: ["釐清想幫助的學員與問題", "寫下可檢查的學習目標", "排出第一版課程單元"] },
    consultation: { title: "先釐清需求，再決定適合的學習方案", eyebrow: "課程需求諮詢", intro: "說明目前的目標與遇到的困難，讓團隊先了解需求，再討論是否適合進一步諮詢。", cta: "留下諮詢意願", theme: "#f5f3ff", items: ["整理目前的學習或業務目標", "找出最需要協助的一個環節", "確認課程內容與投入是否適合"] },
    lesson: { title: "用一堂入門課，認識你的下一步", eyebrow: "課程體驗資訊", intro: "先了解主題、練習方式與適合對象，再決定是否參與完整課程。", cta: "索取體驗課資訊", theme: "#fff7ed", items: ["主題概念與常見誤區", "一個可以自行練習的任務", "完整課程的內容與適合對象"] },
  }[variant];
  const signup = form(prefix, "course_form", "留下聯絡方式", copy.cta);
  const heroCopy = [eyebrow(prefix, "eyebrow", copy.eyebrow), headline(prefix, "title", copy.title, "h1"), lead(prefix, "intro", copy.intro)];
  return [
    section(prefix, "hero", variant === "workbook" ? [columns(prefix, "hero_columns", [
      box(prefix, "hero_copy", heroCopy, "plain"), signup,
    ], 2, "center")] : heroCopy, copy.theme, variant === "workbook" ? { paddingY: 104, paddingYMobile: 56 } : { align: "center", maxWidth: 820, paddingY: 104, paddingYMobile: 56 }),
    section(prefix, "contents", [headline(prefix, "contents_title", variant === "consultation" ? "這次可以先討論什麼？" : "先了解這三件事"),
      columns(prefix, "contents_columns", copy.items.map((item, index) => box(prefix, `topic_${index}`, [headline(prefix, `topic_title_${index}`, `${index + 1}｜${item}`, "h3", { fontSize: 20 }) ])), 3)], undefined, { align: "center" }),
    ...(variant === "workbook" ? [] : [section(prefix, "signup", [signup], "#f8fafc", { maxWidth: 560 })]),
    section(prefix, "next", [headline(prefix, "next_title", "送出之後會發生什麼？", "h2", { fontSize: 28 }), text(prefix, "next_text", "請依完成頁指示確認後續聯繫方式。留下聯絡方式不代表已購買課程或完成諮詢預約；課程內容、時程與聯絡方式請由主辦單位確認。", { color: MUTED })], undefined, { align: "center", maxWidth: 760, paddingY: 64, paddingYMobile: 40 }),
  ];
};

const salesWebinarPage = (prefix: string, variant: "course" | "workshop" | "strategy") => {
  const copy = {
    course: { title: "開課前，先把你的課程路線說清楚", eyebrow: "課程說明會", intro: "了解課程主題、單元安排與練習方式，判斷是否符合你現在的需求。", cta: "報名課程說明會", theme: "#eff6ff", agenda: ["適合對象與先備條件", "課程單元與練習安排", "參與方式與問題討論"] },
    workshop: { title: "帶著一個問題，完成一份實作草稿", eyebrow: "線上實作工作坊", intro: "從範例拆解到自己動手，先用一次練習認識這套方法的使用方式。", cta: "報名實作工作坊", theme: "#ecfdf5", agenda: ["拆解範例與操作步驟", "完成自己的第一版草稿", "整理卡點與後續練習方向"] },
    strategy: { title: "把你的專業，整理成清楚的服務提案", eyebrow: "顧問服務銷講", intro: "從客戶需求、服務範圍到交付安排，了解如何說明一份完整提案。", cta: "報名服務提案講座", theme: "#fff7ed", agenda: ["定義想協助的客戶與問題", "釐清服務範圍與交付方式", "用提案說明價值與合作條件"] },
  }[variant];
  // Webinar 的公開報名由既有專用表單處理；模板導向它，不另外渲染停用的通用表單。
  const signup = box(prefix, "webinar_signup", [
    headline(prefix, "signup_title", "參加這場活動", "h2", { fontSize: 28 }),
    text(prefix, "signup_text", "確認活動資訊後，前往報名表填寫資料。", { color: MUTED }),
    button(prefix, "signup_button", copy.cta, { type: "open_url", href: "#webinar-registration", newTab: false }, "amber", { width: 100 }),
  ], "card", { padding: 32, shadow: "medium", textAlign: "left" });
  const heroCopy = [eyebrow(prefix, "eyebrow", copy.eyebrow), headline(prefix, "title", copy.title, "h1"), lead(prefix, "intro", copy.intro)];
  return [
    section(prefix, "hero", variant === "course" ? [columns(prefix, "hero_columns", [
      box(prefix, "hero_copy", heroCopy, "plain"), signup,
    ], 2, "center")] : heroCopy, copy.theme, variant === "course" ? { paddingY: 104, paddingYMobile: 56 } : { align: "center", maxWidth: 820, paddingY: 104, paddingYMobile: 56 }),
    section(prefix, "agenda", [headline(prefix, "agenda_title", "本場內容"), list(prefix, "agenda_list", copy.agenda, { fontSize: 18 })], undefined, { maxWidth: 760 }),
    section(prefix, "speaker", [headline(prefix, "speaker_title", "講者與活動資訊"), text(prefix, "speaker_text", "請填入實際講者姓名、相關經驗與活動時間。報名前可先向主辦單位確認內容與參與方式。")], "#f8fafc", { maxWidth: 760 }),
    ...(variant === "course" ? [] : [section(prefix, "signup", [signup], undefined, { maxWidth: 560 })]),
    section(prefix, "participation", [headline(prefix, "participation_title", variant === "workshop" ? "參加前可以先準備" : "報名前先確認", "h2", { fontSize: 28 }), text(prefix, "participation_text", variant === "workshop" ? "先記下想處理的一個問題，並準備可操作的裝置。實作素材與需要的工具請依主辦單位公告為準。" : "本頁是活動報名，送出資料不代表購買課程。若活動中介紹付費方案，內容與費用需另行確認；報名狀態與觀看入口請依完成頁指示。", { color: MUTED })], undefined, { maxWidth: 760, paddingY: 64, paddingYMobile: 40 }),
  ];
};

const templates: FunnelTemplateGalleryItem[] = [
  { id: "webinar-broadcast", referenceId: "celebratedeal-webinar-broadcast", goal: "webinar", category: "播放會場", name: "專注播放會場", description: "直播狀態、重點摘要、提問筆記與播放問題指引。", status: "available", statusReason: availableReason, preview: { eyebrow: "Webinar", headline: "專注播放會場", summary: "線上活動與參與資訊", palette: ["#f8fafc", "#0f172a", "#f59e0b"], sectionCount: 2 }, build: (prefix) => webinarPage(prefix, "broadcast") },
  { id: "webinar-thank-you", referenceId: "celebratedeal-webinar-thank-you", goal: "webinar", category: "報名完成", name: "報名完成行動清單", description: "Email、行事曆與提問準備三步驟，降低報名後流失。", status: "available", statusReason: availableReason, preview: { eyebrow: "Webinar", headline: "報名完成行動清單", summary: "三步驟參與提醒", palette: ["#ecfdf5", "#047857", "#ffffff"], sectionCount: 3 }, build: (prefix) => webinarPage(prefix, "thank-you") },
  { id: "webinar-registration", referenceId: "celebratedeal-webinar-registration", goal: "webinar", category: "活動報名", name: "講者型活動報名頁", description: "價值主張、報名表單、講者介紹與三欄議程重點。", status: "available", statusReason: availableReason, preview: { eyebrow: "Webinar", headline: "講者型活動報名頁", summary: "講者與議程導向的長頁", palette: ["#eff6ff", "#2563eb", "#ffffff"], sectionCount: 3 }, build: (prefix) => webinarPage(prefix, "registration") },
  { id: "sell-product-checkout", referenceId: "25969", goal: "sell", category: "商品結帳", name: "暖色商品結帳", description: "地址與聯絡資料、方案摘要、付款限制提示及信任區塊。", status: "limited", statusReason: limitedReason, preview: { eyebrow: "Sell", headline: "暖色商品結帳", summary: "雙欄結帳與信任資訊", palette: ["#fff7ed", "#9a3412", "#ffffff"], sectionCount: 2 }, build: (prefix) => checkout(prefix) },
  { id: "sell-simple-checkout", referenceId: "25963", goal: "sell", category: "簡潔結帳", name: "藍白簡潔結帳", description: "精簡的聯絡資料與訂單摘要雙欄結構。", status: "limited", statusReason: limitedReason, preview: { eyebrow: "Sell", headline: "藍白簡潔結帳", summary: "聚焦轉換的精簡版面", palette: ["#ffffff", "#2563eb", "#eff6ff"], sectionCount: 2 }, build: (prefix) => checkout(prefix, true) },
  { id: "sell-content-subscription", referenceId: "25957", goal: "sell", category: "內容訂閱", name: "內容訂閱方案", description: "訂閱價值、方案卡與 bonus 內容；付款仍維持限制狀態。", status: "limited", statusReason: limitedReason, preview: { eyebrow: "Sell", headline: "內容訂閱方案", summary: "方案卡與加值內容", palette: ["#fffbeb", "#a16207", "#ffffff"], sectionCount: 2 }, build: subscription },
  { id: "audience-volunteer", referenceId: "26050", goal: "audience", category: "志工招募", name: "在地志工招募", description: "導覽、招募 Hero、名單表單、影響力與 FAQ 長頁。", status: "available", statusReason: availableReason, preview: { eyebrow: "Audience", headline: "在地志工招募", summary: "溫暖的社群招募長頁", palette: ["#eff6ff", "#1d4ed8", "#ffffff"], sectionCount: 5 }, build: (prefix) => audiencePage(prefix, "volunteer") },
  { id: "audience-charity-event", referenceId: "26049", goal: "audience", category: "公益活動", name: "公益活動名單", description: "公益活動訊息、參與表單、行動成果與常見問題。", status: "available", statusReason: availableReason, preview: { eyebrow: "Audience", headline: "公益活動名單", summary: "活動資訊與兩階段溝通入口", palette: ["#fdf2f8", "#be185d", "#ffffff"], sectionCount: 5 }, build: (prefix) => audiencePage(prefix, "charity") },
  { id: "audience-environment", referenceId: "26048", goal: "audience", category: "環境倡議", name: "環境倡議行動", description: "環境議題 Hero、倡議名單、成果卡與 FAQ。", status: "available", statusReason: availableReason, preview: { eyebrow: "Audience", headline: "環境倡議行動", summary: "自然色系的倡議長頁", palette: ["#ecfdf5", "#047857", "#ffffff"], sectionCount: 5 }, build: (prefix) => audiencePage(prefix, "environment") },
  { id: "custom-privacy", referenceId: "3012", goal: "custom", category: "隱私", name: "隱私權政策", description: "可編輯的隱私資料處理、權利與聯絡章節。", status: "available", statusReason: availableReason, preview: { eyebrow: "Custom", headline: "隱私權政策", summary: "簡潔的法務純文字版面", palette: ["#ffffff", "#0f172a", "#e2e8f0"], sectionCount: 1 }, build: (prefix) => legalPage(prefix, "privacy") },
  { id: "custom-terms", referenceId: "3011", goal: "custom", category: "條款", name: "服務條款", description: "可編輯的服務範圍、使用者責任與聯絡章節。", status: "available", statusReason: availableReason, preview: { eyebrow: "Custom", headline: "服務條款", summary: "簡潔的條款純文字版面", palette: ["#ffffff", "#1e293b", "#cbd5e1"], sectionCount: 1 }, build: (prefix) => legalPage(prefix, "terms") },
  { id: "custom-brand-info", referenceId: "3010", goal: "custom", category: "品牌資訊", name: "品牌資訊頁", description: "含導覽、Hero、品牌原則與聯絡行動的資訊頁。", status: "available", statusReason: availableReason, preview: { eyebrow: "Custom", headline: "品牌資訊頁", summary: "品牌化導覽與分段內容", palette: ["#f8fafc", "#7c3aed", "#ffffff"], sectionCount: 4 }, build: brandInfo },
  { id: "audience-course-workbook", referenceId: "celebratedeal-course-workbook", goal: "audience", category: "課程工作表", name: "課程規劃名單頁", description: "以課程工作表為主題，搭配學習目標、單元安排與名單表單。", status: "available", statusReason: availableReason, preview: { eyebrow: "課程名單", headline: "課程規劃名單頁", summary: "工作表與學習目標導向", palette: ["#eff6ff", "#1d4ed8", "#ffffff"], sectionCount: 3 }, build: prefix => courseLeadPage(prefix, "workbook") },
  { id: "audience-course-consultation", referenceId: "celebratedeal-course-consultation", goal: "audience", category: "課程諮詢", name: "課程需求諮詢名單頁", description: "先說明需求討論範圍，再收集聯絡方式，不冒充已完成預約。", status: "available", statusReason: availableReason, preview: { eyebrow: "課程名單", headline: "課程需求諮詢名單頁", summary: "需求釐清與諮詢意願", palette: ["#f5f3ff", "#7c3aed", "#ffffff"], sectionCount: 4 }, build: prefix => courseLeadPage(prefix, "consultation") },
  { id: "audience-course-lesson", referenceId: "celebratedeal-course-lesson", goal: "audience", category: "體驗課程", name: "入門體驗課名單頁", description: "介紹入門主題、練習任務與適合對象，讓訪客索取課程資訊。", status: "available", statusReason: availableReason, preview: { eyebrow: "課程名單", headline: "入門體驗課名單頁", summary: "體驗內容與後續學習路線", palette: ["#fff7ed", "#9a3412", "#ffffff"], sectionCount: 4 }, build: prefix => courseLeadPage(prefix, "lesson") },
  { id: "webinar-course-registration", referenceId: "celebratedeal-webinar-course", goal: "webinar", category: "課程說明會", name: "課程說明會報名頁", description: "課程內容、適合對象與參與方式，搭配首屏活動報名表單。", status: "available", statusReason: availableReason, preview: { eyebrow: "銷講活動", headline: "課程說明會報名頁", summary: "課程路線與報名前確認", palette: ["#eff6ff", "#2563eb", "#ffffff"], sectionCount: 4 }, build: prefix => salesWebinarPage(prefix, "course") },
  { id: "webinar-workshop-registration", referenceId: "celebratedeal-webinar-workshop", goal: "webinar", category: "實作工作坊", name: "線上實作工作坊報名頁", description: "實作目標、操作議程與參加前準備，搭配活動報名表單。", status: "available", statusReason: availableReason, preview: { eyebrow: "銷講活動", headline: "線上實作工作坊報名頁", summary: "範例拆解與動手練習", palette: ["#ecfdf5", "#047857", "#ffffff"], sectionCount: 5 }, build: prefix => salesWebinarPage(prefix, "workshop") },
  { id: "webinar-strategy-registration", referenceId: "celebratedeal-webinar-strategy", goal: "webinar", category: "顧問服務銷講", name: "服務提案銷講報名頁", description: "以客戶需求、服務範圍與交付方式為主題，清楚區分活動報名與購買。", status: "available", statusReason: availableReason, preview: { eyebrow: "銷講活動", headline: "服務提案銷講報名頁", summary: "服務價值與合作條件", palette: ["#fff7ed", "#9a3412", "#ffffff"], sectionCount: 5 }, build: prefix => salesWebinarPage(prefix, "strategy") },
  { id: "custom-luxury-course", referenceId: "celebratedeal-luxury-course", goal: "custom", category: "品牌首頁", name: "高質感課程品牌（黑金）", description: "黑底金字的課程品牌首頁：導覽列、主視覺、媒體 Logo、數據、課程卡片、評價牆、文章、影片與 FAQ。", status: "available", statusReason: availableReason, preview: { eyebrow: "Brand", headline: "高質感課程品牌（黑金）", summary: "襯線標題與金色點綴的品牌長頁", palette: ["#0b0b0c", "#c9a063", "#f7f3ec"], sectionCount: 15 }, theme: LUXURY_COURSE_THEME, build: buildLuxuryCourseTemplate },
];

/** Replaced 2026-10-29 by the researched list and sales page templates (docs/product/funnel-templates). */
const LEGACY_CONVERSION_REPLACEMENTS: Readonly<Record<string, string>> = {
  "audience-volunteer": "leads-checklist-minimal",
  "audience-charity-event": "leads-newsletter-editorial",
  "audience-environment": "leads-newsletter-editorial",
  "audience-course-workbook": "leads-toolkit-freelance",
  "audience-course-consultation": "leads-consult-interior",
  "audience-course-lesson": "leads-email-course-photo",
  "sell-product-checkout": "sales-product-coffee",
  "sell-simple-checkout": "sales-digital-planner",
  "sell-content-subscription": "sales-saas-plans",
};
/** Retired 2026-10-29 (migration-plan §1): definitions stay so saved funnels and tests still resolve them. */
const RETIRED_SINCE = "2026-10-29";
const RETIRED_TEMPLATES: Readonly<Record<string, string | undefined>> = {
  "webinar-registration": "webinar-saas-split",
  "webinar-course-registration": "webinar-saas-split",
  "webinar-workshop-registration": "webinar-design-workshop",
  "webinar-strategy-registration": "webinar-saas-split",
  "custom-brand-info": "custom-luxury-course",
  ...Object.fromEntries(FUNCTIONAL_PAGE_TEMPLATES.map((page) => [page.replaces, page.id])),
  ...LEGACY_CONVERSION_REPLACEMENTS,
};
const markLifecycle = (template: FunnelTemplateGalleryItem): FunnelTemplateGalleryItem => {
  if (Object.hasOwn(RETIRED_TEMPLATES, template.id)) return { ...template, retired: { since: RETIRED_SINCE, ...(RETIRED_TEMPLATES[template.id] ? { replacedBy: RETIRED_TEMPLATES[template.id] } : {}) } };
  return template;
};

export const FUNNEL_TEMPLATE_GALLERY: readonly FunnelTemplateGalleryItem[] = Object.freeze([
  ...templates.map(markLifecycle),
  ...WEBINAR_TEMPLATES.map(webinarTemplateGalleryItem),
  ...LEADS_TEMPLATES.map(conversionTemplateGalleryItem),
  ...SALES_TEMPLATES.map(conversionTemplateGalleryItem),
  ...LEADS_TEMPLATES.map(conversionThankYouGalleryItem),
  ...SALES_TEMPLATES.map(conversionThankYouGalleryItem),
  ...FUNCTIONAL_PAGE_TEMPLATES.map(functionalPageGalleryItem),
]);
const THANK_YOU_IDS: ReadonlySet<string> = new Set([...LEADS_TEMPLATES, ...SALES_TEMPLATES].map((template) => `${template.id}-thanks`));

/** Templates offered as a new choice: retired and hidden entries stay resolvable but are not listed. */
const offered = (template: FunnelTemplateGalleryItem) => !template.retired && !template.hidden;

let instanceSequence = 0;
function nextPrefix(templateId: string): string {
  instanceSequence += 1;
  return `gallery_${templateId}_${Date.now().toString(36)}_${instanceSequence}`;
}

export function getFunnelTemplateGalleryItem(templateId: string): FunnelTemplateGalleryItem | null {
  return FUNNEL_TEMPLATE_GALLERY.find((template) => template.id === templateId) ?? null;
}

export function listFunnelTemplateGallery(goal?: FunnelTemplateGoal, stepType?: FunnelStepType): readonly FunnelTemplateGalleryItem[] {
  const goalTemplates = (goal ? FUNNEL_TEMPLATE_GALLERY.filter((template) => template.goal === goal) : FUNNEL_TEMPLATE_GALLERY).filter(offered);
  if (!stepType) return goalTemplates.filter((template) => !template.libraryHidden);
  if (goal === "webinar") {
    const templatesByStep: Partial<Record<FunnelStepType, string[]>> = {
      webinar_registration_page: WEBINAR_TEMPLATES.map((template) => template.id),
      webinar_thank_you_page: ["webinar-thank-you-v2"],
      webinar_broadcast_page: ["webinar-broadcast-v2"],
    };
    const templateIds = templatesByStep[stepType];
    return templateIds ? goalTemplates.filter((template) => templateIds.includes(template.id)) : [];
  }
  if (goal === "custom") return ["info_page", "contact_us_page"].includes(stepType) ? goalTemplates : [];
  // Audience and sell: page templates for the content steps, the matching thank-you pages for the thank-you step.
  if (goal === "audience") {
    if (stepType === "opt_in_thank_you_page") return goalTemplates.filter((template) => THANK_YOU_IDS.has(template.id));
    return ["opt_in_page", "inline_form", "popup_form", "link_in_bio"].includes(stepType) ? goalTemplates.filter((template) => !THANK_YOU_IDS.has(template.id)) : [];
  }
  if (goal === "sell") {
    if (stepType === "thank_you_page") return goalTemplates.filter((template) => THANK_YOU_IDS.has(template.id));
    // Only the order-form step binds a product and has a checkout path; on sales_page, upsell or downsell the
    // offer card could never take payment and would show the merchant's "not bound" notice to visitors.
    return stepType === "order_form" ? goalTemplates.filter((template) => !THANK_YOU_IDS.has(template.id)) : [];
  }
  return [];
}

/** 預設圖片占位檔；實體檔案位於 public/placeholder.svg。 */
export const FUNNEL_PLACEHOLDER_IMAGE_SRC = "/placeholder.svg";

function buildTemplateDocument(template: FunnelTemplateGalleryItem, prefix: string, pageId?: string): PageDocument {
  const empty = createEmptyPageDocument(pageId ?? `${prefix}_page`, template.name);
  const settings = {
    ...empty.settings,
    typography: { ...empty.settings.typography, ...FUNNEL_TEMPLATE_TYPOGRAPHY, ...template.theme?.typography },
    background: { ...empty.settings.background, ...template.theme?.background },
    ...template.pageSettings,
  };
  const document = parsePageDocument({ ...empty, settings, root: template.build(prefix) });
  if (!document) throw new Error(`一頁式網站模板無法通過 PageDocument 驗證：${template.id}`);
  return document;
}

/** Build a fresh, validated PageDocument. 節點 ID 每次呼叫都唯一，只可在套用（事件處理）時呼叫，不可用於 render。 */
export function instantiateFunnelTemplate(templateId: string, pageId?: string): PageDocument {
  const template = getFunnelTemplateGalleryItem(templateId);
  if (!template) throw new Error(`找不到一頁式網站模板：${templateId}`);
  return buildTemplateDocument(template, nextPrefix(template.id), pageId);
}

/** 預覽專用：節點 ID 只由模板 ID 決定，伺服器與瀏覽器 render 結果一致，避免 hydration 不符。 */
export function previewFunnelTemplate(templateId: string, pageId?: string): PageDocument {
  const template = getFunnelTemplateGalleryItem(templateId);
  if (!template) throw new Error(`找不到一頁式網站模板：${templateId}`);
  const prefix = `gallery_${template.id}_preview`;
  return buildTemplateDocument(template, prefix, pageId ?? `${prefix}_page`);
}
