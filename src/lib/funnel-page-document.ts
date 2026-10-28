import { z } from "zod";

import { parseFunnelFlow, type FunnelFlow } from "@/lib/funnel-flow";
import { FunnelCommerceBindingSchema } from "@/lib/funnel-commerce";
import { isSafeContentHref } from "@/lib/safe-url";
import { FUNNEL_CUSTOM_CODE_LIMITS, utf8ByteLength } from "@/lib/funnel-custom-code";
import { compileFunnelCustomCss, FUNNEL_PAGE_CUSTOM_CSS_MAX_BYTES } from "@/lib/funnel-custom-css";

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
  // Showcase elements (props-driven, no children); prop readers live in `@/lib/funnel-showcase`.
  "nav_bar", "logo_strip", "stats", "icon_list", "shape_divider", "section_title", "image_cards",
  "testimonial_wall", "content_cards", "video_gallery",
  // Webinar elements (props-driven; `webinar_state` holds one content box per event state). Readers live in `@/lib/funnel-webinar-elements`.
  "event_facts", "speaker_profiles", "agenda_timeline", "callout", "fit_compare", "add_to_calendar", "announcement_bar",
  "value_stack", "session_schedule", "deadline_notice", "webinar_state", "media_frame", "image_gallery", "code_snippet",
] as const;
export type FunnelNodeType = (typeof FUNNEL_NODE_TYPES)[number];

export const FUNNEL_BLOCK_CATEGORIES = [
  "order_forms", "opt_in_forms", "features", "page_footers", "team_presentation",
  "welcome", "price_plans", "page_headers", "testimonials", "social_proof", "content_showcase", "call_to_action", "webinar_sections",
] as const;
export type FunnelBlockCategory = (typeof FUNNEL_BLOCK_CATEGORIES)[number];

export type FunnelCapabilityStatus = "available" | "disabled" | "limited" | "unverified";
export type FunnelCapability = { status: FunnelCapabilityStatus; reason: string; upgradeRequired?: boolean };

const identifier = z.string().trim().min(1).max(100).regex(/^[A-Za-z0-9_-]+$/u, "識別碼只能包含英數、底線與連字號");
const safeShortText = z.string().trim().max(240);
const safeHref = z.string().trim().max(2_048).refine(isSafeContentHref, "網址只允許同源路徑、錨點或 HTTPS");

/**
 * Documents saved before `@/lib/safe-url` may hold a link the earlier check
 * accepted but that resolves off-site (for example "/\evil.example", which
 * browsers read as "//evil.example"). Such a value is dropped on read so the
 * page still renders, just without that link. Anything the earlier check
 * already rejected keeps failing the whole document, exactly as before.
 */
