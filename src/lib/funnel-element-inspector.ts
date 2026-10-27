import type {
  FunnelNode,
  FunnelNodeAction,
  FunnelNodeStyle,
  FunnelNodeType,
} from "@/lib/funnel-page-document";
import type { FunnelNodePatch, FunnelPageCommand } from "@/lib/funnel-page-history";
import { isSafeContentHref } from "@/lib/safe-url";
import { FUNNEL_CUSTOM_CODE_LIMITS, utf8ByteLength } from "@/lib/funnel-custom-code";
import { SHOWCASE_ICON_LABELS, SHOWCASE_SOCIAL_LABELS } from "@/lib/funnel-showcase";

/**
 * Declarative inspector metadata.  The editor and future alternative
 * surfaces share this registry instead of each maintaining a divergent list
 * of editable properties.
 */
export type FunnelInspectorGroup = "content" | "design" | "actions" | "advanced";
export type FunnelInspectorScope = "base" | "desktop" | "mobile";
export type FunnelInspectorFieldKind = "text" | "textarea" | "number" | "checkbox" | "select" | "list" | "menu_items" | "faq_items" | "color" | "image" | "repeater" | "code";

/** One sub-field of a repeater item (testimonial, logo, stat…). */
export type FunnelInspectorItemFieldKind = "text" | "textarea" | "number" | "checkbox" | "select" | "image" | "url";
export interface FunnelInspectorItemField {
  key: string;
  label: string;
  kind: FunnelInspectorItemFieldKind;
  options?: readonly { value: string; label: string }[];
  placeholder?: string;
  min?: number;
  max?: number;
}

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
  /** Repeater only: the fields of each item, the item noun ("評價") and the item limit. */
  itemFields?: readonly FunnelInspectorItemField[];
  itemLabel?: string;
  maxItems?: number;
  /** Repeater only: values of a newly added item. */
  newItem?: Readonly<Record<string, string | number | boolean>>;
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

const options = (entries: Readonly<Record<string, string>>) => Object.entries(entries).map(([value, label]) => ({ value, label }));
const select = (id: string, label: string, entries: Readonly<Record<string, string>>, description?: string): FunnelInspectorField => ({ ...content(id, label, "select", description), options: options(entries) });
const number = (id: string, label: string, min: number, max: number, description?: string): FunnelInspectorField => ({ ...content(id, label, "number", description), min, max });
const propColor = (id: string, label: string, description?: string): FunnelInspectorField => ({ id, label, kind: "color", group: "design", target: "props", responsive: false, description });
const styleColor = (id: "backgroundColor" | "color" | "borderColor", label: string, description?: string): FunnelInspectorField => ({ id, label, kind: "color", group: "design", target: "style", responsive: true, description });
const imageField = (id: string, label: string, description?: string): FunnelInspectorField => ({ ...content(id, label, "image", description), responsive: false });
const repeater = (id: string, label: string, itemLabel: string, itemFields: readonly FunnelInspectorItemField[], newItem: Record<string, string | number | boolean>, description?: string, maxItems = 24): FunnelInspectorField => ({ id, label, kind: "repeater", group: "content", target: "props", responsive: false, itemFields, itemLabel, newItem, maxItems, description });
const item = (key: string, label: string, kind: FunnelInspectorItemFieldKind = "text", extra: Partial<FunnelInspectorItemField> = {}): FunnelInspectorItemField => ({ key, label, kind, ...extra });

/** Colours of the wrapper (section and box backgrounds, text) — the same allow-list as the persisted style. */
const surfaceColorFields: readonly FunnelInspectorField[] = [styleColor("backgroundColor", "背景顏色"), styleColor("color", "文字顏色")];
const accentField = propColor("accentColor", "強調色", "按鈕、圖示與裝飾線的顏色；預設為金色 #c9a063。");
const columnsField = number("columns", "桌機欄數", 1, 4, "手機版一律單欄。");

