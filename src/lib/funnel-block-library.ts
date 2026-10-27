import {
  FUNNEL_BLOCK_CATEGORIES,
  FUNNEL_CAPABILITIES,
  createEmptyPageDocument,
  parsePageDocument,
  type FunnelBlockCategory,
  type FunnelNode,
  type FunnelNodeAction,
  type FunnelNodeType,
  type PageDocument,
} from "@/lib/funnel-page-document";

import { buildLuxuryCourseSection, type LuxuryCourseSectionName } from "@/lib/funnel-template-luxury-course";

export { FUNNEL_BLOCK_CATEGORIES } from "@/lib/funnel-page-document";
export type { FunnelBlockCategory } from "@/lib/funnel-page-document";

/**
 * A reusable block is a factory instead of a persisted HTML snippet.  Each
 * invocation creates a fresh, editable Section › Row › children node tree
 * that can be merged into a PageDocument root without sharing references.
 */
export interface FunnelBlockTemplate {
  id: string;
  category: FunnelBlockCategory;
  label: string;
  description: string;
  /** Number of variants registered in this block's category. */
  variantCount: number;
  capability?: typeof FUNNEL_CAPABILITIES.payment;
  factory: (instanceId: string) => FunnelNode;
}

export interface FunnelBlockCategoryMetadata {
  id: FunnelBlockCategory;
  label: string;
  description: string;
  variantCount: number;
}

/** Shared folder of the generic SVG illustrations shipped in `public/`. */
export const FUNNEL_ILLUSTRATION_BASE = "/funnel-illustrations";
export const FUNNEL_ILLUSTRATIONS = {
  heroWorkspace: `${FUNNEL_ILLUSTRATION_BASE}/hero-workspace.svg`,
  heroCommunity: `${FUNNEL_ILLUSTRATION_BASE}/hero-community.svg`,
  heroLearning: `${FUNNEL_ILLUSTRATION_BASE}/hero-learning.svg`,
  heroNature: `${FUNNEL_ILLUSTRATION_BASE}/hero-nature.svg`,
  avatarA: `${FUNNEL_ILLUSTRATION_BASE}/avatar-a.svg`,
  avatarB: `${FUNNEL_ILLUSTRATION_BASE}/avatar-b.svg`,
  avatarC: `${FUNNEL_ILLUSTRATION_BASE}/avatar-c.svg`,
  iconSpark: `${FUNNEL_ILLUSTRATION_BASE}/icon-spark.svg`,
  iconLayers: `${FUNNEL_ILLUSTRATION_BASE}/icon-layers.svg`,
  iconChart: `${FUNNEL_ILLUSTRATION_BASE}/icon-chart.svg`,
  iconHeart: `${FUNNEL_ILLUSTRATION_BASE}/icon-heart.svg`,
} as const;

/** Colour pairs below are checked for WCAG AA in `funnel-block-library.test.ts`. */
export const FUNNEL_BLOCK_PALETTE = {
  ink: "#0f172a", body: "#334155", muted: "#475569", line: "#e2e8f0", white: "#ffffff", soft: "#f8fafc",
  blueSoft: "#eff6ff", blue: "#1d4ed8", blueDeep: "#1e3a8a", blueMist: "#dbeafe", amber: "#f59e0b",
  warm: "#fff7ed", warmInk: "#9a3412", greenSoft: "#ecfdf5", green: "#047857", night: "#0f172a", nightMuted: "#cbd5e1",
} as const;
const C = FUNNEL_BLOCK_PALETTE;

type Style = FunnelNode["style"];

const node = (
  type: FunnelNodeType,
  id: string,
  props: Record<string, unknown> = {},
  children?: FunnelNode[],
  style: Style = {},
  actions: FunnelNodeAction[] = [],
  mobileStyle?: Style,
): FunnelNode => ({
  schemaVersion: 1,
  id,
  type,
  props,
  style,
  overrides: mobileStyle ? { mobile: { style: mobileStyle } } : {},
  visible: true,
  actions,
  attributes: {},
  ...(children ? { children } : {}),
});

type SectionOptions = { background?: string; color?: string; align?: "left" | "center"; paddingY?: number; paddingYMobile?: number; maxWidth?: number; gap?: number };

/** Section › Row with responsive vertical rhythm (desktop / mobile padding). */
const section = (id: string, children: FunnelNode[], options: SectionOptions = {}) => {
  const { background, color, align, paddingY = 88, paddingYMobile = 56, maxWidth = 1120, gap = 24 } = options;
  const style: Style = { padding: `${paddingY}px 32px` };
  if (background) style.backgroundColor = background;
  if (color) style.color = color;
  if (align) style.textAlign = align;
  return node("section", id, { fullWidth: true }, [node("row", `${id}-row`, { maxWidth, gap }, children)], style, [], { padding: `${paddingYMobile}px 20px` });
};

const heading = (id: string, content: string, level: "h1" | "h2" | "h3" | "h4" = "h2", style: Style = {}) =>
  node("headline", id, { text: content, level }, undefined, style);
const paragraph = (id: string, content: string, textStyle: "body" | "lead" | "small" = "body", style: Style = {}) =>
  node("text", id, textStyle === "body" ? { text: content } : { text: content, textStyle }, undefined, style);
const eyebrow = (id: string, content: string, color?: string) =>
  node("text", id, { text: content, textStyle: "eyebrow" }, undefined, color ? { color } : {});
const list = (id: string, items: string[], style: Style = {}) => node("bulleted_list", id, { items }, undefined, style);

