import {
  FUNNEL_CAPABILITIES,
  createEmptyPageDocument,
  parsePageDocument,
  type FunnelNode,
  type FunnelNodeAction,
  type FunnelNodeType,
  type PageDocument,
} from "@/lib/funnel-page-document";

export const FUNNEL_TEMPLATE_GOALS = ["sell", "audience", "custom"] as const;
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
};

const node = (
  prefix: string,
  id: string,
  type: FunnelNodeType,
  props: Record<string, unknown> = {},
  children?: FunnelNode[],
  style: FunnelNode["style"] = {},
  actions: FunnelNodeAction[] = [],
): FunnelNode => ({
  schemaVersion: 1,
  id: `${prefix}_${id}`,
  type,
  props,
  style,
  overrides: {},
  visible: true,
  actions,
  attributes: {},
  ...(children ? { children } : {}),
});

const text = (prefix: string, id: string, value: string, style: FunnelNode["style"] = {}) =>
  node(prefix, id, "text", { text: value }, undefined, style);
const headline = (prefix: string, id: string, value: string, level: "h1" | "h2" | "h3" = "h2") =>
  node(prefix, id, "headline", { text: value, level });
const button = (prefix: string, id: string, label: string, action: FunnelNodeAction) =>
  node(prefix, id, "button", { label }, undefined, { borderRadius: 8 }, [action]);
const image = (prefix: string, id: string, alt: string) =>
  node(prefix, id, "image", { src: "/placeholder.svg", alt, objectFit: "cover" }, undefined, { imageWidth: 100, borderRadius: 12 });
const box = (prefix: string, id: string, children: FunnelNode[]) => node(prefix, id, "content_box", {}, children, { padding: 24, borderRadius: 12 });
const columns = (prefix: string, id: string, children: FunnelNode[], count: 2 | 3 = 2) =>
  node(prefix, id, count === 3 ? "columns_3" : "columns_2", { gap: 24 }, children);
const section = (prefix: string, id: string, children: FunnelNode[], backgroundColor?: string) =>
  node(prefix, id, "section", {}, [node(prefix, `${id}_row`, "row", { maxWidth: 1120 }, children)], { padding: 56, ...(backgroundColor ? { backgroundColor } : {}) });
const list = (prefix: string, id: string, items: string[]) => node(prefix, id, "bulleted_list", { items });

const form = (prefix: string, id: string, heading: string, buttonLabel: string) => {
  const formId = `${prefix}_${id}`;
  return node(prefix, id, "form", { variant: "opt-in" }, [
    text(prefix, `${id}_title`, heading, { fontSize: 24, lineHeight: 1.25 }),
    node(prefix, `${id}_name`, "form_input", { inputType: "text", label: "姓名", placeholder: "請輸入姓名" }),
    node(prefix, `${id}_email`, "form_input", { inputType: "email", label: "電子信箱", placeholder: "name@example.com" }),
    node(prefix, `${id}_consent`, "checkbox", { label: "我同意接收本活動相關資訊", required: true }),
    button(prefix, `${id}_submit`, buttonLabel, { type: "submit_form", formId }),
  ], { padding: 24, borderRadius: 12 });
};

const limitedPayment = {
  capabilityStatus: FUNNEL_CAPABILITIES.payment.status,
  capabilityReason: FUNNEL_CAPABILITIES.payment.reason,
  disabled: true,
};

const checkout = (prefix: string, compact = false) => [
  section(prefix, "checkout", [columns(prefix, "checkout_columns", [
    node(prefix, "customer", "form", { variant: "checkout-contact" }, [
      text(prefix, "customer_title", compact ? "聯絡資料" : "完成訂購資料", { fontSize: 28, lineHeight: 1.2 }),
      node(prefix, "customer_name", "form_input", { inputType: "text", label: "姓名" }),
      node(prefix, "customer_email", "form_input", { inputType: "email", label: "電子信箱" }),
      text(prefix, "customer_notice", "付款功能尚未連結商品與金流，現在不會送出付款或建立訂單。"),
    ]),
    node(prefix, "order", "form", { variant: "checkout-summary", ...limitedPayment }, [
      text(prefix, "order_title", "方案摘要", { fontSize: 28, lineHeight: 1.2 }),
      text(prefix, "order_name", compact ? "你的精選方案" : "CelebrateDeal 成長方案"),
      node(prefix, "order_price", "offer_price", limitedPayment),
      node(prefix, "payment_method", "payment_method", limitedPayment),
      node(prefix, "payment_button", "payment_button", { ...limitedPayment, label: "付款功能尚未啟用" }),
    ]),
  ])], compact ? "white" : "#fff7ed"),
  section(prefix, "trust", [columns(prefix, "trust_columns", [
    box(prefix, "support", [headline(prefix, "support_title", "有問題嗎？", "h3"), text(prefix, "support_text", "請先聯絡客服確認方案與付款方式。")]),
    box(prefix, "promise", [headline(prefix, "promise_title", "安心確認", "h3"), text(prefix, "promise_text", "正式付款啟用前，所有付款欄位都維持停用。")]),
  ])]),
];