const showcaseFields: Readonly<Record<"nav_bar" | "logo_strip" | "stats" | "icon_list" | "shape_divider" | "section_title" | "image_cards" | "testimonial_wall" | "content_cards" | "video_gallery", readonly FunnelInspectorField[]>> = {
  nav_bar: [
    content("brand", "品牌名稱"), imageField("logoSrc", "Logo 圖片", "建議使用透明背景的橫式 Logo。"), number("logoHeight", "Logo 高度（px）", 16, 96),
    content("homeHref", "Logo 連結", "text", "預設回到頁首（#top）。"),
    repeater("items", "選單項目", "選單項目", [item("label", "名稱"), item("href", "連結", "url", { placeholder: "#about 或 https://…" }), item("submenu", "下拉選單", "textarea", { placeholder: "每行「名稱 | 連結」，留空則沒有下拉選單" })], { label: "新項目", href: "#" }, "有下拉選單的項目在桌機以滑鼠移上或點擊展開，手機版收進漢堡選單。", 10),
    repeater("socials", "社群連結", "社群連結", [item("network", "平台", "select", { options: options(SHOWCASE_SOCIAL_LABELS) }), item("href", "連結", "url", { placeholder: "https://… 或 Email" })], { network: "facebook", href: "https://" }, undefined, 8),
    content("ctaLabel", "按鈕文字"), { ...content("ctaHref", "按鈕連結"), description: "HTTPS 網址、本站路徑或 #錨點。" },
    { ...content("sticky", "捲動時固定在頁面頂端", "checkbox"), responsive: false }, accentField, ...surfaceColorFields,
  ],
  logo_strip: [
    content("title", "說明文字", "text", "例如「媒體報導」；留空則不顯示。"),
    repeater("items", "Logo", "Logo", [item("src", "Logo 圖片", "image"), item("alt", "名稱（替代文字）"), item("href", "連結（選填）", "url")], { src: "/placeholder.svg", alt: "合作夥伴" }, "可上傳多張 Logo；建議使用透明背景圖檔。"),
    select("tone", "Logo 色調", { original: "原色", grayscale: "灰階", light: "單色（淺色，用於深色背景）", dark: "單色（深色，用於淺色背景）" }),
    number("logoHeight", "Logo 高度（px）", 16, 120), ...surfaceColorFields,
  ],
  stats: [
    repeater("items", "數據", "數據", [item("value", "數字", "text", { placeholder: "例如 12800 或 4.9" }), item("prefix", "前綴（選填）"), item("suffix", "單位（選填）", "text", { placeholder: "例如 +、%、位" }), item("label", "說明", "textarea")], { value: "100", suffix: "+", label: "說明" }, "純數字會在捲動到畫面時由 0 計數；使用者設定「減少動態效果」時直接顯示結果。", 6),
    { ...content("animate", "捲動到畫面時計數", "checkbox"), responsive: false }, { ...content("framed", "加上金框", "checkbox"), responsive: false }, accentField, ...surfaceColorFields,
  ],
  icon_list: [
    repeater("items", "重點", "重點", [item("icon", "圖示", "select", { options: options(SHOWCASE_ICON_LABELS) }), item("title", "標題"), item("text", "說明", "textarea")], { icon: "check", title: "新的重點", text: "" }, undefined, 12),
    { ...content("numbered", "顯示編號", "checkbox"), responsive: false }, select("layout", "排列方式", { list: "單欄清單", grid: "多欄網格" }), columnsField, accentField, ...surfaceColorFields,
  ],
  shape_divider: [
    select("shape", "形狀", { triangle: "倒三角", slant: "斜切", wave: "波浪", curve: "弧形" }),
    select("position", "方向", { top: "從上方延伸（接續上一個區塊）", bottom: "從下方延伸（接續下一個區塊）" }),
    number("height", "高度（px）", 8, 240), { ...content("flip", "左右翻轉", "checkbox"), responsive: false },
    styleColor("color", "形狀顏色", "通常設為相鄰區塊的背景色。"), styleColor("backgroundColor", "背後顏色", "通常設為另一側區塊的背景色。"),
  ],
  section_title: [
    content("eyebrow", "英文小標"), content("title", "主標題", "textarea", "用 *星號* 包住的文字會以強調色顯示，例如「把人生的舵，*交回自己手上*」。"), content("subtitle", "副標題", "textarea"),
    select("level", "標題層級", { h1: "H1", h2: "H2", h3: "H3" }), select("decoration", "裝飾線", { line: "顯示", none: "隱藏" }),
    { ...content("eyebrowItalic", "小標使用斜體", "checkbox"), responsive: false }, accentField,
  ],
  image_cards: [
    repeater("items", "卡片", "卡片", [item("src", "圖片", "image"), item("alt", "替代文字"), item("title", "標題"), item("text", "說明", "textarea"), item("href", "連結（選填）", "url"), item("linkLabel", "連結文字")], { src: "/placeholder.svg", title: "新的卡片" }),
    columnsField, select("aspect", "圖片比例", { "4:3": "4:3", "1:1": "1:1", "3:4": "3:4（直式）", "16:9": "16:9" }), { ...content("corners", "角落三角裝飾", "checkbox"), responsive: false }, accentField,
  ],
  testimonial_wall: [
    repeater("items", "評價", "評價", [item("avatar", "頭像", "image"), item("name", "名稱"), item("verified", "顯示驗證勾", "checkbox"), item("date", "日期", "text", { placeholder: "例如 2026 年 9 月" }), item("rating", "星等（0–5）", "number", { min: 0, max: 5 }), item("title", "標題"), item("text", "內容", "textarea")], { name: "學員", verified: true, rating: 5, title: "", text: "" }, "只放真實、經同意公開的評價。", 24),
    select("rows", "排數", { "2": "兩排（桌機）", "1": "一排" }), { ...content("autoplay", "自動橫向捲動", "checkbox", "滑鼠移上或鍵盤聚焦時停止；訪客也可以按「暫停輪播」。"), responsive: false },
    select("speed", "捲動速度", { slow: "慢", normal: "一般", fast: "快" }), { ...content("showRating", "顯示星等", "checkbox"), responsive: false },
    propColor("cardColor", "卡片背景色"), propColor("cardTextColor", "卡片文字色"), accentField,
  ],
  content_cards: [
    repeater("items", "文章", "文章", [item("src", "縮圖", "image"), item("alt", "替代文字"), item("category", "分類標籤"), item("date", "日期"), item("title", "標題"), item("text", "摘要", "textarea"), item("href", "連結", "url"), item("linkLabel", "連結文字", "text", { placeholder: "READ MORE" })], { src: "/placeholder.svg", title: "新的文章", href: "#" }),
    columnsField, propColor("cardColor", "卡片背景色"), propColor("cardTextColor", "卡片文字色"), accentField,
  ],
  video_gallery: [
    repeater("items", "影片", "影片", [item("url", "影片網址", "url", { placeholder: "https://www.youtube.com/watch?v=…" }), item("title", "標題"), item("thumbnail", "自訂縮圖（選填）", "image")], { url: "", title: "新的影片" }, "YouTube 影片在訪客按下播放後才以 youtube-nocookie 隱私模式載入；其他網址會在新分頁開啟。", 12),
    columnsField, accentField,
  ],
};

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
const sectionFields: readonly FunnelInspectorField[] = [
  content("ariaLabel", "輔助說明"), ...surfaceColorFields,
  imageField("backgroundImage", "背景圖片", "只接受 HTTPS 網址或本站路徑；文字請搭配遮罩確保可讀。"),
  select("backgroundPosition", "背景圖位置", { center: "置中", left: "靠左", right: "靠右", top: "靠上", bottom: "靠下" }),
  propColor("overlayColor", "遮罩顏色"), number("overlayOpacity", "遮罩不透明度（0–100）", 0, 100),
  select("overlayFade", "遮罩漸層", { none: "全區均勻", right: "左深右淺", left: "右深左淺", bottom: "上深下淺", top: "下深上淺" }),
  ...designFields, ...advancedFields,
];
const restricted = (capabilityNote: string): FunnelElementInspectorDefinition => ({ fields: [...designFields, ...advancedFields], capabilityNote });