type ButtonTone = "amber" | "blue" | "dark" | "light";
const BUTTON_TONES: Readonly<Record<ButtonTone, Style>> = {
  amber: { backgroundColor: C.amber, color: C.ink },
  blue: { backgroundColor: C.blue, color: C.white },
  dark: { backgroundColor: C.ink, color: C.white },
  light: { backgroundColor: C.white, color: C.ink },
};
const button = (id: string, label: string, tone: ButtonTone = "amber", action: FunnelNodeAction = { type: "open_url", href: "#signup", newTab: false }, extra: Style = {}) =>
  node("button", id, { label, variant: "primary" }, undefined, { ...BUTTON_TONES[tone], borderRadius: 10, ...extra }, [action]);

type CardOptions = { background?: string; border?: string; color?: string; padding?: number; radius?: number; shadow?: Style["shadow"]; align?: "left" | "center" };
const card = (id: string, children: FunnelNode[], options: CardOptions = {}) => {
  const { background = C.white, border = C.line, color, padding = 28, radius = 16, shadow = "soft", align } = options;
  const style: Style = { backgroundColor: background, borderColor: border, borderWidth: 1, borderRadius: radius, padding, shadow };
  if (color) style.color = color;
  if (align) style.textAlign = align;
  return node("content_box", id, { gap: 14 }, children, style, [], { padding: Math.min(padding, 22) });
};
/** Content box without chrome, used to group a column's children. */
const stack = (id: string, children: FunnelNode[], style: Style = {}) => node("content_box", id, { gap: 18 }, children, { padding: 0, ...style });

const image = (id: string, src: string, alt: string, style: Style = {}) =>
  node("image", id, { src, alt }, undefined, { imageWidth: 100, borderRadius: 20, ...style });
const avatar = (id: string, src: string, alt: string, centered = false) =>
  node("image", id, { src, alt }, undefined, { width: "72px", imageWidth: 100, borderRadius: 500, ...(centered ? { margin: "0 auto" } : {}) });
const icon = (id: string, src: string, centered = false) =>
  node("image", id, { src, alt: "" }, undefined, { width: "56px", imageWidth: 100, borderRadius: 14, ...(centered ? { margin: "0 auto" } : {}) });

const columns = (id: string, children: FunnelNode[], count: 2 | 3 | 4 = 2, options: { gap?: number; align?: Style["align"] } = {}) =>
  node(count === 4 ? "columns_4" : count === 3 ? "columns_3" : "columns_2", id, { gap: options.gap ?? (count === 2 ? 48 : 24) }, children, options.align ? { align: options.align } : {});

/**
 * Forms may only sit directly in a row or column, so the "card" look lives on
 * the form node itself. Titles stay outside the form: a public page replaces
 * the form's children with the server-verified registration fields.
 */
const optInForm = (id: string, options: { submit: string; tone?: ButtonTone; consent?: boolean; nameField?: boolean; card?: CardOptions }) => {
  const { background = C.white, border = C.line, color, padding = 28, radius = 16, shadow = "medium" } = options.card ?? {};
  const style: Style = options.card ? { backgroundColor: background, borderColor: border, borderWidth: 1, borderRadius: radius, padding, shadow, textAlign: "left", ...(color ? { color } : {}) } : {};
  return node("form", id, { variant: "opt-in" }, [
    ...(options.nameField === false ? [] : [node("form_input", `${id}-name`, { inputType: "text", label: "姓名", placeholder: "請輸入姓名" })]),
    node("form_input", `${id}-email`, { inputType: "email", label: "電子信箱", placeholder: "name@example.com", required: true }),
    ...(options.consent === false ? [] : [node("checkbox", `${id}-consent`, { label: "我同意依本頁說明接收相關資訊", required: true })]),
    button(`${id}-submit`, options.submit, options.tone ?? "amber", { type: "submit_form", formId: id }, { width: 100 }),
  ], style, [], options.card ? { padding: Math.min(padding, 22) } : undefined);
};

const menu = (id: string, items: Array<[string, string]>, style: Style = {}) =>
  node("menu", id, { items: items.map(([label, href]) => ({ label, href })) }, undefined, style);

const limitedPayment = {
  capabilityStatus: FUNNEL_CAPABILITIES.payment.status,
  capabilityReason: FUNNEL_CAPABILITIES.payment.reason,
  disabled: true,
};

type BlockFactory = (instanceId: string) => FunnelNode;
type BlockDefinition = { id: string; category: FunnelBlockCategory; label: string; description: string; factory: BlockFactory; capability?: typeof FUNNEL_CAPABILITIES.payment };

/* ------------------------------ 訂購表單 ------------------------------ */

const orderSummary = (id: string) => card(`${id}-summary`, [
  image(`${id}-product-image`, FUNNEL_ILLUSTRATIONS.heroLearning, "方案示意圖", { borderRadius: 12 }),
  eyebrow(`${id}-summary-eyebrow`, "方案摘要"),
  heading(`${id}-summary-title`, "完成你的方案訂購", "h3"),
  paragraph(`${id}-summary-copy`, "可編輯的方案摘要。正式收款前，請先在步驟設定中綁定商品與付款方式。", "small", { color: C.muted }),
  list(`${id}-summary-list`, ["立即取得完整內容", "會員專屬支援", "付款由既有安全結帳處理"]),
]);
const orderFormFields = (id: string) => node("form", `${id}-form`, { variant: "two-step-order", ...limitedPayment }, [
  paragraph(`${id}-form-title`, "訂購資料", "lead", { color: C.ink }),
  node("form_input", `${id}-first-name`, { inputType: "text", label: "姓名", placeholder: "請輸入姓名" }),
  node("form_input", `${id}-email`, { inputType: "email", label: "電子信箱", placeholder: "name@example.com" }),
  node("offer_price", `${id}-offer-price`, limitedPayment),
  node("payment_method", `${id}-payment-method`, limitedPayment),
  node("payment_button", `${id}-payment-button`, { label: "前往安全付款", ...limitedPayment }),
], { backgroundColor: C.white, borderColor: C.line, borderWidth: 1, borderRadius: 16, padding: 28, shadow: "medium" }, [], { padding: 20 });

