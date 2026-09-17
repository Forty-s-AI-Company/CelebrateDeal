import { z } from "zod";

import {
  parseLandingPageContent,
  type LandingPageContent,
} from "@/lib/landing-page-content";
import { parseFunnelFlow, type FunnelFlow } from "@/lib/funnel-flow";
import { FunnelCommerceBindingSchema } from "@/lib/funnel-commerce";

/**
 * Persisted Funnel editor contract.  This is deliberately independent from
 * the current database model: callers can store the serialized document in
 * the existing draft field without requiring a migration.
 */
export const FUNNEL_PAGE_DOCUMENT_SCHEMA_VERSION = 1 as const;
export const FUNNEL_PAGE_MAX_NODES = 500;
export const FUNNEL_PAGE_MAX_DEPTH = 12;

export const FUNNEL_NODE_TYPES = [
  "text", "headline", "bulleted_list", "content_box", "image", "video", "audio", "carousel",
  "columns_4", "columns_3", "columns_2", "row", "section", "form", "form_input", "button",
  "checkbox", "calendar", "x_share_button", "survey", "countdown", "menu", "horizontal_line",
  "raw_html", "faq", "recaptcha", "payment_button", "payment_method", "customer_type",
  "physical_product", "offer_price", "agreement", "order_bump", "coupon", "two_step_order_form",
  "shipping_fees", "paid_calendar",
] as const;
export type FunnelNodeType = (typeof FUNNEL_NODE_TYPES)[number];

export const FUNNEL_BLOCK_CATEGORIES = [
  "order_forms", "opt_in_forms", "features", "page_footers", "team_presentation",
  "welcome", "price_plans", "page_headers", "testimonials",
] as const;
export type FunnelBlockCategory = (typeof FUNNEL_BLOCK_CATEGORIES)[number];

export type FunnelCapabilityStatus = "available" | "disabled" | "limited" | "unverified";
export type FunnelCapability = { status: FunnelCapabilityStatus; reason: string; upgradeRequired?: boolean };