export const FUNNEL_ELEMENT_INSPECTOR_SCHEMA: Readonly<Record<FunnelNodeType, FunnelElementInspectorDefinition>> = {
  text: { fields: [content("text", "文字內容", "textarea"), { ...content("textStyle", "文字樣式", "select", "未設定時為內文；字級與行高依頁面設定自動計算。"), options: [{ value: "body", label: "內文" }, { value: "lead", label: "引言（較大）" }, { value: "small", label: "小字" }, { value: "eyebrow", label: "眉標" }] }, ...designFields, ...advancedFields] },
  headline: { fields: [content("text", "標題", "textarea"), { ...content("level", "標題層級", "select"), options: [{ value: "h1", label: "H1" }, { value: "h2", label: "H2" }, { value: "h3", label: "H3" }, { value: "h4", label: "H4" }] }, ...designFields, ...advancedFields] },
  bulleted_list: { fields: [content("items", "清單項目", "list", "每行一個項目。"), ...designFields, ...advancedFields] },
  content_box: { fields: [content("text", "預設內容", "textarea", "盒內沒有子元件時才會顯示。"), ...surfaceColorFields, styleColor("borderColor", "邊框顏色"), select("decoration", "裝飾", { none: "無", frame: "內框線", corners: "四角框線" }), propColor("decorationColor", "裝飾顏色"), ...designFields, ...advancedFields] },
  image: { fields: [content("src", "圖片網址", "text"), content("alt", "替代文字"), content("caption", "圖片說明", "textarea"), ...designFields, ...advancedFields] },
  video: { fields: [content("src", "影片網址"), content("poster", "封面圖片網址"), toggle("controls", "顯示播放控制"), toggle("autoplay", "自動播放"), ...designFields, ...advancedFields] },
  audio: { fields: [content("src", "音訊網址"), toggle("controls", "顯示播放控制"), ...designFields, ...advancedFields] },
  carousel: { fields: [content("ariaLabel", "輪播說明"), ...designFields, ...advancedFields] },
  columns_4: { fields: layout },
  columns_3: { fields: layout },
  columns_2: { fields: layout },
  row: { fields: layout },
  section: { fields: sectionFields },
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
  nav_bar: { fields: [...showcaseFields.nav_bar, ...advancedFields] },
  logo_strip: { fields: [...showcaseFields.logo_strip, ...designFields, ...advancedFields] },
  stats: { fields: [...showcaseFields.stats, ...designFields, ...advancedFields] },
  icon_list: { fields: [...showcaseFields.icon_list, ...designFields, ...advancedFields] },
  shape_divider: { fields: [...showcaseFields.shape_divider, { id: "visible", label: "顯示這個元件", group: "design", kind: "checkbox", target: "visible", responsive: true }, ...advancedFields] },
  section_title: { fields: [...showcaseFields.section_title, ...designFields, ...advancedFields] },
  image_cards: { fields: [...showcaseFields.image_cards, ...designFields, ...advancedFields] },
  testimonial_wall: { fields: [...showcaseFields.testimonial_wall, ...designFields, ...advancedFields] },
  content_cards: { fields: [...showcaseFields.content_cards, ...designFields, ...advancedFields] },
  video_gallery: { fields: [...showcaseFields.video_gallery, ...designFields, ...advancedFields] },
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

const SAFE_COLOR_VALUE = /^(#[0-9a-f]{3}|#[0-9a-f]{6}|#[0-9a-f]{8}|rgb\(\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}\s*\)|transparent|white|black)$/iu;

/** Each repeater item keeps only its declared keys, with values coerced to the declared kind. */
function repeaterItems(field: FunnelInspectorField, value: unknown): Record<string, string | number | boolean>[] | null {
  if (!Array.isArray(value)) return null;
  const fields = field.itemFields ?? [];
  return value.slice(0, field.maxItems ?? 24).map((entry) => {
    const record = entry && typeof entry === "object" && !Array.isArray(entry) ? entry as Record<string, unknown> : {};
    const output: Record<string, string | number | boolean> = {};
    for (const sub of fields) {
      const raw = record[sub.key];
      if (sub.kind === "checkbox") { output[sub.key] = raw === true; continue; }
      if (sub.kind === "number") {
        const number = typeof raw === "number" ? raw : typeof raw === "string" && raw.trim() ? Number(raw) : Number.NaN;
        if (Number.isFinite(number)) output[sub.key] = Math.min(sub.max ?? Number.MAX_SAFE_INTEGER, Math.max(sub.min ?? -Number.MAX_SAFE_INTEGER, number));
        continue;
      }
      if (typeof raw !== "string") continue;
      if (sub.kind === "select") { if (sub.options?.some((option) => option.value === raw)) output[sub.key] = raw; continue; }
      output[sub.key] = (sub.kind === "image" || sub.kind === "url" ? raw.trim() : raw).slice(0, sub.kind === "textarea" ? 2_000 : 2_048);
    }
    return output;
  });
}

function fieldValue(field: FunnelInspectorField, value: unknown): unknown | null {
  if (field.kind === "repeater") return repeaterItems(field, value);
  if (field.kind === "color") {
    const text = typeof value === "string" ? value.trim().toLowerCase() : "";
    // Clearing a colour removes the style key (undefined) or stores "" for props, which renderers treat as "use the default".
    if (!text) return field.target === "style" ? undefined : "";
    return SAFE_COLOR_VALUE.test(text) ? text : null;
  }
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

/** Repeater items as stored (base value; repeaters are not responsive). */
export function getFunnelInspectorItems(node: FunnelNode, field: FunnelInspectorField): Record<string, unknown>[] {
  const value = node.props[field.id];
  return Array.isArray(value) ? value.filter((entry): entry is Record<string, unknown> => Boolean(entry) && typeof entry === "object" && !Array.isArray(entry)) : [];
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
  if (field.kind === "repeater") return "";
  return typeof value === "string" || typeof value === "number" ? value : "";
}