const orderFormSplit: BlockFactory = (id) => section(id, [columns(`${id}-columns`, [orderSummary(id), orderFormFields(id)], 2, { gap: 32 })], { background: C.soft });
const orderFormStacked: BlockFactory = (id) => section(id, [
  heading(`${id}-title`, "確認方案並完成訂購", "h2"),
  paragraph(`${id}-intro`, "填寫聯絡資料後，系統會帶你前往安全結帳頁完成付款。", "lead", { color: C.muted }),
  orderFormFields(id),
], { align: "center", maxWidth: 640, background: C.blueSoft });

/* ------------------------------ 名單表單 ------------------------------ */

const optInSplit: BlockFactory = (id) => section(id, [columns(`${id}-columns`, [
  stack(`${id}-copy`, [
    eyebrow(`${id}-eyebrow`, "免費資源"),
    heading(`${id}-headline`, "把好點子整理成下一步行動", "h2"),
    paragraph(`${id}-text`, "留下聯絡方式，取得一份清楚好用的實作指南，陪你整理目標、內容與流程。", "lead", { color: C.body }),
    list(`${id}-list`, ["一步一步的操作清單", "可直接套用的範例", "隨時可以取消訂閱"]),
  ]),
  optInForm(`${id}-form`, { submit: "免費寄給我", card: { padding: 32 } }),
], 2, { align: "center" })], { background: C.blueSoft });

const optInCentered: BlockFactory = (id) => section(id, [
  eyebrow(`${id}-eyebrow`, "訂閱電子報"),
  heading(`${id}-headline`, "每週一封，收到最實用的整理", "h2"),
  paragraph(`${id}-text`, "精選方法與案例，三分鐘就能讀完。", "lead", { color: C.muted }),
  optInForm(`${id}-form`, { submit: "免費訂閱", tone: "blue", card: { shadow: "soft" } }),
], { align: "center", maxWidth: 560 });

const optInDark: BlockFactory = (id) => section(id, [columns(`${id}-columns`, [
  stack(`${id}-copy`, [
    eyebrow(`${id}-eyebrow`, "名額開放通知", C.amber),
    heading(`${id}-headline`, "第一時間收到開放通知", "h2", { color: C.white }),
    paragraph(`${id}-text`, "名額開放時會先通知名單上的朋友，不會寄送與活動無關的內容。", "lead", { color: C.nightMuted }),
  ]),
  optInForm(`${id}-form`, { submit: "加入通知名單", card: { shadow: "strong", border: C.white, color: C.ink } }),
], 2, { align: "center" })], { background: C.night, color: C.white });

const optInImage: BlockFactory = (id) => section(id, [
  heading(`${id}-headline`, "下載免費工作表", "h2"),
  paragraph(`${id}-text`, "只要填寫電子信箱，就能收到可列印的工作表。", "lead", { color: C.muted }),
  columns(`${id}-columns`, [
    image(`${id}-image`, FUNNEL_ILLUSTRATIONS.heroWorkspace, "工作表封面示意圖"),
    optInForm(`${id}-form`, { submit: "立即下載", nameField: false, card: { background: C.soft, shadow: "none" } }),
  ], 2, { align: "center" }),
], { align: "center", maxWidth: 960 });

/* ------------------------------ 特色介紹 ------------------------------ */

const featureCards: BlockFactory = (id) => {
  const items = [
    [FUNNEL_ILLUSTRATIONS.iconSpark, "快速上手", "清楚的步驟說明，今天就能開始，不需要技術背景。"],
    [FUNNEL_ILLUSTRATIONS.iconLayers, "彈性編輯", "文字、圖片與按鈕都能獨立調整，桌機與手機各自設定。"],
    [FUNNEL_ILLUSTRATIONS.iconChart, "持續優化", "保留每一次修改，隨時調整內容並觀察成效。"],
  ] as const;
  return section(id, [
    eyebrow(`${id}-eyebrow`, "為什麼選擇我們"),
    heading(`${id}-headline`, "三個讓工作更輕鬆的理由", "h2"),
    paragraph(`${id}-intro`, "從規劃到上線，每一步都替你想好了。", "lead", { color: C.muted }),
    columns(`${id}-columns`, items.map(([src, title, copy], index) => card(`${id}-feature-${index + 1}`, [
      icon(`${id}-feature-${index + 1}-icon`, src),
      heading(`${id}-feature-${index + 1}-title`, title, "h3"),
      paragraph(`${id}-feature-${index + 1}-copy`, copy, "body", { color: C.body }),
    ], { align: "left" })), 3),
  ], { align: "center", background: C.soft });
};