const subscription = (prefix: string) => [
  section(prefix, "hero", [columns(prefix, "hero_columns", [
    box(prefix, "hero_copy", [
      text(prefix, "eyebrow", "內容訂閱計畫"),
      headline(prefix, "hero_title", "讓好內容陪你持續成長", "h1"),
      text(prefix, "hero_text", "每週整理實作方法、案例與行動清單，幫你穩定推進。"),
      list(prefix, "hero_list", ["每週主題內容", "可重複使用的工作表", "會員限定交流"]),
    ]),
    node(prefix, "plan", "form", { variant: "subscription-summary", ...limitedPayment }, [
      text(prefix, "plan_title", "每月內容方案", { fontSize: 28, lineHeight: 1.2 }),
      text(prefix, "plan_price", "NT$ 方案價格待設定"),
      node(prefix, "plan_offer", "offer_price", limitedPayment),
      node(prefix, "plan_payment", "payment_method", limitedPayment),
      node(prefix, "plan_button", "payment_button", { ...limitedPayment, label: "訂閱付款尚未啟用" }),
    ]),
  ])], "#fffbeb"),
  section(prefix, "bonus", [headline(prefix, "bonus_title", "訂閱加值內容"), columns(prefix, "bonus_columns", [
    box(prefix, "bonus_one", [headline(prefix, "bonus_one_title", "範本資料庫", "h3"), text(prefix, "bonus_one_text", "直接套用常見行銷與內容範本。")]),
    box(prefix, "bonus_two", [headline(prefix, "bonus_two_title", "每月回顧", "h3"), text(prefix, "bonus_two_text", "用簡單方法整理成果與下一步。")]),
  ])]),
];

const audiencePage = (prefix: string, variant: "volunteer" | "charity" | "environment") => {
  const copy = {
    volunteer: { eyebrow: "志工招募", title: "一起把時間變成真正的改變", intro: "加入在地志工團隊，找到適合你的參與方式。", cta: "我要加入志工", theme: "#eff6ff" },
    charity: { eyebrow: "公益活動", title: "每一次參與，都能讓社區更靠近希望", intro: "掌握近期活動與服務消息，一起支持需要被看見的人。", cta: "收到活動通知", theme: "#fdf2f8" },
    environment: { eyebrow: "環境倡議", title: "守護土地，從今天的一個選擇開始", intro: "關注棲地、減塑與公民行動，把關心變成可持續的力量。", cta: "加入倡議名單", theme: "#ecfdf5" },
  }[variant];
  return [
    section(prefix, "header", [headline(prefix, "brand", "CelebrateDeal 公益行動", "h2"), node(prefix, "menu", "menu", { items: [{ label: "關於行動", href: "#about" }, { label: "參與方式", href: "#join" }, { label: "常見問題", href: "#faq" }] })]),
    section(prefix, "hero", [columns(prefix, "hero_columns", [
      box(prefix, "hero_copy", [text(prefix, "eyebrow", copy.eyebrow), headline(prefix, "hero_title", copy.title, "h1"), text(prefix, "hero_intro", copy.intro), image(prefix, "hero_image", `${copy.eyebrow}主視覺`)]),
      form(prefix, "hero_form", "留下聯絡方式", copy.cta),
    ])], copy.theme),
    section(prefix, "impact", [headline(prefix, "impact_title", "我們正在推進的事"), columns(prefix, "impact_columns", [
      box(prefix, "impact_one", [headline(prefix, "impact_one_title", "在地連結", "h3"), text(prefix, "impact_one_text", "串連社群夥伴，把資源送到真正需要的地方。")]),
      box(prefix, "impact_two", [headline(prefix, "impact_two_title", "透明行動", "h3"), text(prefix, "impact_two_text", "定期分享進度與成果，讓每份支持都有跡可循。")]),
      box(prefix, "impact_three", [headline(prefix, "impact_three_title", "長期陪伴", "h3"), text(prefix, "impact_three_text", "以可持續的方法累積影響，而非一次性的熱度。")]),
    ], 3)]),
    section(prefix, "faq", [headline(prefix, "faq_title", "常見問題"), node(prefix, "faq_list", "faq", { items: [
      { question: "需要具備經驗嗎？", answer: "不需要，我們會依參與方式提供清楚說明。" },
      { question: "留下資料後會發生什麼？", answer: "你會收到活動資訊，不會觸發付款或正式寄信測試。" },
    ] }, [])]),
    section(prefix, "footer", [text(prefix, "footer_text", "© CelebrateDeal 公益行動。聯絡資訊與隱私說明皆可自行編輯。")]),
  ];
};