const identifier = z.string().trim().min(1).max(100).regex(/^[A-Za-z0-9_-]+$/u, "識別碼只能包含英數、底線與連字號");
const safeShortText = z.string().trim().max(240);
const safeHref = z.string().trim().max(2_048).refine((value) => {
  if (/^[\u0000-\u0020]/u.test(value) || /[\u0000-\u001f\u007f]/u.test(value)) return false;
  return (value.startsWith("/") && !value.startsWith("//")) || value.startsWith("#") || /^https:\/\//iu.test(value);
}, "網址只允許同源路徑、錨點或 HTTPS");
const safeColor = z.string().trim().max(32).regex(/^(#[0-9a-f]{3,8}|rgb\([0-9, .]+\)|rgba\([0-9, .]+\)|transparent|white|black)$/iu, "顏色格式不正確");
const safeCssToken = z.string().trim().max(120).refine((value) => !/[{};<>]/u.test(value) && !/\b(?:javascript|data|vbscript):/iu.test(value), "樣式值不安全");

const JsonValueSchema: z.ZodType<unknown> = z.lazy(() => z.union([
  z.string().max(10_000), z.number().finite(), z.boolean(), z.null(),
  z.array(JsonValueSchema).max(100), z.record(z.string().max(100), JsonValueSchema),
]));

/** Only value-based styles are persisted; arbitrary CSS/class names are not. */
export const FunnelNodeStyleSchema = z.object({
  fontSize: z.number().finite().min(1).max(240).optional(),
  lineHeight: z.number().finite().min(0.5).max(5).optional(),
  letterSpacing: z.number().finite().min(-20).max(50).optional(),
  width: z.union([z.number().finite().min(0).max(100), safeCssToken]).optional(),
  height: z.union([z.number().finite().min(0).max(10_000), safeCssToken]).optional(),
  textAlign: z.enum(["left", "center", "right", "justify"]).optional(),
  align: z.enum(["start", "center", "end", "stretch"]).optional(),
  direction: z.enum(["row", "column"]).optional(),
  padding: z.union([z.number().finite().min(0).max(1_000), safeCssToken]).optional(),
  margin: z.union([z.number().finite().min(-1_000).max(1_000), safeCssToken]).optional(),
  backgroundColor: safeColor.optional(),
  color: safeColor.optional(),
  borderColor: safeColor.optional(),
  borderWidth: z.number().finite().min(0).max(100).optional(),
  borderRadius: z.number().finite().min(0).max(500).optional(),
  imageWidth: z.number().finite().min(0).max(100).optional(),
  imageHeight: z.number().finite().min(0).max(10_000).optional(),
  shadow: z.enum(["none", "soft", "medium", "strong"]).optional(),
}).strict();
export type FunnelNodeStyle = z.infer<typeof FunnelNodeStyleSchema>;

const NodeOverrideSchema = z.object({
  style: FunnelNodeStyleSchema.optional(),
  visible: z.boolean().optional(),
  props: z.record(z.string().max(100), JsonValueSchema).optional(),
}).strict();

export const FunnelNodeOverridesSchema = z.object({
  desktop: NodeOverrideSchema.optional(),
  mobile: NodeOverrideSchema.optional(),
}).strict();

const NodeActionSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("none") }).strict(),
  z.object({ type: z.literal("submit_form"), formId: identifier.optional() }).strict(),
  z.object({ type: z.literal("show_popup"), popupId: identifier }).strict(),
  z.object({ type: z.literal("open_url"), href: safeHref, newTab: z.boolean().default(false) }).strict(),
  z.object({ type: z.literal("next_step"), stepId: identifier }).strict(),
  z.object({ type: z.literal("download"), href: safeHref, fileName: safeShortText.optional() }).strict(),
]);
export type FunnelNodeAction = z.infer<typeof NodeActionSchema>;

const NodeAttributesSchema = z.record(
  z.string().trim().regex(/^[A-Za-z][A-Za-z0-9_:-]{0,63}$/u, "HTML 屬性名稱不正確"),
  z.string().trim().max(500).refine((value) => !/[<>]/u.test(value) && !/^javascript:/iu.test(value), "HTML 屬性值不安全"),
).refine((attributes) => Object.keys(attributes).every((key) => {
  const normalized = key.toLowerCase();
  return !normalized.startsWith("on") && !["style", "classname", "children", "dangerouslysetinnerhtml", "ref", "key"].includes(normalized);
}), "不得設定事件、樣式或 React 保留屬性");

export const FunnelCapabilityStatusSchema = z.object({
  status: z.enum(["available", "disabled", "limited", "unverified"]),
  reason: z.string().trim().min(1).max(500),
  upgradeRequired: z.boolean().optional(),
}).strict();

const defaultCapability = (status: FunnelCapabilityStatus, reason: string, upgradeRequired = false): FunnelCapability => ({ status, reason, upgradeRequired });

/** Feature flags are explicit so unavailable editor features never fail silently. */
export const FUNNEL_CAPABILITIES = {
  payment: defaultCapability("limited", "需在訂單步驟綁定有效商品與既有安全結帳；優惠碼輸入及獨立運費規則尚未支援"),
  rawHtml: defaultCapability("disabled", "為避免編輯器執行危險腳本，目前僅保留不可執行的限制狀態"),
  tracking: defaultCapability("disabled", "追蹤碼與自訂程式碼需經安全整合後才可啟用"),
  recaptcha: defaultCapability("unverified", "目前沒有可驗證的 reCAPTCHA 網域金鑰，因此暫不可用"),
  exitIntent: defaultCapability("unverified", "已保留設定入口，但尚未完成跨瀏覽器觸發驗證"),
  affiliate: defaultCapability("disabled", "聯盟徽章尚未連接可驗證的方案資料"),
} as const satisfies Record<string, { status: FunnelCapabilityStatus; reason: string; upgradeRequired?: boolean }>;