const featureImageList: BlockFactory = (id) => section(id, [columns(`${id}-columns`, [
  image(`${id}-image`, FUNNEL_ILLUSTRATIONS.heroWorkspace, "產品功能示意圖"),
  stack(`${id}-copy`, [
    eyebrow(`${id}-eyebrow`, "核心功能"),
    heading(`${id}-headline`, "所有需要的工具，集中在同一個地方", "h2"),
    paragraph(`${id}-text`, "不用在多個服務之間切換，從內容、名單到後續追蹤一次完成。", "body", { color: C.body }),
    list(`${id}-list`, ["拖放式頁面編輯", "名單與表單整合", "桌機與手機分別預覽"]),
    button(`${id}-cta`, "了解更多", "blue"),
  ]),
], 2, { align: "center" })]);

const featureFourSteps: BlockFactory = (id) => {
  const steps = [["01", "設定目標", "先想清楚這一頁要帶來什麼結果。"], ["02", "整理內容", "用區塊快速排出段落與重點。"], ["03", "收集名單", "放上表單，讓有興趣的人留下資料。"], ["04", "持續調整", "依回饋修改文案與版面。"]] as const;
  return section(id, [
    heading(`${id}-headline`, "四個步驟完成你的頁面", "h2"),
    columns(`${id}-columns`, steps.map(([number, title, copy], index) => stack(`${id}-step-${index + 1}`, [
      node("text", `${id}-step-${index + 1}-number`, { text: number, textStyle: "eyebrow" }, undefined, { color: C.blue, fontSize: 28, letterSpacing: 0 }),
      heading(`${id}-step-${index + 1}-title`, title, "h4"),
      paragraph(`${id}-step-${index + 1}-copy`, copy, "small", { color: C.muted }),
    ])), 4, { gap: 28 }),
  ], { maxWidth: 1120, gap: 36 });
};

const featureHighlight: BlockFactory = (id) => {
  const items = [["入門", "適合剛開始的你，先掌握最重要的觀念。"], ["進階", "最多人選擇：搭配實作練習與回饋。"], ["深入", "完整拆解流程，打造自己的系統。"]] as const;
  return section(id, [
    heading(`${id}-headline`, "選擇適合你的學習路線", "h2"),
    columns(`${id}-columns`, items.map(([title, copy], index) => card(`${id}-item-${index + 1}`, [
      heading(`${id}-item-${index + 1}-title`, title, "h3", index === 1 ? { color: C.white } : {}),
      paragraph(`${id}-item-${index + 1}-copy`, copy, "body", index === 1 ? { color: C.blueMist } : { color: C.body }),
    ], index === 1 ? { background: C.blue, border: C.blue, shadow: "strong" } : {})), 3),
  ], { align: "center" });
};

/* ------------------------------ 頁尾 ------------------------------ */

const footerColumns: BlockFactory = (id) => section(id, [columns(`${id}-columns`, [
  stack(`${id}-brand`, [heading(`${id}-brand-title`, "你的品牌", "h4", { color: C.white }), paragraph(`${id}-brand-copy`, "一句話說明品牌理念與服務對象。", "small", { color: C.nightMuted })]),
  menu(`${id}-menu`, [["首頁", "#top"], ["關於我們", "#about"], ["聯絡我們", "#contact"]], { color: C.nightMuted }),
  stack(`${id}-contact`, [paragraph(`${id}-contact-title`, "聯絡方式", "small", { color: C.white, fontSize: 14 }), paragraph(`${id}-contact-copy`, "請填入客服信箱與服務時間。", "small", { color: C.nightMuted })]),
], 3, { gap: 32 }), paragraph(`${id}-copyright`, "© 你的品牌．保留所有權利", "small", { color: C.nightMuted })], { background: C.night, color: C.white, paddingY: 56, paddingYMobile: 40, gap: 32 });

const footerSimple: BlockFactory = (id) => section(id, [
  menu(`${id}-menu`, [["隱私權政策", "#privacy"], ["服務條款", "#terms"], ["聯絡我們", "#contact"]], { textAlign: "center", color: C.body }),
  paragraph(`${id}-copyright`, "© 你的品牌．保留所有權利", "small", { color: C.muted }),
], { align: "center", background: C.soft, paddingY: 40, paddingYMobile: 32, gap: 12 });

/* ------------------------------ 團隊介紹 ------------------------------ */

const teamCards: BlockFactory = (id) => {
  const members = [[FUNNEL_ILLUSTRATIONS.avatarA, "王小明", "課程講師", "擅長把複雜的觀念整理成好懂的步驟。"], [FUNNEL_ILLUSTRATIONS.avatarB, "李小華", "內容企劃", "負責課程規劃，讓每個單元都有清楚目標。"], [FUNNEL_ILLUSTRATIONS.avatarC, "陳小美", "學員服務", "陪伴學員解決問題，回覆每一則提問。"]] as const;
  return section(id, [
    eyebrow(`${id}-eyebrow`, "團隊成員"),
    heading(`${id}-headline`, "認識陪你一起前進的人", "h2"),
    columns(`${id}-columns`, members.map(([src, name, role, copy], index) => card(`${id}-member-${index + 1}`, [
      avatar(`${id}-member-${index + 1}-image`, src, `${name}的頭像`, true),
      heading(`${id}-member-${index + 1}-name`, name, "h4"),
      paragraph(`${id}-member-${index + 1}-role`, role, "small", { color: C.blue }),
      paragraph(`${id}-member-${index + 1}-copy`, copy, "small", { color: C.muted }),
    ], { align: "center" })), 3),
  ], { align: "center" });
};