const legalPage = (prefix: string, kind: "privacy" | "terms") => {
  const privacy = kind === "privacy";
  return [section(prefix, "legal", [box(prefix, "legal_content", [
    headline(prefix, "legal_title", privacy ? "隱私權政策" : "服務條款", "h1"),
    text(prefix, "legal_updated", "最後更新日期：請在發布前填寫"),
    headline(prefix, "legal_scope_title", privacy ? "我們如何處理資料" : "服務使用範圍", "h2"),
    text(prefix, "legal_scope_text", privacy ? "此範本提供可編輯的基本章節，發布前應由負責人依實際資料流程與法規完成審閱。" : "此範本提供可編輯的基本章節，發布前應依實際服務內容與權利義務完成審閱。"),
    headline(prefix, "legal_rights_title", privacy ? "你的權利" : "使用者責任", "h2"),
    text(prefix, "legal_rights_text", privacy ? "你可以聯絡服務提供者提出查詢、更正或刪除請求。請補上正式聯絡方式。" : "使用者應提供正確資料並遵守適用規範。請補上完整責任與終止條款。"),
    headline(prefix, "legal_contact_title", "聯絡方式", "h2"),
    text(prefix, "legal_contact_text", "請在發布前填入正式公司名稱、地址與聯絡管道。"),
  ])])];
};

const brandInfo = (prefix: string) => [
  section(prefix, "header", [headline(prefix, "brand", "CelebrateDeal", "h2"), node(prefix, "menu", "menu", { items: [{ label: "品牌故事", href: "#story" }, { label: "服務原則", href: "#principles" }, { label: "聯絡我們", href: "#contact" }] })]),
  section(prefix, "hero", [columns(prefix, "hero_columns", [box(prefix, "hero_copy", [headline(prefix, "hero_title", "讓值得慶祝的成果，被更多人看見", "h1"), text(prefix, "hero_text", "用清楚、可信任的資訊，介紹品牌使命與服務方式。")]), image(prefix, "hero_image", "品牌故事主視覺")])], "#f8fafc"),
  section(prefix, "principles", [headline(prefix, "principles_title", "我們重視的事"), columns(prefix, "principles_columns", [
    box(prefix, "principle_one", [headline(prefix, "principle_one_title", "清楚", "h3"), text(prefix, "principle_one_text", "重要資訊以自然、容易理解的方式呈現。")]),
    box(prefix, "principle_two", [headline(prefix, "principle_two_title", "負責", "h3"), text(prefix, "principle_two_text", "功能限制與資料用途都明確說明。")]),
    box(prefix, "principle_three", [headline(prefix, "principle_three_title", "同行", "h3"), text(prefix, "principle_three_text", "陪伴團隊把每個想法落實成下一步。")]),
  ], 3)]),
  section(prefix, "contact", [headline(prefix, "contact_title", "想進一步認識我們？"), button(prefix, "contact_button", "聯絡 CelebrateDeal", { type: "open_url", href: "#contact", newTab: false })]),
];

const availableReason = "依 systeme.io 實測模板族建立，可展開為獨立編輯節點";
const limitedReason = "版面可編輯；付款元件維持 limited 與 disabled，不建立假的付款完成流程";

