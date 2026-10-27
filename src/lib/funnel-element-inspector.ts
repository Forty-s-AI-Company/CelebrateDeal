import type {
  FunnelNode,
  FunnelNodeAction,
  FunnelNodeStyle,
  FunnelNodeType,
} from "@/lib/funnel-page-document";
import type { FunnelNodePatch, FunnelPageCommand } from "@/lib/funnel-page-history";
import { isSafeContentHref } from "@/lib/safe-url";
import { FUNNEL_CUSTOM_CODE_LIMITS, utf8ByteLength } from "@/lib/funnel-custom-code";

/**
 * Declarative inspector metadata.  The editor and future alternative
 * surfaces share this registry instead of each maintaining a divergent list
 * of editable properties.
 */
export type FunnelInspectorGroup = "content" | "design" | "actions" | "advanced";
export type FunnelInspectorScope = "base" | "desktop" | "mobile";
export type FunnelInspectorFieldKind = "text" | "textarea" | "number" | "checkbox" | "select" | "list" | "menu_items" | "faq_items" | "code";

export interface FunnelInspectorField {
  id: string;
  label: string;
  group: FunnelInspectorGroup;
  kind: FunnelInspectorFieldKind;
  target: "props" | "style" | "visible" | "attributes";
  description?: string;
  options?: readonly { value: string; label: string }[];
  min?: number;
  max?: number;
  step?: number;
  responsive?: boolean;
  disabled?: boolean;
  /** `code` fields: UTF-8 byte limit, enforced again by the server schema. */
  maxBytes?: number;
  /** `code` fields: language shown to the merchant. */
  language?: "html" | "css" | "js";
}

export interface FunnelElementInspectorDefinition {
  fields: readonly FunnelInspectorField[];
  capabilityNote?: string;
}

const content = (id: string, label: string, kind: FunnelInspectorFieldKind = "text", description?: string): FunnelInspectorField => ({ id, label, kind, group: "content", target: "props", responsive: true, description });
const toggle = (id: string, label: string, description?: string): FunnelInspectorField => content(id, label, "checkbox", description);

const designFields: readonly FunnelInspectorField[] = [
  { id: "fontSize", label: "字型大小", group: "design", kind: "number", target: "style", min: 1, max: 240, responsive: true },
  { id: "lineHeight", label: "行高", group: "design", kind: "number", target: "style", min: 0.5, max: 5, step: 0.1, responsive: true },
  { id: "padding", label: "內距", group: "design", kind: "number", target: "style", min: 0, max: 1000, responsive: true },
  { id: "margin", label: "外距", group: "design", kind: "number", target: "style", min: -1000, max: 1000, responsive: true },
  { id: "width", label: "寬度（%）", group: "design", kind: "number", target: "style", min: 0, max: 100, responsive: true },
  { id: "textAlign", label: "文字對齊", group: "design", kind: "select", target: "style", responsive: true, options: [{ value: "left", label: "靠左" }, { value: "center", label: "置中" }, { value: "right", label: "靠右" }, { value: "justify", label: "左右對齊" }] },
  { id: "direction", label: "版面方向", group: "design", kind: "select", target: "style", responsive: true, options: [{ value: "row", label: "水平" }, { value: "column", label: "垂直" }] },
  { id: "imageWidth", label: "圖片寬度（%）", group: "design", kind: "number", target: "style", min: 0, max: 100, responsive: true },
  { id: "imageHeight", label: "圖片高度", group: "design", kind: "number", target: "style", min: 0, max: 10000, responsive: true },
  { id: "visible", label: "顯示這個元件", group: "design", kind: "checkbox", target: "visible", responsive: true },
];

const advancedFields: readonly FunnelInspectorField[] = [
  { id: "id", label: "HTML ID", group: "advanced", kind: "text", target: "attributes", description: "限英數、底線及連字號；不得使用事件屬性。" },
];