const teamFounder: BlockFactory = (id) => section(id, [columns(`${id}-columns`, [
  image(`${id}-image`, FUNNEL_ILLUSTRATIONS.heroCommunity, "主理人介紹示意圖"),
  stack(`${id}-copy`, [
    eyebrow(`${id}-eyebrow`, "關於主理人"),
    heading(`${id}-headline`, "嗨，我是王小明", "h2"),
    paragraph(`${id}-text`, "用一段話介紹你的經歷、擅長的事，以及為什麼想幫助這群人。", "lead", { color: C.body }),
    list(`${id}-list`, ["相關經歷或專長一", "相關經歷或專長二", "想帶給學員的改變"]),
  ]),
], 2, { align: "center" })], { background: C.warm });

/* ------------------------------ 歡迎區塊 ------------------------------ */

const welcomeSplit: BlockFactory = (id) => section(id, [columns(`${id}-columns`, [
  stack(`${id}-copy`, [
    eyebrow(`${id}-eyebrow`, "全新線上課程"),
    heading(`${id}-headline`, "用一個週末，做出你的第一個作品", "h1"),
    paragraph(`${id}-body`, "從零開始的實作課程，跟著影片一步一步完成，不需要任何經驗。", "lead", { color: C.body }),
    button(`${id}-cta`, "立即開始", "amber"),
  ]),
  image(`${id}-hero-image`, FUNNEL_ILLUSTRATIONS.heroLearning, "課程主視覺示意圖"),
], 2, { align: "center" })], { background: C.blueSoft, paddingY: 104, paddingYMobile: 56 });

const welcomeCentered: BlockFactory = (id) => section(id, [
  eyebrow(`${id}-eyebrow`, "歡迎來到這裡", C.amber),
  heading(`${id}-headline`, "讓每一次分享，都更靠近值得慶祝的成果", "h1", { color: C.white }),
  paragraph(`${id}-body`, "一句清楚的價值主張，告訴訪客能從這裡得到什麼。", "lead", { color: C.nightMuted }),
  button(`${id}-cta`, "開始探索", "amber"),
], { align: "center", background: C.night, color: C.white, maxWidth: 760, paddingY: 120, paddingYMobile: 72 });

const welcomeSteps: BlockFactory = (id) => section(id, [
  heading(`${id}-headline`, "三步驟，輕鬆開始", "h1"),
  paragraph(`${id}-body`, "從報名到完成第一份作業，我們都會陪著你。", "lead", { color: C.muted }),
  button(`${id}-cta`, "免費報名", "blue"),
  columns(`${id}-columns`, ([["1", "報名", "填寫基本資料，保留你的位置。"], ["2", "學習", "依照進度觀看課程內容。"], ["3", "實作", "完成練習並取得回饋。"]] as const).map(([number, title, copy], index) => card(`${id}-step-${index + 1}`, [
    node("text", `${id}-step-${index + 1}-number`, { text: number, textStyle: "eyebrow" }, undefined, { color: C.blue, fontSize: 24, letterSpacing: 0 }),
    heading(`${id}-step-${index + 1}-title`, title, "h3"),
    paragraph(`${id}-step-${index + 1}-copy`, copy, "small", { color: C.muted }),
  ])), 3),
], { align: "center", maxWidth: 960, gap: 28 });

const welcomeImageCard: BlockFactory = (id) => section(id, [columns(`${id}-columns`, [
  image(`${id}-hero-image`, FUNNEL_ILLUSTRATIONS.heroNature, "活動主視覺示意圖"),
  card(`${id}-copy`, [
    eyebrow(`${id}-eyebrow`, "線上分享會", C.green),
    heading(`${id}-headline`, "一起找到屬於你的節奏", "h1"),
    paragraph(`${id}-body`, "九十分鐘的線上分享，帶你重新整理目標與優先順序。", "lead", { color: C.body }),
    button(`${id}-cta`, "我要參加", "dark"),
  ], { padding: 40, shadow: "medium" }),
], 2, { align: "center" })], { background: C.greenSoft, paddingY: 96 });

/* ------------------------------ 方案價格 ------------------------------ */

const pricingTiers: BlockFactory = (id) => {
  const plans = [["入門方案", "適合剛開始整理流程的你", "NT$ 0", ["基本頁面編輯", "桌機／手機設定", "社群支援"]], ["成長方案", "最多人選擇的完整方案", "NT$ 990", ["所有入門功能", "名單表單整合", "優先客服"]], ["專業方案", "適合正在擴大規模的團隊", "NT$ 2,490", ["所有成長功能", "團隊協作", "專人導入"]]] as const;
  return section(id, [
    eyebrow(`${id}-eyebrow`, "方案與價格"),
    heading(`${id}-headline`, "選擇最適合你的方案", "h2"),
    paragraph(`${id}-intro`, "價格與內容皆可自行修改；實際收費以結帳頁為準。", "body", { color: C.muted }),
    columns(`${id}-columns`, plans.map(([name, copy, price, features], index) => {
      const featured = index === 1;
      const tone = featured ? { color: C.white } : {};
      return card(`${id}-plan-${index + 1}`, [
        heading(`${id}-plan-${index + 1}-name`, name, "h3", tone),
        paragraph(`${id}-plan-${index + 1}-copy`, copy, "small", featured ? { color: C.blueMist } : { color: C.muted }),
        heading(`${id}-plan-${index + 1}-price`, price, "h2", tone),
        list(`${id}-plan-${index + 1}-features`, [...features], featured ? { color: C.white } : {}),
        button(`${id}-plan-${index + 1}-button`, "選擇方案", featured ? "amber" : "dark", { type: "open_url", href: "#signup", newTab: false }, { width: 100 }),
      ], featured ? { background: C.blueDeep, border: C.blueDeep, shadow: "strong", align: "left" } : { align: "left" });
    }), 3, { gap: 24, align: "stretch" }),
  ], { align: "center", background: C.soft });
};