const NodeSchemaBase = z.object({
  schemaVersion: z.literal(FUNNEL_PAGE_DOCUMENT_SCHEMA_VERSION),
  id: identifier,
  type: z.enum(FUNNEL_NODE_TYPES),
  props: z.record(z.string().max(100), JsonValueSchema).default({}),
  style: FunnelNodeStyleSchema.default({}),
  overrides: FunnelNodeOverridesSchema.default({}),
  visible: z.boolean().default(true),
  actions: z.array(NodeActionSchema).max(20).default([]),
  attributes: NodeAttributesSchema.default({}),
  children: z.array(z.lazy(() => FunnelNodeSchema)).max(100).optional(),
}).strict();

export const FunnelNodeSchema: z.ZodType<FunnelNode> = NodeSchemaBase as z.ZodType<FunnelNode>;
export interface FunnelNode {
  schemaVersion: typeof FUNNEL_PAGE_DOCUMENT_SCHEMA_VERSION;
  id: string;
  type: FunnelNodeType;
  props: Record<string, unknown>;
  style: FunnelNodeStyle;
  overrides: z.infer<typeof FunnelNodeOverridesSchema>;
  visible: boolean;
  actions: FunnelNodeAction[];
  attributes: Record<string, string>;
  children?: FunnelNode[];
}