function isRetiredUnsafeHref(value: unknown): boolean {
  if (typeof value !== "string") return false;
  const trimmed = value.trim();
  if (trimmed.length > 2_048 || isSafeContentHref(trimmed)) return false;
  if (/^[\u0000-\u0020]/u.test(trimmed) || /[\u0000-\u001f\u007f]/u.test(trimmed)) return false;
  return (trimmed.startsWith("/") && !trimmed.startsWith("//")) || trimmed.startsWith("#") || /^https:\/\//iu.test(trimmed);
}
type RetiredHrefField = "action_href" | "background_image" | "social_image";
/** Counts of links dropped during the current parsePageDocument call (never the URL itself). */
let retiredHrefCounts: Partial<Record<RetiredHrefField, number>> | null = null;
function noteRetiredHref(field: RetiredHrefField) {
  if (retiredHrefCounts) retiredHrefCounts[field] = (retiredHrefCounts[field] ?? 0) + 1;
}
const optionalSafeHref = (field: RetiredHrefField) => z.preprocess((value) => {
  if (!isRetiredUnsafeHref(value)) return value;
  noteRetiredHref(field);
  return undefined;
}, safeHref.optional()).optional();
function withoutRetiredUnsafeLinkActions(value: unknown): unknown {
  if (!Array.isArray(value)) return value;
  return value.filter((action: unknown) => {
    if (!action || typeof action !== "object") return true;
    const record = action as Record<string, unknown>;
    const retired = (record.type === "open_url" || record.type === "download") && isRetiredUnsafeHref(record.href);
    if (retired) noteRetiredHref("action_href");
    return !retired;
  });
}
const safeColor = z.string().trim().max(32).regex(/^(#[0-9a-f]{3,8}|rgb\([0-9, .]+\)|rgba\([0-9, .]+\)|transparent|white|black)$/iu, "顏色格式不正確");
const safeCssToken = z.string().trim().max(120).refine((value) => !/[{};<>]/u.test(value) && !/\b(?:javascript|data|vbscript):/iu.test(value), "樣式值不安全");

const JSON_STRING_MAX = 10_000;
const JsonValueSchema: z.ZodType<unknown> = z.lazy(() => z.union([
  z.string().max(JSON_STRING_MAX), z.number().finite(), z.boolean(), z.null(),
  z.array(JsonValueSchema).max(100), z.record(z.string().max(100), JsonValueSchema),
]));
/**
 * Top-level node props. Only the 自訂程式碼 (`raw_html`) fields may exceed the
 * generic 10,000-character string limit; the node `superRefine` below enforces that.
 */
const CUSTOM_CODE_STRING_MAX = Math.max(...Object.values(FUNNEL_CUSTOM_CODE_LIMITS));
const NodePropsSchema = z.record(z.string().max(100), z.union([JsonValueSchema, z.string().max(CUSTOM_CODE_STRING_MAX)]));
const CUSTOM_CODE_PROP_LIMITS: Readonly<Record<string, number>> = { ...FUNNEL_CUSTOM_CODE_LIMITS, content: FUNNEL_CUSTOM_CODE_LIMITS.html };

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

/**
 * Responsive overrides. `desktop` historically meant every width ≥ 640px, so a
 * tablet render (640–1079px) applies `desktop` first and then `tablet`.
 */
export const FunnelNodeOverridesSchema = z.object({
  desktop: NodeOverrideSchema.optional(),
  tablet: NodeOverrideSchema.optional(),
  mobile: NodeOverrideSchema.optional(),
}).strict();

const NodeActionSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("none") }).strict(),
  z.object({ type: z.literal("submit_form"), formId: identifier.optional() }).strict(),
  z.object({ type: z.literal("show_popup"), popupId: identifier }).strict(),
  z.object({ type: z.literal("open_url"), href: safeHref, newTab: z.boolean().default(false) }).strict(),
  z.object({ type: z.literal("next_step"), stepId: identifier }).strict(),
  z.object({ type: z.literal("download"), href: safeHref, fileName: safeShortText.optional() }).strict(),
  /**
   * Opens a hosted registration form. Only the form id is stored: the public
   * slug and the draft's bound live are resolved from server records at render
   * time, and the server validates the form (vendor, project, active) on save,
   * publish and public load via `registrationFormIdsInContent`.
   */
  z.object({ type: z.literal("registration"), formId: identifier, useBoundLive: z.boolean().default(true) }).strict(),
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
  rawHtml: defaultCapability("available", "自訂程式碼只在隔離的沙箱 iframe 內執行，碰不到平台 Cookie、後台或其他商家；含 JS 需 owner／admin 且 Email 已驗證"),
  tracking: defaultCapability("disabled", "追蹤碼與自訂程式碼需經安全整合後才可啟用"),
  recaptcha: defaultCapability("unverified", "目前沒有可驗證的 reCAPTCHA 網域金鑰，因此暫不可用"),
  exitIntent: defaultCapability("available", "桌機游標從視窗頂端離開時單次觸發；行動裝置不支援"),
  affiliate: defaultCapability("disabled", "聯盟徽章尚未連接可驗證的方案資料"),
} as const satisfies Record<string, { status: FunnelCapabilityStatus; reason: string; upgradeRequired?: boolean }>;