const pricingTwoPlans: BlockFactory = (id) => {
  const plans = [["單堂體驗", "NT$ 600", ["一堂完整課程", "課後練習講義"]], ["完整課程", "NT$ 3,600", ["全部八堂課程", "作業回饋", "學員社群"]]] as const;
  return section(id, [
    heading(`${id}-headline`, "兩種參與方式", "h2"),
    columns(`${id}-columns`, plans.map(([name, price, features], index) => card(`${id}-plan-${index + 1}`, [
      paragraph(`${id}-plan-${index + 1}-name`, name, "body", { color: C.blue, fontSize: 18 }),
      heading(`${id}-plan-${index + 1}-price`, price, "h2"),
      list(`${id}-plan-${index + 1}-features`, [...features]),
      button(`${id}-plan-${index + 1}-button`, index === 1 ? "報名完整課程" : "先試一堂", index === 1 ? "blue" : "light", { type: "open_url", href: "#signup", newTab: false }, index === 1 ? { width: 100 } : { width: 100, borderColor: C.ink, borderWidth: 2 }),
    ], { align: "left", padding: 32, ...(index === 1 ? { border: C.blue, shadow: "medium" } : {}) })), 2, { gap: 24 }),
  ], { align: "center", maxWidth: 880 });
};

/* ------------------------------ 頁首 ------------------------------ */

const headerBrandMenu: BlockFactory = (id) => section(id, [columns(`${id}-columns`, [
  heading(`${id}-brand`, "你的品牌", "h4"),
  menu(`${id}-menu`, [["首頁", "#top"], ["課程內容", "#features"], ["常見問題", "#faq"], ["聯絡我們", "#contact"]], { textAlign: "right", color: C.body }),
], 2, { align: "center", gap: 24 })], { paddingY: 20, paddingYMobile: 16, maxWidth: 1200 });

const headerWithCta: BlockFactory = (id) => section(id, [columns(`${id}-columns`, [
  heading(`${id}-brand`, "你的品牌", "h4", { color: C.white }),
  menu(`${id}-menu`, [["特色", "#features"], ["方案", "#pricing"], ["見證", "#testimonials"]], { textAlign: "center", color: C.nightMuted }),
  button(`${id}-cta`, "立即報名", "amber", { type: "open_url", href: "#signup", newTab: false }, { textAlign: "right" }),
], 3, { align: "center", gap: 24 })], { background: C.night, color: C.white, paddingY: 18, paddingYMobile: 16, maxWidth: 1200 });

/* ------------------------------ 客戶見證 ------------------------------ */

const testimonialCards: BlockFactory = (id) => {
  const quotes = [[FUNNEL_ILLUSTRATIONS.avatarA, "陳小美", "線上課程學員", "內容安排得很清楚，跟著步驟做，第一次就順利完成作品。"], [FUNNEL_ILLUSTRATIONS.avatarB, "林小強", "自由工作者", "講解很實際，每個單元都能馬上用在自己的工作上。"], [FUNNEL_ILLUSTRATIONS.avatarC, "張小芬", "小店經營者", "手機上也能輕鬆學習，零碎時間就能前進一點。"]] as const;
  return section(id, [
    eyebrow(`${id}-eyebrow`, "學員回饋"),
    heading(`${id}-headline`, "聽聽他們怎麼說", "h2"),
    columns(`${id}-columns`, quotes.map(([src, name, role, quote], index) => card(`${id}-quote-${index + 1}`, [
      paragraph(`${id}-quote-${index + 1}-quote`, `「${quote}」`, "body", { color: C.body }),
      avatar(`${id}-quote-${index + 1}-image`, src, `${name}的頭像`),
      heading(`${id}-quote-${index + 1}-name`, name, "h4"),
      paragraph(`${id}-quote-${index + 1}-role`, role, "small", { color: C.muted }),
    ], { align: "left" })), 3),
    paragraph(`${id}-note`, "以上為示意內容，發布前請替換成真實且經同意使用的回饋。", "small", { color: C.muted }),
  ], { align: "center", background: C.soft });
};

const testimonialSpotlight: BlockFactory = (id) => section(id, [
  avatar(`${id}-image`, FUNNEL_ILLUSTRATIONS.avatarB, "學員頭像", true),
  paragraph(`${id}-quote`, "「以前總覺得自己做不到，跟著課程一步一步來，現在已經能獨立完成整個流程。」", "lead", { color: C.white, fontSize: 24, lineHeight: 1.6 }),
  heading(`${id}-name`, "林小強", "h4", { color: C.white }),
  paragraph(`${id}-role`, "自由工作者．示意回饋", "small", { color: C.nightMuted }),
], { align: "center", background: C.blueDeep, color: C.white, maxWidth: 760 });

