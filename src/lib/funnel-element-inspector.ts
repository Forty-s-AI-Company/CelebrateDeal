import type {
  FunnelNode,
  FunnelNodeAction,
  FunnelNodeStyle,
  FunnelNodeType,
} from "@/lib/funnel-page-document";
import type { FunnelNodePatch, FunnelPageCommand } from "@/lib/funnel-page-history";

/**
 * Declarative inspector metadata.  The editor and future alternative
 * surfaces share this registry instead of each maintaining a divergent list
 * of editable properties.
 */
export type FunnelInspectorGroup = "content" | "design" | "actions" | "advanced";
export type FunnelInspectorScope = "base" | "desktop" | "mobile";
export type FunnelInspectorFieldKind = "text" | "textarea" | "number" | "checkbox" | "select" | "list" | "menu_items" | "faq_items";

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
const restricted = (capabilityNote: string): FunnelElementInspectorDefinition => ({ fields: [...designFields, ...advancedFields], capabilityNote });

export const FUNNEL_ELEMENT_INSPECTOR_SCHEMA: Readonly<Record<FunnelNodeType, FunnelElementInspectorDefinition>> = {
  text: { fields: [content("text", "文字內容", "textarea"), ...designFields, ...advancedFields] },
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
  raw_html: restricted("Raw HTML 依安全策略維持不可執行狀態，無法輸入或預覽自訂程式碼。"),
  faq: { fields: [content("items", "問題與答案", "faq_items", "每行「問題 | 答案」。"), ...designFields, ...advancedFields] },
  recaptcha: restricted("reCAPTCHA 尚未有可驗證的安全整合，維持待驗證狀態。"),
  payment_button: restricted("付款元件尚未連接商品與付款資料，維持方案限制。"),
  payment_method: restricted("付款元件尚未連接商品與付款資料，維持方案限制。"),
  customer_type: restricted("付款元件尚未連接商品與付款資料，維持方案限制。"),
  physical_product: restricted("付款元件尚未連接商品與付款資料，維持方案限制。"),
  offer_price: restricted("付款元件尚未連接商品與付款資料，維持方案限制。"),
  agreement: restricted("付款元件尚未連接商品與付款資料，維持方案限制。"),
  order_bump: restricted("付款元件尚未連接商品與付款資料，維持方案限制。"),
  coupon: restricted("付款元件尚未連接商品與付款資料，維持方案限制。"),
  two_step_order_form: restricted("付款元件尚未連接商品與付款資料，維持方案限制。"),
  shipping_fees: restricted("付款元件尚未連接商品與付款資料，維持方案限制。"),
  paid_calendar: restricted("付費行事曆需先完成安全付款整合，維持方案限制。"),
};

export function getFunnelElementInspectorDefinition(type: FunnelNodeType) {
  return FUNNEL_ELEMENT_INSPECTOR_SCHEMA[type];
}

function trimLineList(value: string) {
  return value.split(/\r?\n/u).map((item) => item.trim()).filter(Boolean).slice(0, 100);
}

function safeInspectorHref(value: string) {
  const href = value.trim();
  return (href.startsWith("/") && !href.startsWith("//")) || href.startsWith("#") || /^https:\/\//iu.test(href);
}

function menuItems(value: string) {
  return trimLineList(value).flatMap((line) => {
    const [rawLabel, rawHref] = line.split("|").map((part) => part.trim());
    if (!rawLabel) return [];
    return [{ label: rawLabel.slice(0, 240), href: rawHref && safeInspectorHref(rawHref) ? rawHref : "#" }];
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
  const patch = scopedPatch(scope, node, field, value);
  return patch ? { type: "update", nodeId: node.id, patch } : null;
}

export type FunnelInspectorActionInput = { type: FunnelNodeAction["type"]; href?: string; popupId?: string; formId?: string; stepId?: string; newTab?: boolean; fileName?: string };

/** Create a validated action update; incomplete or unsafe links are rejected. */
export function createFunnelInspectorActionUpdate(node: FunnelNode, input: FunnelInspectorActionInput): FunnelPageCommand | null {
  let action: FunnelNodeAction;
  switch (input.type) {
    case "none": return { type: "update", nodeId: node.id, patch: { actions: [] } };
    case "submit_form": action = input.formId ? { type: "submit_form", formId: input.formId } : { type: "submit_form" }; break;
    case "show_popup": if (!input.popupId) return null; action = { type: "show_popup", popupId: input.popupId }; break;
    case "next_step": if (!input.stepId) return null; action = { type: "next_step", stepId: input.stepId }; break;
    case "open_url": if (!input.href || !safeInspectorHref(input.href)) return null; action = { type: "open_url", href: input.href.trim(), newTab: input.newTab === true }; break;
    case "download": if (!input.href || !safeInspectorHref(input.href)) return null; action = { type: "download", href: input.href.trim(), ...(input.fileName?.trim() ? { fileName: input.fileName.trim().slice(0, 240) } : {}) }; break;
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