const layout: readonly FunnelInspectorField[] = [content("ariaLabel", "輔助說明"), ...designFields, ...advancedFields];
/** 自訂程式碼欄位：只編輯基礎值（不支援桌機／手機覆寫），不修剪空白。 */
const code = (id: "html" | "css" | "js", label: string, description: string): FunnelInspectorField => ({ id, label, kind: "code", group: "content", target: "props", responsive: false, maxBytes: FUNNEL_CUSTOM_CODE_LIMITS[id], language: id, description });
const customCodeFields: readonly FunnelInspectorField[] = [
  code("html", "HTML", "原樣放進隔離的沙箱 iframe；沒有 JS 時只保留安全的排版標籤。"),
  code("css", "CSS", "只作用在這個元件的 iframe 內。可用 https:// 載入字型與圖片。"),
  code("js", "JavaScript", "只在預覽與公開頁的隔離沙箱中執行，無法讀取平台 Cookie 或後台，也不能使用 fetch／XHR；但仍可載入 https 圖片等資源，資料並非無法離開沙箱。需 owner 或 admin，且 Email 已驗證。"),
  content("title", "iframe 說明（無障礙）"),
  { id: "height", label: "預設高度（px）", group: "content", kind: "number", target: "props", min: 40, max: 20_000, description: "含 JS 時會依內容自動調整；沒有 JS 時固定為這個高度。" },
];
const restricted = (capabilityNote: string): FunnelElementInspectorDefinition => ({ fields: [...designFields, ...advancedFields], capabilityNote });

export const FUNNEL_ELEMENT_INSPECTOR_SCHEMA: Readonly<Record<FunnelNodeType, FunnelElementInspectorDefinition>> = {
  text: { fields: [content("text", "文字內容", "textarea"), { ...content("textStyle", "文字樣式", "select", "未設定時為內文；字級與行高依頁面設定自動計算。"), options: [{ value: "body", label: "內文" }, { value: "lead", label: "引言（較大）" }, { value: "small", label: "小字" }, { value: "eyebrow", label: "眉標" }] }, ...designFields, ...advancedFields] },
  headline: { fields: [content("text", "標題", "textarea"), { ...content("level", "標題層級", "select"), options: [{ value: "h1", label: "H1" }, { value: "h2", label: "H2" }, { value: "h3", label: "H3" }, { value: "h4", label: "H4" }] }, ...designFields, ...advancedFields] },
  bulleted_list: { fields: [content("items", "清單項目", "list", "每行一個項目。"), ...designFields, ...advancedFields] },
  content_box: { fields: [content("text", "預設內容", "textarea", "盒內沒有子元件時才會顯示。"), ...designFields, ...advancedFields] },
  image: { fields: [content("src", "圖片網址", "text"), content("alt", "替代文字"), content("caption", "圖片說明", "textarea"), ...designFields, ...advancedFields] },
  video: { fields: [content("src", "影片網址"), content("poster", "封面圖片網址"), toggle("controls", "顯示播放控制"), toggle("autoplay", "自動播放"), ...designFields, ...advancedFields] },
  audio: { fields: [content("src", "音訊網址"), toggle("controls", "顯示播放控制"), ...designFields, ...advancedFields] },
  carousel: { fields: [content("ariaLabel", "輪播說明"), ...designFields, ...advancedFields] },
  columns_4: { fields: layout },
  columns_3: { fields: layout },
  columns_2: { fields: layout },
  row: { fields: layout },
  section: { fields: layout },
  form: { fields: [content("title", "表單標題"), content("ariaLabel", "表單說明"), ...designFields, ...advancedFields] },
  form_input: { fields: [content("label", "欄位標籤"), content("placeholder", "提示文字"), { ...content("inputType", "欄位類型", "select"), options: [{ value: "text", label: "文字" }, { value: "email", label: "Email" }, { value: "tel", label: "電話" }, { value: "number", label: "數字" }] }, content("defaultValue", "預設值"), toggle("required", "必填"), ...designFields, ...advancedFields] },
  button: { fields: [content("label", "按鈕文字"), ...designFields, ...advancedFields] },
  checkbox: { fields: [content("label", "核取方塊文字"), toggle("required", "必填"), toggle("checked", "預設勾選"), ...designFields, ...advancedFields] },
  calendar: { fields: [content("eventId", "行事曆事件 ID", "text", "需由既有安全預約整合提供。"), ...designFields, ...advancedFields] },
  x_share_button: { fields: [content("url", "分享網址"), ...designFields, ...advancedFields] },
  survey: { fields: [content("question", "問題", "textarea"), content("options", "選項", "list", "每行一個選項。"), toggle("multiple", "可複選"), ...designFields, ...advancedFields] },
  countdown: { fields: [content("targetDate", "截止時間", "text", "使用 ISO 日期時間，例如 2026-12-31T23:59:00+08:00。"), ...designFields, ...advancedFields] },
  menu: { fields: [content("items", "選單項目", "menu_items", "每行「名稱 | HTTPS 網址或 #錨點」。"), ...designFields, ...advancedFields] },
  horizontal_line: { fields: [...designFields, ...advancedFields] },
  raw_html: { fields: [...customCodeFields, ...designFields, ...advancedFields] },
  faq: { fields: [content("items", "問題與答案", "faq_items", "每行「問題 | 答案」。"), ...designFields, ...advancedFields] },
  recaptcha: restricted("reCAPTCHA 尚未有可驗證的安全整合，維持待驗證狀態。"),
  payment_button: restricted("付款元件尚未連接商品與付款資料。"),
  payment_method: restricted("付款元件尚未連接商品與付款資料。"),
  customer_type: restricted("付款元件尚未連接商品與付款資料。"),
  physical_product: restricted("付款元件尚未連接商品與付款資料。"),
  offer_price: restricted("付款元件尚未連接商品與付款資料。"),
  agreement: restricted("付款元件尚未連接商品與付款資料。"),
  order_bump: restricted("付款元件尚未連接商品與付款資料。"),
  coupon: restricted("付款元件尚未連接商品與付款資料。"),
  two_step_order_form: restricted("付款元件尚未連接商品與付款資料。"),
  shipping_fees: restricted("付款元件尚未連接商品與付款資料。"),
  paid_calendar: restricted("付費行事曆需先完成安全付款整合。"),
};