const definitionsList: BlockDefinition[] = [
  { id: "order-form-split", category: "order_forms", label: "方案摘要＋訂購表單", description: "左側方案摘要、右側訂購欄位；付款需綁定商品。", factory: orderFormSplit, capability: FUNNEL_CAPABILITIES.payment },
  { id: "order-form-stacked", category: "order_forms", label: "置中訂購表單", description: "單欄置中的訂購資料與付款元件。", factory: orderFormStacked, capability: FUNNEL_CAPABILITIES.payment },
  { id: "opt-in-split", category: "opt_in_forms", label: "圖文雙欄名單表單", description: "左側價值說明與清單，右側表單卡片。", factory: optInSplit },
  { id: "opt-in-centered", category: "opt_in_forms", label: "置中訂閱表單", description: "置中標題與單欄表單，適合電子報。", factory: optInCentered },
  { id: "opt-in-dark", category: "opt_in_forms", label: "深色通知名單", description: "深色背景搭配白色表單卡片。", factory: optInDark },
  { id: "opt-in-image", category: "opt_in_forms", label: "圖片＋下載表單", description: "左側示意圖，右側只收電子信箱。", factory: optInImage },
  { id: "features-cards", category: "features", label: "三欄特色卡片", description: "圖示、標題與說明的三張卡片。", factory: featureCards },
  { id: "features-image-list", category: "features", label: "圖片＋重點清單", description: "左圖右文，搭配清單與按鈕。", factory: featureImageList },
  { id: "features-steps", category: "features", label: "四步驟說明", description: "編號步驟的四欄排列。", factory: featureFourSteps },
  { id: "features-highlight", category: "features", label: "中間高亮三欄", description: "三種選擇，中間一欄以主色強調。", factory: featureHighlight },
  { id: "footer-columns", category: "page_footers", label: "深色三欄頁尾", description: "品牌介紹、快速連結與聯絡方式。", factory: footerColumns },
  { id: "footer-simple", category: "page_footers", label: "簡潔置中頁尾", description: "法務連結與版權宣告。", factory: footerSimple },
  { id: "team-cards", category: "team_presentation", label: "三位成員卡片", description: "圓形頭像、姓名、職稱與介紹。", factory: teamCards },
  { id: "team-founder", category: "team_presentation", label: "主理人介紹", description: "左側圖片、右側自我介紹與經歷。", factory: teamFounder },
  { id: "welcome-split", category: "welcome", label: "左文右圖主視覺", description: "大標題、說明與主要按鈕，搭配示意圖。", factory: welcomeSplit },
  { id: "welcome-centered", category: "welcome", label: "深色置中主視覺", description: "深色背景上的置中標題與按鈕。", factory: welcomeCentered },
  { id: "welcome-steps", category: "welcome", label: "主視覺＋三步驟", description: "置中標題下方接三個步驟卡片。", factory: welcomeSteps },
  { id: "welcome-image-card", category: "welcome", label: "圖片＋文字卡片", description: "示意圖搭配白色文字卡片。", factory: welcomeImageCard },
  { id: "pricing-tiers", category: "price_plans", label: "三欄方案（推薦高亮）", description: "三種方案，中間推薦方案以深色強調。", factory: pricingTiers },
  { id: "pricing-two-plans", category: "price_plans", label: "兩欄方案比較", description: "單堂與完整課程兩種選擇。", factory: pricingTwoPlans },
  { id: "header-brand-menu", category: "page_headers", label: "品牌名稱＋選單", description: "左側品牌名稱，右側頁內導覽。", factory: headerBrandMenu },
  { id: "header-cta", category: "page_headers", label: "深色頁首＋按鈕", description: "品牌、置中選單與報名按鈕。", factory: headerWithCta },
  { id: "testimonials-cards", category: "testimonials", label: "三欄見證卡片", description: "引言、頭像、姓名與身分。", factory: testimonialCards },
  { id: "testimonials-spotlight", category: "testimonials", label: "單則見證聚焦", description: "深色背景上的一則大型引言。", factory: testimonialSpotlight },
  // 黑金高質感系列：與「高質感課程品牌（黑金）」範本共用同一份區段定義。
  ...luxuryBlocks([
    ["header-dark-gold", "page_headers", "nav", "黑金固定導覽列", "Logo、下拉選單、社群圖示與按鈕；手機版收成漢堡選單。"],
    ["welcome-dark-portrait", "welcome", "hero", "黑金人物主視覺", "左側人物照，右側英文小標、強調色大標與按鈕。"],
    ["features-dark-photo-points", "features", "method", "背景照＋編號重點", "深色漸層疊在背景照上，左側帶圖示的編號重點。"],
    ["features-image-cards", "features", "courses", "三欄圖片卡片（角落裝飾）", "米色底、英文小標與三張角落金色三角卡片。"],
    ["features-dark-image-icons", "features", "features", "左圖右文課程特色", "左側圖片，右側兩欄圖示特色。"],
    ["social-logos-dark", "social_proof", "press", "媒體 Logo 列", "深色底上的單色 Logo 列，可上傳多張 Logo。"],
    ["social-stats-photo", "social_proof", "stats", "背景照上的金框數據", "三欄大數字與說明，捲動到畫面時計數。"],
    ["testimonials-wall-dark", "testimonials", "reviews", "兩排自動捲動評價牆", "頭像、驗證勾、日期、星等；可暫停，滑鼠移上停止。"],
    ["content-articles-cream", "content_showcase", "journal", "文章卡片網格", "縮圖、分類標籤、日期、標題與 READ MORE。"],
    ["content-videos-dark", "content_showcase", "videos", "影片牆", "播放鍵縮圖；YouTube 以隱私模式在點擊後載入。"],
    ["cta-gold-frame", "call_to_action", "cta", "背景照上的金框 CTA", "雙線金框盒疊在暗色背景照上，置中標題與按鈕。"],
    ["cta-gold-corners", "call_to_action", "ctaCorners", "四角框線 CTA", "深色底上的四角金色框線盒，置中標題與按鈕。"],
    ["footer-dark-centered", "page_footers", "footer", "黑金置中頁尾", "品牌名稱、頁內連結與版權宣告。"],
  ]),
];