type FunnelNodeDefinition = {
  label: string;
  category: "text" | "layout" | "form" | "payment" | "media" | "social" | "other";
  children: boolean;
  allowedParents: readonly ("root" | FunnelNodeType)[];
  capability: FunnelCapability;
};
const available: FunnelCapability = { status: "available", reason: "依目前實測規格可建立與編輯" };
const payment = FUNNEL_CAPABILITIES.payment;
const definitions: Record<FunnelNodeType, FunnelNodeDefinition> = {
  text: { label: "文字", category: "text", children: false, allowedParents: ["row", "columns_2", "columns_3", "columns_4", "content_box", "faq", "form"], capability: available },
  headline: { label: "標題", category: "text", children: false, allowedParents: ["row", "columns_2", "columns_3", "columns_4", "content_box", "faq"], capability: available },
  bulleted_list: { label: "項目清單", category: "text", children: false, allowedParents: ["row", "columns_2", "columns_3", "columns_4", "content_box"], capability: available },
  content_box: { label: "內容盒", category: "text", children: true, allowedParents: ["row", "columns_2", "columns_3", "columns_4"], capability: available },
  image: { label: "圖片", category: "media", children: false, allowedParents: ["row", "columns_2", "columns_3", "columns_4", "content_box", "faq"], capability: available },
  video: { label: "影片", category: "media", children: false, allowedParents: ["row", "columns_2", "columns_3", "columns_4", "content_box"], capability: available },
  audio: { label: "音訊", category: "media", children: false, allowedParents: ["row", "columns_2", "columns_3", "columns_4", "content_box"], capability: available },
  carousel: { label: "輪播", category: "media", children: true, allowedParents: ["row", "columns_2", "columns_3", "columns_4"], capability: available },
  columns_4: { label: "四欄", category: "layout", children: true, allowedParents: ["row"], capability: available },
  columns_3: { label: "三欄", category: "layout", children: true, allowedParents: ["row"], capability: available },
  columns_2: { label: "兩欄", category: "layout", children: true, allowedParents: ["row"], capability: available },
  row: { label: "列", category: "layout", children: true, allowedParents: ["section"], capability: available },
  section: { label: "區段", category: "layout", children: true, allowedParents: ["root"], capability: available },
  form: { label: "表單", category: "form", children: true, allowedParents: ["row", "columns_2", "columns_3", "columns_4"], capability: available },
  form_input: { label: "表單欄位", category: "form", children: false, allowedParents: ["form", "row", "columns_2", "columns_3", "columns_4"], capability: available },
  button: { label: "按鈕", category: "form", children: false, allowedParents: ["form", "row", "columns_2", "columns_3", "columns_4", "content_box"], capability: available },
  checkbox: { label: "核取方塊", category: "form", children: false, allowedParents: ["form", "row", "columns_2", "columns_3", "columns_4"], capability: available },
  calendar: { label: "行事曆", category: "form", children: false, allowedParents: ["row", "columns_2", "columns_3", "columns_4"], capability: available },
  x_share_button: { label: "X 分享按鈕", category: "social", children: false, allowedParents: ["row", "columns_2", "columns_3", "columns_4", "content_box"], capability: available },
  survey: { label: "問卷", category: "form", children: false, allowedParents: ["row", "columns_2", "columns_3", "columns_4"], capability: available },
  countdown: { label: "倒數計時", category: "other", children: false, allowedParents: ["row", "columns_2", "columns_3", "columns_4"], capability: available },
  menu: { label: "選單", category: "other", children: false, allowedParents: ["row", "columns_2", "columns_3", "columns_4", "section"], capability: available },
  horizontal_line: { label: "水平線", category: "other", children: false, allowedParents: ["row", "columns_2", "columns_3", "columns_4", "content_box"], capability: available },
  raw_html: { label: "原始 HTML", category: "other", children: false, allowedParents: ["row", "columns_2", "columns_3", "columns_4", "content_box"], capability: FUNNEL_CAPABILITIES.rawHtml },
  faq: { label: "常見問題", category: "other", children: true, allowedParents: ["row", "columns_2", "columns_3", "columns_4"], capability: available },
  recaptcha: { label: "reCAPTCHA", category: "form", children: false, allowedParents: ["form", "row", "columns_2", "columns_3", "columns_4"], capability: FUNNEL_CAPABILITIES.recaptcha },
  payment_button: { label: "付款按鈕", category: "payment", children: false, allowedParents: ["form", "row", "columns_2", "columns_3", "columns_4"], capability: payment },
  payment_method: { label: "付款方式", category: "payment", children: false, allowedParents: ["form", "row", "columns_2", "columns_3", "columns_4"], capability: payment },
  customer_type: { label: "客戶類型", category: "payment", children: false, allowedParents: ["form", "row", "columns_2", "columns_3", "columns_4"], capability: payment },
  physical_product: { label: "實體商品", category: "payment", children: false, allowedParents: ["form", "row", "columns_2", "columns_3", "columns_4"], capability: payment },
  offer_price: { label: "優惠價格", category: "payment", children: false, allowedParents: ["form", "row", "columns_2", "columns_3", "columns_4"], capability: payment },
  agreement: { label: "同意條款", category: "payment", children: false, allowedParents: ["form", "row", "columns_2", "columns_3", "columns_4"], capability: payment },
  order_bump: { label: "加購方案", category: "payment", children: false, allowedParents: ["form", "row", "columns_2", "columns_3", "columns_4"], capability: payment },
  coupon: { label: "優惠碼", category: "payment", children: false, allowedParents: ["form", "row", "columns_2", "columns_3", "columns_4"], capability: payment },
  two_step_order_form: { label: "兩步驟訂單表單", category: "payment", children: true, allowedParents: ["row", "columns_2", "columns_3", "columns_4"], capability: payment },
  shipping_fees: { label: "運費", category: "payment", children: false, allowedParents: ["form", "row", "columns_2", "columns_3", "columns_4"], capability: payment },
  paid_calendar: { label: "付費行事曆", category: "payment", children: false, allowedParents: ["form", "row", "columns_2", "columns_3", "columns_4"], capability: payment },
};
export const FUNNEL_NODE_REGISTRY = definitions as Readonly<Record<FunnelNodeType, FunnelNodeDefinition>>;
export function getFunnelNodeDefinition(type: FunnelNodeType) { return FUNNEL_NODE_REGISTRY[type]; }