export function getFunnelElementInspectorDefinition(type: FunnelNodeType) {
  return FUNNEL_ELEMENT_INSPECTOR_SCHEMA[type];
}

function trimLineList(value: string) {
  return value.split(/\r?\n/u).map((item) => item.trim()).filter(Boolean).slice(0, 100);
}

/** Same rule as the persisted document and the renderer (`@/lib/safe-url`). */
export function isSafeInspectorHref(value: string) {
  return isSafeContentHref(value.trim());
}

function menuItems(value: string) {
  return trimLineList(value).flatMap((line) => {
    const [rawLabel, rawHref] = line.split("|").map((part) => part.trim());
    if (!rawLabel) return [];
    return [{ label: rawLabel.slice(0, 240), href: rawHref && isSafeInspectorHref(rawHref) ? rawHref : "#" }];
  });
}

function faqItems(value: string) {
  return trimLineList(value).flatMap((line) => {
    const [question, answer] = line.split("|").map((part) => part.trim());
    return question ? [{ question: question.slice(0, 240), answer: (answer ?? "").slice(0, 10_000) }] : [];
  });
}

function fieldValue(field: FunnelInspectorField, value: unknown): unknown | null {
  if (field.kind === "checkbox") return value === true;
  if (field.kind === "number") {
    const number = typeof value === "number" ? value : Number(value);
    if (!Number.isFinite(number) || (field.min !== undefined && number < field.min) || (field.max !== undefined && number > field.max)) return null;
    return number;
  }
  if (typeof value !== "string") return null;
  if (field.kind === "code") return utf8ByteLength(value) <= (field.maxBytes ?? 0) ? value : null;
  const text = value.trim();
  if (field.kind === "list") return trimLineList(text);
  if (field.kind === "menu_items") return menuItems(text);
  if (field.kind === "faq_items") return faqItems(text);
  if (field.target === "attributes") return text === "" ? "" : sanitizeFunnelHtmlId(text);
  return text.slice(0, 10_000);
}

/** Validate the only arbitrary HTML attribute surfaced by this inspector. */
export function sanitizeFunnelHtmlId(value: string): string | null {
  const htmlId = value.trim();
  return /^[A-Za-z][A-Za-z0-9_-]{0,99}$/u.test(htmlId) ? htmlId : null;
}

function scopedPatch(scope: FunnelInspectorScope, node: FunnelNode, field: FunnelInspectorField, value: unknown): FunnelNodePatch | null {
  const nextValue = fieldValue(field, value);
  if (nextValue === null) return null;
  if (field.target === "attributes") {
    const attributes = { ...node.attributes };
    if (nextValue) attributes[field.id] = nextValue as string;
    else delete attributes[field.id];
    return { attributes };
  }
  if (scope !== "base" && !field.responsive) return null;
  if (field.target === "visible") {
    return scope === "base" ? { visible: Boolean(nextValue) } : { overrides: { [scope]: { visible: Boolean(nextValue) } } };
  }
  const target = field.target;
  if (target !== "props" && target !== "style") return null;
  if (scope === "base") return target === "props" ? { props: { [field.id]: nextValue } } : { style: { [field.id]: nextValue } as Partial<FunnelNodeStyle> };
  return { overrides: { [scope]: { [target]: { [field.id]: nextValue } } } };
}