/** Blocks built from a template section; the instance id becomes the node-id prefix. */
function luxuryBlocks(entries: ReadonlyArray<readonly [string, FunnelBlockCategory, LuxuryCourseSectionName, string, string]>): BlockDefinition[] {
  return entries.map(([id, category, section, label, description]) => ({ id, category, label, description, factory: (instanceId: string) => withoutHtmlIds(buildLuxuryCourseSection(section, instanceId)) }));
}

/** Template sections carry anchor ids (#about…); a block may be added many times, so they are dropped. */
function withoutHtmlIds(root: FunnelNode): FunnelNode {
  return { ...root, attributes: {}, ...(root.children ? { children: root.children.map(withoutHtmlIds) } : {}) };
}

/** Category labels follow the editor's 版型區塊 list (EDT-BLK-001). */
const CATEGORY_TEXT: Readonly<Record<FunnelBlockCategory, { label: string; description: string }>> = {
  order_forms: { label: "訂購表單", description: "方案摘要與受限制的付款欄位" },
  opt_in_forms: { label: "名單表單", description: "收集聯絡資料的註冊表單" },
  features: { label: "特色介紹", description: "多欄特色、步驟與重點說明" },
  page_footers: { label: "頁尾", description: "品牌資訊、導覽與版權宣告" },
  team_presentation: { label: "團隊介紹", description: "成員頭像、職稱與介紹" },
  welcome: { label: "歡迎區塊", description: "主視覺標題、說明與行動按鈕" },
  price_plans: { label: "方案價格", description: "方案比較與推薦方案" },
  page_headers: { label: "頁首", description: "品牌名稱與導覽選單" },
  testimonials: { label: "客戶見證", description: "引言、頭像與身分資訊" },
  social_proof: { label: "信任背書", description: "媒體 Logo 列與數據統計" },
  content_showcase: { label: "內容展示", description: "文章卡片與影片牆" },
  call_to_action: { label: "行動呼籲", description: "疊在背景照上的 CTA 盒" },
};

const counts = new Map<FunnelBlockCategory, number>();
for (const definition of definitionsList) counts.set(definition.category, (counts.get(definition.category) ?? 0) + 1);

export const FUNNEL_BLOCK_CATEGORY_METADATA: Readonly<Record<FunnelBlockCategory, FunnelBlockCategoryMetadata>> = Object.fromEntries(
  FUNNEL_BLOCK_CATEGORIES.map((id) => [id, { id, ...CATEGORY_TEXT[id], variantCount: counts.get(id) ?? 0 }]),
) as Record<FunnelBlockCategory, FunnelBlockCategoryMetadata>;

const definitions: Record<string, FunnelBlockTemplate> = {};
for (const definition of definitionsList) {
  definitions[definition.id] = {
    id: definition.id, category: definition.category, label: definition.label, description: definition.description,
    variantCount: counts.get(definition.category) ?? 0, ...(definition.capability ? { capability: definition.capability } : {}), factory: definition.factory,
  };
}

export const FUNNEL_BLOCK_REGISTRY: Readonly<Record<string, FunnelBlockTemplate>> = definitions;

/** Categories that currently have blocks, in the editor's display order. */
export function listFunnelBlockCategories(): FunnelBlockCategoryMetadata[] {
  return FUNNEL_BLOCK_CATEGORIES.map((id) => FUNNEL_BLOCK_CATEGORY_METADATA[id]).filter((category) => category.variantCount > 0);
}

let blockSequence = 0;

function nextInstanceId(templateId: string): string {
  blockSequence += 1;
  return `${templateId}-${Date.now().toString(36)}-${blockSequence}`;
}

function validateBlock(template: FunnelBlockTemplate, root: FunnelNode): FunnelNode {
  const valid = parsePageDocument({ schemaVersion: 1, id: "block-preview", name: template.label, root: [root], popups: [], settings: {} });
  if (!valid) throw new Error(`一頁式網站區塊 無法通過 PageDocument 驗證：${template.id}`);
  return root;
}

/**
 * Instantiate a fresh block with unique IDs. Only call from event handlers
 * (click/drop): IDs depend on the clock, so never during render.
 */
export function instantiateBlock(templateId: string): FunnelNode {
  const template = FUNNEL_BLOCK_REGISTRY[templateId];
  if (!template) throw new Error(`找不到一頁式網站區塊：${templateId}`);
  return validateBlock(template, template.factory(nextInstanceId(templateId)));
}

/** IDs of a preview block depend only on the template ID, so server and browser renders match. */
export function previewBlockInstanceId(templateId: string): string {
  return `${templateId}-preview`;
}

/**
 * Deterministic one-block document for the block library thumbnail. The
 * caller's page settings are reused so the thumbnail matches the page's fonts.
 */
export function previewFunnelBlockDocument(templateId: string, settings?: PageDocument["settings"]): PageDocument {
  const template = FUNNEL_BLOCK_REGISTRY[templateId];
  if (!template) throw new Error(`找不到一頁式網站區塊：${templateId}`);
  const root = validateBlock(template, template.factory(previewBlockInstanceId(templateId)));
  const document = parsePageDocument({ ...createEmptyPageDocument(`${previewBlockInstanceId(templateId)}-page`, template.label), ...(settings ? { settings } : {}), root: [root] });
  if (!document) throw new Error(`一頁式網站區塊 無法通過 PageDocument 驗證：${templateId}`);
  return document;
}

export function getFunnelBlocksByCategory(category: FunnelBlockCategory): FunnelBlockTemplate[] {
  return Object.values(FUNNEL_BLOCK_REGISTRY).filter((template) => template.category === category);
}