const PopupSettingsSchema = z.object({
  showCloseButton: z.boolean().default(false),
  openAutomatically: z.boolean().default(true),
  automaticDelaySeconds: z.number().finite().min(0).max(86_400).default(1),
  openOnExitIntent: z.boolean().default(false),
  backgroundColor: safeColor.default("white"),
  padding: z.number().finite().min(0).max(1_000).default(24),
  cornerRadius: z.number().finite().min(0).max(500).default(6),
  borderStyle: z.enum(["none", "solid", "dashed", "dotted"]).default("solid"),
  borderColor: safeColor.default("#e2e8f0"),
  borderWidth: z.number().finite().min(0).max(100).default(1),
  shadow: z.enum(["none", "soft", "medium", "strong"]).default("soft"),
  htmlId: identifier.optional(),
}).strict();
const defaultPopupSettings = {
  showCloseButton: false, openAutomatically: true, automaticDelaySeconds: 1, openOnExitIntent: false,
  backgroundColor: "white", padding: 24, cornerRadius: 6, borderStyle: "solid" as const,
  borderColor: "#e2e8f0", borderWidth: 1, shadow: "soft" as const,
};
export type FunnelPopupSettings = z.infer<typeof PopupSettingsSchema>;

export const FunnelPopupSchema = z.object({
  schemaVersion: z.literal(FUNNEL_PAGE_DOCUMENT_SCHEMA_VERSION),
  id: identifier,
  name: safeShortText.min(1),
  pageId: identifier.optional(),
  settings: PopupSettingsSchema.default(defaultPopupSettings),
  root: z.array(z.lazy(() => FunnelNodeSchema)).max(100).default([]),
  capabilities: z.object({ exitIntent: FunnelCapabilityStatusSchema.default(FUNNEL_CAPABILITIES.exitIntent) }).strict().default({ exitIntent: FUNNEL_CAPABILITIES.exitIntent }),
}).strict();
export type FunnelPopup = z.infer<typeof FunnelPopupSchema>;

const PageSettingsSchema = z.object({
  typography: z.object({
    bodyFont: safeCssToken.default("system-ui"), headingFont: safeCssToken.default("system-ui"),
    bodySize: z.number().finite().min(8).max(120).default(16), bodyLineHeight: z.number().finite().min(0.5).max(5).default(1.5),
    linkColor: safeColor.default("#2563eb"), textColor: safeColor.default("#0f172a"), alignment: z.enum(["left", "center", "right"]).default("left"),
  }).strict().default({ bodyFont: "system-ui", headingFont: "system-ui", bodySize: 16, bodyLineHeight: 1.5, linkColor: "#2563eb", textColor: "#0f172a", alignment: "left" }),
  language: z.enum(["zh-TW", "en", "fr", "es", "it", "pt", "de", "nl", "ru", "ja", "ar", "tr", "sv", "ro", "cs", "hu", "sk", "da", "id", "pl", "el", "sr", "hi", "no", "th", "sl", "uk", "sq"]).default("zh-TW"),
  background: z.object({ color: safeColor.default("white"), imageUrl: safeHref.optional(), blur: z.number().finite().min(0).max(100).default(0) }).strict().default({ color: "white", blur: 0 }),
  seo: z.object({ title: safeShortText.optional(), description: z.string().trim().max(320).optional(), keywords: z.string().trim().max(500).optional(), author: safeShortText.optional(), socialImage: safeHref.optional(), hideFromSearch: z.boolean().default(false) }).strict().default({ hideFromSearch: false }),
  tracking: FunnelCapabilityStatusSchema.default(FUNNEL_CAPABILITIES.tracking),
  affiliate: FunnelCapabilityStatusSchema.default(FUNNEL_CAPABILITIES.affiliate),
}).strict();
const defaultTypography = { bodyFont: "system-ui", headingFont: "system-ui", bodySize: 16, bodyLineHeight: 1.5, linkColor: "#2563eb", textColor: "#0f172a", alignment: "left" as const };
const defaultBackground = { color: "white", blur: 0 };
const defaultSeo = { hideFromSearch: false };
const defaultPageSettings = { typography: defaultTypography, language: "zh-TW" as const, background: defaultBackground, seo: defaultSeo, tracking: FUNNEL_CAPABILITIES.tracking, affiliate: FUNNEL_CAPABILITIES.affiliate };
export type FunnelPageSettings = z.infer<typeof PageSettingsSchema>;