const templates: FunnelTemplateGalleryItem[] = [
  { id: "sell-product-checkout", referenceId: "25969", goal: "sell", category: "商品結帳", name: "暖色商品結帳", description: "地址與聯絡資料、方案摘要、付款限制提示及信任區塊。", status: "limited", statusReason: limitedReason, preview: { eyebrow: "Sell", headline: "暖色商品結帳", summary: "雙欄結帳與信任資訊", palette: ["#fff7ed", "#9a3412", "#ffffff"], sectionCount: 2 }, build: (prefix) => checkout(prefix) },
  { id: "sell-simple-checkout", referenceId: "25963", goal: "sell", category: "簡潔結帳", name: "藍白簡潔結帳", description: "精簡的聯絡資料與訂單摘要雙欄結構。", status: "limited", statusReason: limitedReason, preview: { eyebrow: "Sell", headline: "藍白簡潔結帳", summary: "聚焦轉換的精簡版面", palette: ["#ffffff", "#2563eb", "#eff6ff"], sectionCount: 2 }, build: (prefix) => checkout(prefix, true) },
  { id: "sell-content-subscription", referenceId: "25957", goal: "sell", category: "內容訂閱", name: "內容訂閱方案", description: "訂閱價值、方案卡與 bonus 內容；付款仍維持限制狀態。", status: "limited", statusReason: limitedReason, preview: { eyebrow: "Sell", headline: "內容訂閱方案", summary: "方案卡與加值內容", palette: ["#fffbeb", "#a16207", "#ffffff"], sectionCount: 2 }, build: subscription },
  { id: "audience-volunteer", referenceId: "26050", goal: "audience", category: "志工招募", name: "在地志工招募", description: "導覽、招募 Hero、名單表單、影響力與 FAQ 長頁。", status: "available", statusReason: availableReason, preview: { eyebrow: "Audience", headline: "在地志工招募", summary: "溫暖的社群招募長頁", palette: ["#eff6ff", "#1d4ed8", "#ffffff"], sectionCount: 5 }, build: (prefix) => audiencePage(prefix, "volunteer") },
  { id: "audience-charity-event", referenceId: "26049", goal: "audience", category: "公益活動", name: "公益活動名單", description: "公益活動訊息、參與表單、行動成果與常見問題。", status: "available", statusReason: availableReason, preview: { eyebrow: "Audience", headline: "公益活動名單", summary: "活動資訊與兩階段溝通入口", palette: ["#fdf2f8", "#be185d", "#ffffff"], sectionCount: 5 }, build: (prefix) => audiencePage(prefix, "charity") },
  { id: "audience-environment", referenceId: "26048", goal: "audience", category: "環境倡議", name: "環境倡議行動", description: "環境議題 Hero、倡議名單、成果卡與 FAQ。", status: "available", statusReason: availableReason, preview: { eyebrow: "Audience", headline: "環境倡議行動", summary: "自然色系的倡議長頁", palette: ["#ecfdf5", "#047857", "#ffffff"], sectionCount: 5 }, build: (prefix) => audiencePage(prefix, "environment") },
  { id: "custom-privacy", referenceId: "3012", goal: "custom", category: "隱私", name: "隱私權政策", description: "可編輯的隱私資料處理、權利與聯絡章節。", status: "available", statusReason: availableReason, preview: { eyebrow: "Custom", headline: "隱私權政策", summary: "簡潔的法務純文字版面", palette: ["#ffffff", "#0f172a", "#e2e8f0"], sectionCount: 1 }, build: (prefix) => legalPage(prefix, "privacy") },
  { id: "custom-terms", referenceId: "3011", goal: "custom", category: "條款", name: "服務條款", description: "可編輯的服務範圍、使用者責任與聯絡章節。", status: "available", statusReason: availableReason, preview: { eyebrow: "Custom", headline: "服務條款", summary: "簡潔的條款純文字版面", palette: ["#ffffff", "#1e293b", "#cbd5e1"], sectionCount: 1 }, build: (prefix) => legalPage(prefix, "terms") },
  { id: "custom-brand-info", referenceId: "3010", goal: "custom", category: "品牌資訊", name: "品牌資訊頁", description: "含導覽、Hero、品牌原則與聯絡行動的資訊頁。", status: "available", statusReason: availableReason, preview: { eyebrow: "Custom", headline: "品牌資訊頁", summary: "品牌化導覽與分段內容", palette: ["#f8fafc", "#7c3aed", "#ffffff"], sectionCount: 4 }, build: brandInfo },
];

export const FUNNEL_TEMPLATE_GALLERY: readonly FunnelTemplateGalleryItem[] = Object.freeze(templates);

let instanceSequence = 0;
function nextPrefix(templateId: string): string {
  instanceSequence += 1;
  return `gallery_${templateId}_${Date.now().toString(36)}_${instanceSequence}`;
}

export function getFunnelTemplateGalleryItem(templateId: string): FunnelTemplateGalleryItem | null {
  return FUNNEL_TEMPLATE_GALLERY.find((template) => template.id === templateId) ?? null;
}

export function listFunnelTemplateGallery(goal?: FunnelTemplateGoal): readonly FunnelTemplateGalleryItem[] {
  return goal ? FUNNEL_TEMPLATE_GALLERY.filter((template) => template.goal === goal) : FUNNEL_TEMPLATE_GALLERY;
}

/** Build a fresh, validated PageDocument. No template object or node reference is shared. */
export function instantiateFunnelTemplate(templateId: string, pageId?: string): PageDocument {
  const template = getFunnelTemplateGalleryItem(templateId);
  if (!template) throw new Error(`找不到 Funnel template：${templateId}`);
  const prefix = nextPrefix(template.id);
  const empty = createEmptyPageDocument(pageId ?? `${prefix}_page`, template.name);
  const document = parsePageDocument({ ...empty, root: template.build(prefix) });
  if (!document) throw new Error(`Funnel template 無法通過 PageDocument 驗證：${template.id}`);
  return document;
}