/**
 * Converts one inspector edit to the structured history command.  Invalid
 * values intentionally return null, so callers never persist malformed data.
 */
export function createFunnelInspectorUpdate(node: FunnelNode, scope: FunnelInspectorScope, field: FunnelInspectorField, value: unknown): FunnelPageCommand | null {
  if (field.disabled) return null;
  const patch = scopedPatch(field.kind === "code" ? "base" : scope, node, field, value);
  return patch ? { type: "update", nodeId: node.id, patch } : null;
}

/** `formId` is a form node on the page (submit_form); `registrationFormId` is a registration form record (registration). */
export type FunnelInspectorActionInput = { type: FunnelNodeAction["type"]; href?: string; popupId?: string; formId?: string; stepId?: string; newTab?: boolean; fileName?: string; registrationFormId?: string; useBoundLive?: boolean };

/** Create a validated action update; incomplete or unsafe links are rejected. */
export function createFunnelInspectorActionUpdate(node: FunnelNode, input: FunnelInspectorActionInput): FunnelPageCommand | null {
  let action: FunnelNodeAction;
  switch (input.type) {
    case "none": return { type: "update", nodeId: node.id, patch: { actions: [] } };
    case "submit_form": action = input.formId ? { type: "submit_form", formId: input.formId } : { type: "submit_form" }; break;
    case "show_popup": if (!input.popupId) return null; action = { type: "show_popup", popupId: input.popupId }; break;
    case "next_step": if (!input.stepId) return null; action = { type: "next_step", stepId: input.stepId }; break;
    case "open_url": if (!input.href || !isSafeInspectorHref(input.href)) return null; action = { type: "open_url", href: input.href.trim(), newTab: input.newTab === true }; break;
    case "download": if (!input.href || !isSafeInspectorHref(input.href)) return null; action = { type: "download", href: input.href.trim(), ...(input.fileName?.trim() ? { fileName: input.fileName.trim().slice(0, 240) } : {}) }; break;
    // Ownership of the form is validated by the server on save; here only the id format is checked.
    case "registration": if (!input.registrationFormId || !/^[A-Za-z0-9_-]{1,100}$/u.test(input.registrationFormId)) return null; action = { type: "registration", formId: input.registrationFormId, useBoundLive: input.useBoundLive !== false }; break;
    default: return null;
  }
  return { type: "update", nodeId: node.id, patch: { actions: [action] } };
}

function valueToLines(value: unknown, kind: FunnelInspectorFieldKind): string {
  if (kind === "list" && Array.isArray(value)) return value.filter((item): item is string => typeof item === "string").join("\n");
  if (kind === "menu_items" && Array.isArray(value)) return value.flatMap((item) => item && typeof item === "object" && !Array.isArray(item) ? [`${String((item as Record<string, unknown>).label ?? "")} | ${String((item as Record<string, unknown>).href ?? "")}`] : []).join("\n");
  if (kind === "faq_items" && Array.isArray(value)) return value.flatMap((item) => item && typeof item === "object" && !Array.isArray(item) ? [`${String((item as Record<string, unknown>).question ?? "")} | ${String((item as Record<string, unknown>).answer ?? "")}`] : []).join("\n");
  return typeof value === "string" || typeof value === "number" ? String(value) : "";
}

/** Resolve base + responsive override exactly as the shared renderer does. */
export function getFunnelInspectorFieldValue(node: FunnelNode, scope: FunnelInspectorScope, field: FunnelInspectorField): string | number | boolean {
  if (field.target === "attributes") return node.attributes[field.id] ?? "";
  if (field.kind === "code") {
    const stored = node.props[field.id] ?? (field.id === "html" ? node.props.content : undefined);
    return typeof stored === "string" ? stored : "";
  }
  let value: unknown;
  if (field.target === "visible") value = scope === "base" ? node.visible : node.overrides[scope]?.visible ?? node.visible;
  else {
    const base = field.target === "props" ? node.props[field.id] : node.style[field.id as keyof FunnelNodeStyle];
    const override = scope === "base" ? undefined : field.target === "props"
      ? node.overrides[scope]?.props?.[field.id]
      : node.overrides[scope]?.style?.[field.id as keyof FunnelNodeStyle];
    value = override ?? base;
  }
  if (field.kind === "checkbox") return value === true;
  if (field.kind === "list" || field.kind === "menu_items" || field.kind === "faq_items") return valueToLines(value, field.kind);
  return typeof value === "string" || typeof value === "number" ? value : "";
}