export const PageDocumentSchema = z.object({
  schemaVersion: z.literal(FUNNEL_PAGE_DOCUMENT_SCHEMA_VERSION),
  id: identifier,
  name: safeShortText.default("未命名頁面"),
  revision: z.number().int().nonnegative().max(1_000_000).default(0),
  root: z.array(z.lazy(() => FunnelNodeSchema)).max(100).default([]),
  popups: z.array(FunnelPopupSchema).max(50).default([]),
  settings: PageSettingsSchema.default(defaultPageSettings),
  commerce: FunnelCommerceBindingSchema.optional(),
  flow: z.custom<FunnelFlow>((value) => parseFunnelFlow(value) !== null, { message: "Funnel 流程資料不符合格式" }).optional(),
}).strict();
export type PageDocument = z.infer<typeof PageDocumentSchema>;

function validateNodeTree(nodes: FunnelNode[], parent: "root" | FunnelNodeType, depth: number, state: { ids: Set<string>; htmlIds: Set<string>; count: number; references: Set<object> }): string | null {
  if (depth > FUNNEL_PAGE_MAX_DEPTH) return "節點巢狀深度超過限制";
  for (const node of nodes) {
    if (state.references.has(node as unknown as object)) return "偵測到循環引用";
    state.references.add(node as unknown as object);
    state.count += 1;
    if (state.count > FUNNEL_PAGE_MAX_NODES) return "節點數量超過限制";
    if (state.ids.has(node.id)) return `節點 id 重複：${node.id}`;
    state.ids.add(node.id);
    const htmlId = node.attributes.id;
    if (htmlId && state.htmlIds.has(htmlId)) return `HTML id 重複：${htmlId}`;
    if (htmlId) state.htmlIds.add(htmlId);
    const definition = FUNNEL_NODE_REGISTRY[node.type];
    if (!definition.allowedParents.includes(parent)) return `${node.type} 不允許放在 ${parent} 之下`;
    if (definition.children !== Boolean(node.children)) return definition.children ? `${node.type} 必須提供 children` : `${node.type} 不允許 children`;
    if (node.children) {
      const childParent = node.type;
      const issue = validateNodeTree(node.children, childParent, depth + 1, state);
      if (issue) return issue;
    }
  }
  return null;
}

/** Parse and validate a document at the persistence boundary. Fails closed. */
export function parsePageDocument(value: unknown): PageDocument | null {
  let parsed: ReturnType<typeof PageDocumentSchema.safeParse>;
  try { parsed = PageDocumentSchema.safeParse(value); } catch { return null; }
  if (!parsed.success) return null;
  const state = { ids: new Set<string>(), htmlIds: new Set<string>(), count: 0, references: new Set<object>() };
  const rootIssue = validateNodeTree(parsed.data.root, "root", 1, state);
  if (rootIssue) return null;
  for (const popup of parsed.data.popups) {
    if (state.ids.has(popup.id)) return null;
    state.ids.add(popup.id);
    const popupIssue = validateNodeTree(popup.root, "root", 1, state);
    if (popupIssue) return null;
  }
  return parsed.data;
}