const NodeSchemaBase = z.object({
  schemaVersion: z.literal(FUNNEL_PAGE_DOCUMENT_SCHEMA_VERSION),
  id: identifier,
  type: z.enum(FUNNEL_NODE_TYPES),
  props: NodePropsSchema.default({}),
  style: FunnelNodeStyleSchema.default({}),
  overrides: FunnelNodeOverridesSchema.default({}),
  visible: z.boolean().default(true),
  actions: z.preprocess(withoutRetiredUnsafeLinkActions, z.array(NodeActionSchema).max(20)).default([]),
  attributes: NodeAttributesSchema.default({}),
  children: z.array(z.lazy(() => FunnelNodeSchema)).max(100).optional(),
}).strict().superRefine((node, context) => {
  for (const [key, value] of Object.entries(node.props)) {
    if (typeof value !== "string") continue;
    const customLimit = node.type === "raw_html" ? CUSTOM_CODE_PROP_LIMITS[key] : undefined;
    if (customLimit === undefined ? value.length > JSON_STRING_MAX : utf8ByteLength(value) > customLimit) {
      context.addIssue({ code: "custom", path: ["props", key], message: customLimit === undefined ? "文字內容過長" : `自訂程式碼的 ${key.toUpperCase()} 超過 ${customLimit / 1000} KB 上限` });
    }
  }
  if (node.type === "raw_html") {
    for (const key of ["html", "css", "js"] as const) {
      if (node.props[key] !== undefined && typeof node.props[key] !== "string") context.addIssue({ code: "custom", path: ["props", key], message: "自訂程式碼必須是文字" });
    }
  }
});

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
const WEBINAR_LEAF_PARENTS = ["row", "columns_2", "columns_3", "columns_4", "content_box"] as const;
const payment = FUNNEL_CAPABILITIES.payment;
const definitions: Record<FunnelNodeType, FunnelNodeDefinition> = {
  text: { label: "文字", category: "text", children: false, allowedParents: ["row", "columns_2", "columns_3", "columns_4", "content_box", "faq", "form"], capability: available },
  headline: { label: "標題", category: "text", children: false, allowedParents: ["row", "columns_2", "columns_3", "columns_4", "content_box", "faq", "form"], capability: available },
  bulleted_list: { label: "項目清單", category: "text", children: false, allowedParents: ["row", "columns_2", "columns_3", "columns_4", "content_box"], capability: available },
  content_box: { label: "內容盒", category: "text", children: true, allowedParents: ["row", "columns_2", "columns_3", "columns_4", "webinar_state"], capability: available },
  image: { label: "圖片", category: "media", children: false, allowedParents: ["row", "columns_2", "columns_3", "columns_4", "content_box", "faq"], capability: available },
  video: { label: "影片", category: "media", children: false, allowedParents: ["row", "columns_2", "columns_3", "columns_4", "content_box"], capability: available },
  audio: { label: "音訊", category: "media", children: false, allowedParents: ["row", "columns_2", "columns_3", "columns_4", "content_box"], capability: available },
  carousel: { label: "輪播", category: "media", children: true, allowedParents: ["row", "columns_2", "columns_3", "columns_4"], capability: available },
  columns_4: { label: "四欄", category: "layout", children: true, allowedParents: ["row"], capability: available },
  columns_3: { label: "三欄", category: "layout", children: true, allowedParents: ["row"], capability: available },
  columns_2: { label: "兩欄", category: "layout", children: true, allowedParents: ["row"], capability: available },
  row: { label: "列", category: "layout", children: true, allowedParents: ["section"], capability: available },
  section: { label: "區段", category: "layout", children: true, allowedParents: ["root"], capability: available },
  form: { label: "表單", category: "form", children: true, allowedParents: ["row", "columns_2", "columns_3", "columns_4", "content_box"], capability: available },
  form_input: { label: "表單欄位", category: "form", children: false, allowedParents: ["form", "row", "columns_2", "columns_3", "columns_4"], capability: available },
  button: { label: "按鈕", category: "form", children: false, allowedParents: ["form", "row", "columns_2", "columns_3", "columns_4", "content_box"], capability: available },
  checkbox: { label: "核取方塊", category: "form", children: false, allowedParents: ["form", "row", "columns_2", "columns_3", "columns_4"], capability: available },
  calendar: { label: "行事曆", category: "form", children: false, allowedParents: ["row", "columns_2", "columns_3", "columns_4"], capability: available },
  x_share_button: { label: "X 分享按鈕", category: "social", children: false, allowedParents: ["row", "columns_2", "columns_3", "columns_4", "content_box"], capability: available },
  survey: { label: "問卷", category: "form", children: false, allowedParents: ["row", "columns_2", "columns_3", "columns_4"], capability: available },
  countdown: { label: "倒數計時", category: "other", children: false, allowedParents: ["root", "section", "row", "columns_2", "columns_3", "columns_4", "content_box"], capability: available },
  menu: { label: "選單", category: "other", children: false, allowedParents: ["row", "columns_2", "columns_3", "columns_4", "section"], capability: available },
  horizontal_line: { label: "水平線", category: "other", children: false, allowedParents: ["row", "columns_2", "columns_3", "columns_4", "content_box"], capability: available },
  raw_html: { label: "自訂程式碼", category: "other", children: false, allowedParents: ["row", "columns_2", "columns_3", "columns_4", "content_box"], capability: FUNNEL_CAPABILITIES.rawHtml },
  faq: { label: "常見問題", category: "other", children: true, allowedParents: ["row", "columns_2", "columns_3", "columns_4", "content_box"], capability: available },
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
  nav_bar: { label: "導覽列", category: "layout", children: false, allowedParents: ["root", "section", "row"], capability: available },
  shape_divider: { label: "分隔形狀", category: "layout", children: false, allowedParents: ["root", "section", "row"], capability: available },
  section_title: { label: "區塊標題組", category: "text", children: false, allowedParents: ["row", "columns_2", "columns_3", "columns_4", "content_box"], capability: available },
  icon_list: { label: "圖示重點", category: "text", children: false, allowedParents: ["row", "columns_2", "columns_3", "columns_4", "content_box"], capability: available },
  stats: { label: "數據統計", category: "other", children: false, allowedParents: ["row", "columns_2", "columns_3", "columns_4", "content_box"], capability: available },
  logo_strip: { label: "Logo 列", category: "media", children: false, allowedParents: ["row", "columns_2", "columns_3", "columns_4", "content_box"], capability: available },
  image_cards: { label: "圖片卡片", category: "media", children: false, allowedParents: ["row", "columns_2", "columns_3", "columns_4", "content_box"], capability: available },
  content_cards: { label: "文章卡片", category: "media", children: false, allowedParents: ["row", "columns_2", "columns_3", "columns_4", "content_box"], capability: available },
  video_gallery: { label: "影片牆", category: "media", children: false, allowedParents: ["row", "columns_2", "columns_3", "columns_4", "content_box"], capability: available },
  testimonial_wall: { label: "評價牆", category: "social", children: false, allowedParents: ["row", "columns_2", "columns_3", "columns_4", "content_box"], capability: available },
  event_facts: { label: "活動資訊列", category: "other", children: false, allowedParents: WEBINAR_LEAF_PARENTS, capability: available },
  speaker_profiles: { label: "講者卡", category: "social", children: false, allowedParents: WEBINAR_LEAF_PARENTS, capability: available },
  agenda_timeline: { label: "議程時間軸", category: "text", children: false, allowedParents: WEBINAR_LEAF_PARENTS, capability: available },
  callout: { label: "提示框", category: "text", children: false, allowedParents: WEBINAR_LEAF_PARENTS, capability: available },
  fit_compare: { label: "適合／不適合", category: "text", children: false, allowedParents: WEBINAR_LEAF_PARENTS, capability: available },
  add_to_calendar: { label: "加入行事曆", category: "other", children: false, allowedParents: WEBINAR_LEAF_PARENTS, capability: available },
  announcement_bar: { label: "頂部公告條", category: "layout", children: false, allowedParents: ["root", "section", "row"], capability: available },
  value_stack: { label: "價值清單", category: "text", children: false, allowedParents: WEBINAR_LEAF_PARENTS, capability: available },
  session_schedule: { label: "場次表", category: "other", children: false, allowedParents: WEBINAR_LEAF_PARENTS, capability: available },
  deadline_notice: { label: "報名截止提示", category: "other", children: false, allowedParents: WEBINAR_LEAF_PARENTS, capability: available },
  webinar_state: { label: "依活動狀態切換", category: "layout", children: true, allowedParents: ["row", "columns_2", "columns_3", "columns_4", "content_box"], capability: available },
  media_frame: { label: "裝置框", category: "media", children: false, allowedParents: WEBINAR_LEAF_PARENTS, capability: available },
  image_gallery: { label: "作品集圖庫", category: "media", children: false, allowedParents: WEBINAR_LEAF_PARENTS, capability: available },
  code_snippet: { label: "程式碼片段", category: "text", children: false, allowedParents: WEBINAR_LEAF_PARENTS, capability: available },
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

/** C-04 固定報名列。target 是頁面上的 HTML id（不含 #）；留空時捲到第一個報名表單。 */
export const FunnelStickyCtaSchema = z.object({
  enabled: z.boolean().default(false),
  label: z.string().trim().min(1).max(40).default("立即報名"),
  target: identifier.optional(),
  showDate: z.boolean().default(true),
  devices: z.enum(["mobile", "mobile_tablet", "all"]).default("mobile_tablet"),
  backgroundColor: safeColor.optional(),
  buttonColor: safeColor.optional(),
  buttonTextColor: safeColor.optional(),
}).strict();
export type FunnelStickyCta = z.infer<typeof FunnelStickyCtaSchema>;

const PageSettingsSchema = z.object({
  typography: z.object({
    bodyFont: safeCssToken.default("system-ui"), headingFont: safeCssToken.default("system-ui"),
    bodySize: z.number().finite().min(8).max(120).default(16), bodyLineHeight: z.number().finite().min(0.5).max(5).default(1.5),
    linkColor: safeColor.default("#2563eb"), textColor: safeColor.default("#0f172a"), alignment: z.enum(["left", "center", "right"]).default("left"),
    // R3: optional so documents saved before it parse to the exact same value; renderer falls back to textColor.
    headingColor: safeColor.optional(),
  }).strict().default({ bodyFont: "system-ui", headingFont: "system-ui", bodySize: 16, bodyLineHeight: 1.5, linkColor: "#2563eb", textColor: "#0f172a", alignment: "left" }),
  language: z.enum(["zh-TW", "en", "fr", "es", "it", "pt", "de", "nl", "ru", "ja", "ar", "tr", "sv", "ro", "cs", "hu", "sk", "da", "id", "pl", "el", "sr", "hi", "no", "th", "sl", "uk", "sq"]).default("zh-TW"),
  background: z.object({ color: safeColor.default("white"), imageUrl: optionalSafeHref("background_image"), blur: z.number().finite().min(0).max(100).default(0) }).strict().default({ color: "white", blur: 0 }),
  seo: z.object({ title: safeShortText.optional(), description: z.string().trim().max(320).optional(), keywords: z.string().trim().max(500).optional(), author: safeShortText.optional(), socialImage: optionalSafeHref("social_image"), hideFromSearch: z.boolean().default(false) }).strict().default({ hideFromSearch: false }),
  tracking: FunnelCapabilityStatusSchema.default(FUNNEL_CAPABILITIES.tracking),
  affiliate: FunnelCapabilityStatusSchema.default(FUNNEL_CAPABILITIES.affiliate),
  /**
   * 頁面自訂 CSS（原始碼）。儲存時必須能通過 `compileFunnelCustomCss`；渲染時
   * 再編譯一次，只輸出加上 `[data-funnel-content]` 範圍前綴的結果。
   */
  customCss: z.string().max(FUNNEL_PAGE_CUSTOM_CSS_MAX_BYTES).refine((css) => compileFunnelCustomCss(css).ok, "頁面自訂 CSS 含有不支援或不安全的語法").optional(),
  /**
   * Webinar 範本的頁面層級設定，全部選填：舊文件解析結果不變。
   * - eventTitle：動態欄位 `{{webinar.title}}` 與加入行事曆使用的活動名稱。
   * - scrollReveal：section 第一層子節點的捲動進場動畫（只改 opacity／transform）。
   * - stickyCta：行動版固定報名列；由平台在內容外框「外」渲染，只接受結構化欄位。
   */
  eventTitle: safeShortText.optional(),
  scrollReveal: z.enum(["none", "fade", "rise"]).optional(),
  stickyCta: FunnelStickyCtaSchema.optional(),
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
  flow: z.custom<FunnelFlow>((value) => parseFunnelFlow(value) !== null, { message: "一頁式網站流程資料不符合格式" }).optional(),
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
  const outerCounts = retiredHrefCounts;
  const counts: Partial<Record<RetiredHrefField, number>> = {};
  retiredHrefCounts = counts;
  try { parsed = PageDocumentSchema.safeParse(value); } catch { return null; } finally { retiredHrefCounts = outerCounts; }
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
  // Observability for links dropped from stored content: per-field counts only, never the URL.
  if (Object.keys(counts).length) console.warn("funnel_href_retired", counts);
  return parsed.data;
}

/**
 * Diagnostics only (template tests and authoring): the first reason `parsePageDocument`
 * rejects a value, e.g. a schema path or a duplicate node id; null when it is valid.
 */
export function explainPageDocumentIssue(value: unknown): string | null {
  const outerCounts = retiredHrefCounts;
  retiredHrefCounts = {};
  let parsed: ReturnType<typeof PageDocumentSchema.safeParse>;
  try { parsed = PageDocumentSchema.safeParse(value); } catch (error) { return error instanceof Error ? error.message : "無法解析"; } finally { retiredHrefCounts = outerCounts; }
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    return first ? `${first.path.join(".") || "(root)"}：${first.message}` : "格式不符";
  }
  const state = { ids: new Set<string>(), htmlIds: new Set<string>(), count: 0, references: new Set<object>() };
  return validateNodeTree(parsed.data.root, "root", 1, state);
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