export function serializePageDocument(document: PageDocument): string {
  const parsed = parsePageDocument(document);
  if (!parsed) throw new Error("無法序列化不符合規格的 PageDocument");
  return JSON.stringify(parsed);
}

export function deserializePageDocument(serialized: string): PageDocument | null {
  if (serialized.length > 5_000_000) return null;
  try { return parsePageDocument(JSON.parse(serialized) as unknown); } catch { return null; }
}

export function createEmptyPageDocument(id = "page", name = "未命名頁面"): PageDocument {
  return PageDocumentSchema.parse({ schemaVersion: FUNNEL_PAGE_DOCUMENT_SCHEMA_VERSION, id, name, root: [], popups: [], settings: {} });
}

const legacyTypeMap: Record<string, FunnelNodeType> = {
  Heading: "headline", Text: "text", Image: "image", Video: "video", Button: "button", Carousel: "carousel",
  Countdown: "countdown", FAQ: "faq", Section: "section", Columns: "row", Hero: "content_box", Speaker: "content_box",
  Benefits: "content_box", Agenda: "content_box", Pricing: "content_box", Testimonials: "content_box", CTA: "content_box",
};

function styleFromLegacy(value: unknown): FunnelNodeStyle {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const source = value as Record<string, unknown>;
  const style: Record<string, unknown> = {};
  for (const key of ["fontSize", "lineHeight", "letterSpacing", "width", "height", "textAlign", "padding", "margin", "backgroundColor", "color", "borderColor", "borderWidth", "borderRadius", "imageWidth", "imageHeight"]) if (key in source) style[key] = source[key];
  const parsed = FunnelNodeStyleSchema.safeParse(style);
  return parsed.success ? parsed.data : {};
}

function legacyComponentToNode(component: unknown, index: number): FunnelNode {
  const record = (component && typeof component === "object" && !Array.isArray(component)) ? component as Record<string, unknown> : {};
  const rawProps = (record.props && typeof record.props === "object" && !Array.isArray(record.props)) ? record.props as Record<string, unknown> : {};
  const typeName = typeof record.type === "string" ? record.type : "Text";
  const type = legacyTypeMap[typeName] ?? "text";
  const id = identifier.safeParse(rawProps.id).success ? String(rawProps.id) : `legacy_${index}`;
  const props = { ...rawProps };
  delete props.id;
  delete props.children;
  delete props.first;
  delete props.second;
  delete props.third;
  const node: FunnelNode = { schemaVersion: FUNNEL_PAGE_DOCUMENT_SCHEMA_VERSION, id, type, props, style: styleFromLegacy(rawProps.style), overrides: {}, visible: true, actions: [], attributes: {} };
  const children = Array.isArray(rawProps.children) ? rawProps.children : [];
  if (type === "section") {
    node.children = [{ schemaVersion: 1, id: `${id}_row`, type: "row", props: {}, style: {}, overrides: {}, visible: true, actions: [], attributes: {}, children: children.map((child, childIndex) => legacyComponentToNode(child, childIndex)) }];
  } else if (["content_box", "carousel", "faq"].includes(type)) {
    node.children = children.map((child, childIndex) => legacyComponentToNode(child, childIndex));
  }
  return node;
}

/** Adapter boundary for existing Puck/LandingPageContent drafts. */
export function landingPageContentToPageDocument(value: unknown, options: { id?: string; name?: string } = {}): PageDocument | null {
  const legacy = parseLandingPageContent(value);
  if (!legacy) return null;
  const content = legacy.data.content as unknown[];
  const root = content.map((item, index) => {
    const node = legacyComponentToNode(item, index);
    if (node.type === "section") return node;
    const column: FunnelNode = { schemaVersion: 1, id: `${node.id}_column`, type: "columns_2", props: {}, style: {}, overrides: {}, visible: true, actions: [], attributes: {}, children: [node] };
    const row: FunnelNode = { schemaVersion: 1, id: `${node.id}_row`, type: "row", props: {}, style: {}, overrides: {}, visible: true, actions: [], attributes: {}, children: [column] };
    return { schemaVersion: 1, id: `section_${node.id}`, type: "section", props: {}, style: {}, overrides: {}, visible: true, actions: [], attributes: {}, children: [row] };
  });
  return parsePageDocument({ schemaVersion: 1, id: options.id ?? "legacy-page", name: options.name ?? legacy.data.root.props?.title ?? "未命名頁面", root, popups: [], settings: {} });
}

function nodeToLegacyComponent(node: FunnelNode): Record<string, unknown> {
  const map: Record<FunnelNodeType, string> = {
    text: "Text", headline: "Heading", bulleted_list: "Text", content_box: "Section", image: "Image", video: "Video", audio: "Text", carousel: "Carousel", columns_4: "Columns", columns_3: "Columns", columns_2: "Columns", row: "Section", section: "Section", form: "Section", form_input: "Text", button: "Button", checkbox: "Text", calendar: "Text", x_share_button: "Button", survey: "Text", countdown: "Countdown", menu: "Text", horizontal_line: "Text", raw_html: "Text", faq: "FAQ", recaptcha: "Text", payment_button: "Button", payment_method: "Text", customer_type: "Text", physical_product: "Text", offer_price: "Text", agreement: "Text", order_bump: "Text", coupon: "Text", two_step_order_form: "Section", shipping_fees: "Text", paid_calendar: "Text",
  };
  const props: Record<string, unknown> = { ...node.props, id: node.id };
  delete props.style;
  const hasChildren = Boolean(node.children?.length);
  if (node.type === "content_box" && !hasChildren) {
    return { type: "Text", props: { id: node.id, text: typeof node.props.title === "string" ? node.props.title : typeof node.props.headline === "string" ? node.props.headline : typeof node.props.description === "string" ? node.props.description : "內容" } };
  }
  if (node.type === "content_box") {
    return { type: "Section", props: { id: node.id, children: node.children?.map(nodeToLegacyComponent) ?? [] } };
  }
  if (["form", "two_step_order_form"].includes(node.type)) {
    return { type: "Section", props: { id: node.id, children: node.children?.map(nodeToLegacyComponent) ?? [] } };
  }
  if (node.type === "image") {
    return { type: "Image", props: { id: node.id, src: typeof node.props.src === "string" ? node.props.src : typeof node.props.imageUrl === "string" ? node.props.imageUrl : "/placeholder.svg", alt: typeof node.props.alt === "string" ? node.props.alt : "" } };
  }
  if (node.type === "headline") { props.text = typeof props.text === "string" ? props.text : "標題"; props.level = props.level ?? "h2"; }
  if (node.type === "text") props.text = typeof props.text === "string" ? props.text : "文字內容";
  if (node.type === "button") { props.label = typeof props.label === "string" ? props.label : "立即行動"; props.action = props.action ?? { type: "anchor", targetId: node.id }; }
  if (node.children?.length) props.children = node.children.map(nodeToLegacyComponent);
  return { type: map[node.type], props };
}

/** Best-effort reverse adapter. Unsupported v1 nodes become safe text nodes. */
export function pageDocumentToLandingPageContent(document: PageDocument): LandingPageContent | null {
  const parsed = parsePageDocument(document);
  if (!parsed) return null;
  const content = parsed.root.flatMap((section) => {
    const rows = section.children ?? [];
    return rows.flatMap((row) => (row.children ?? []).flatMap((column) => (column.children ?? []).map(nodeToLegacyComponent)));
  });
  return parseLandingPageContent({ schemaVersion: 1, data: { root: parsed.settings.seo.title ? { props: { title: parsed.settings.seo.title } } : {}, content } });
}

export const fromLandingPageContent = landingPageContentToPageDocument;
export const toLandingPageContent = pageDocumentToLandingPageContent;
