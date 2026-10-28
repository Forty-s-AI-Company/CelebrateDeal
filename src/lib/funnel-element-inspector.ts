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
import { CODE_LANGUAGE_LABELS, WEBINAR_STATE_LABELS } from "@/lib/funnel-webinar-elements";
import { FUNNEL_EVENT_DEFAULT_TIMEZONE, isFunnelTimezone, zonedLocalInputToIso } from "@/lib/funnel-event-time";

/**
 * Declarative inspector metadata.  The editor and future alternative
 * surfaces share this registry instead of each maintaining a divergent list
 * of editable properties.
 */
export type FunnelInspectorGroup = "content" | "design" | "actions" | "advanced";
export type FunnelInspectorScope = "base" | "desktop" | "tablet" | "mobile";
/**
 * `datetime` fields store a UTC ISO string; the editor shows a date-time picker
 * in the node's `timezone` prop (default Asia/Taipei), so merchants never type
 * ISO strings (I-5).
 */
export type FunnelInspectorFieldKind = "text" | "textarea" | "number" | "checkbox" | "select" | "list" | "menu_items" | "faq_items" | "color" | "image" | "repeater" | "code" | "datetime";

/** One sub-field of a repeater item (testimonial, logo, stat…). */
export type FunnelInspectorItemFieldKind = "text" | "textarea" | "number" | "checkbox" | "select" | "image" | "url" | "datetime";
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

/** Date-time picker field; the value is stored as UTC ISO (see `FunnelInspectorFieldKind`). */
const datetime = (id: string, label: string, description?: string): FunnelInspectorField => ({ ...content(id, label, "datetime", description), responsive: false });
const lines = (id: string, label: string, description = "每行一點。"): FunnelInspectorField => ({ ...content(id, label, "list", description), responsive: false });
const webinarAccent = propColor("accentColor", "強調色", "圖示、時間與標籤的顏色；預設為頁面連結色。");
const eventSource = select("source", "時間來源", { webinar: "漏斗的線上講座排程（建議）", manual: "在這個元件自訂" }, "建議用漏斗設定的講座時間，改一次全站更新；未設定時顯示「時間公布中」。");
const eventTimezone = select("timezone", "時區（自訂時間）", { "Asia/Taipei": "台灣（Asia/Taipei）", "Asia/Hong_Kong": "香港", "Asia/Singapore": "新加坡", "Asia/Tokyo": "日本", "America/Los_Angeles": "美西", "America/New_York": "美東", "Europe/London": "英國", "UTC": "UTC" });

/** C-01～C-18（webinar 範本元件）的屬性面板。 */
const webinarFields: Readonly<Record<"event_facts" | "speaker_profiles" | "agenda_timeline" | "callout" | "fit_compare" | "add_to_calendar" | "announcement_bar" | "value_stack" | "session_schedule" | "deadline_notice" | "media_frame" | "image_gallery" | "code_snippet", readonly FunnelInspectorField[]>> = {
  event_facts: [
    select("layout", "版型", { row: "橫列（平板與手機為 2×2）", grid: "格狀", card: "卡片" }), content("title", "卡片標題（卡片版型）"),
    content("formatLabel", "形式", "text", "例如「線上直播」「回放」；留空則不顯示。"), content("priceLabel", "費用", "text", "例如「免費」；留空則不顯示。"),
    toggle("showDate", "顯示日期"), toggle("showTime", "顯示時間"), toggle("showTimezone", "時間後顯示時區"), toggle("showDuration", "顯示活動長度"),
    eventSource, datetime("startsAt", "開始時間（自訂時間）"), datetime("endsAt", "結束時間（自訂時間）"), eventTimezone,
    webinarAccent, propColor("cardColor", "底色"), propColor("cardTextColor", "文字色"),
  ],
  speaker_profiles: [
    select("layout", "版型", { featured: "主講者（大照片左右分欄）", grid: "多位講者（格狀）", duo: "雙講者（中間 ×）" }),
    select("size", "主講者尺寸", { large: "大", small: "小（圓形頭像置中）" }),
    repeater("items", "講者", "講者", [item("photo", "照片", "image"), item("alt", "照片替代文字"), item("name", "姓名"), item("role", "職稱"), item("bio", "簡介（2–3 行）", "textarea"), item("tags", "成就標籤", "text", { placeholder: "最多 3 個，用逗號分隔" }), item("href", "個人網站（選填）", "url"), item("linkLabel", "連結文字")], { name: "講者姓名", role: "職稱" }, "沒有照片時會顯示姓名首字的漸層頭像。", 8),
    select("photoShape", "照片比例", { portrait: "4:5 直式", square: "1:1 方形", circle: "圓形" }), number("columns", "桌機欄數（格狀）", 1, 4, "平板最多 2 欄，手機單欄。"),
    webinarAccent, propColor("gradientFrom", "頭像漸層起始色"), propColor("gradientTo", "頭像漸層結束色"),
  ],
  agenda_timeline: [
    select("layout", "版型", { vertical: "直式時間軸", cards: "卡片（桌機 3 欄）", steps: "編號步驟" }),
    repeater("items", "議程", "議程", [item("time", "時間", "text", { placeholder: "例如 20:00" }), item("title", "標題"), item("text", "說明", "textarea"), item("speaker", "講者（選填）"), item("tag", "標籤（選填）")], { time: "20:00", title: "新的議程" }, "時間是議程內的相對時段，活動日期請在漏斗排程設定。", 12),
    webinarAccent, propColor("cardColor", "卡片底色"),
  ],
  callout: [
    select("tone", "語氣", { info: "資訊（藍）", warning: "注意（橘）", compliance: "合規聲明（灰）" }), content("title", "標題"),
    content("text", "內容", "textarea", "最多 3 段，用空白行分段。適合投資風險、醫療衛教聲明或活動注意事項。"),
  ],
  fit_compare: [
    content("fitTitle", "適合欄標題"), lines("fitItems", "適合的對象", "每行一點，最多 6 點。"),
    content("notFitTitle", "不適合欄標題"), lines("notFitItems", "不適合的對象", "每行一點，最多 6 點。"),
    propColor("fitColor", "適合欄顏色"), propColor("notFitColor", "不適合欄顏色"), propColor("cardColor", "卡片底色"),
  ],
  add_to_calendar: [
    content("googleLabel", "Google 按鈕文字"), content("icsLabel", "下載按鈕文字"), content("pendingText", "時間未定時的說明"),
    select("align", "對齊", { left: "靠左", center: "置中" }), webinarAccent,
  ],
  announcement_bar: [
    content("text", "公告文字", "textarea", "手機上會自動換行，不會截斷。"), content("linkLabel", "連結文字（選填）"), content("href", "連結（選填）", "text", "HTTPS 網址、本站路徑或 #錨點。"),
    toggle("showCountdown", "顯示開播倒數"), content("countdownLabel", "倒數前綴"),
    propColor("barColor", "背景色"), propColor("barTextColor", "文字色"),
  ],
  value_stack: [
    content("title", "標題"),
    repeater("items", "項目", "項目", [item("title", "項目"), item("text", "說明", "textarea"), item("value", "參考價值（文字）", "text", { placeholder: "例如 NT$1,980" })], { title: "新的項目", value: "" }, "價值只是展示文字，不會加總，也不會影響任何訂單或付款金額。", 10),
    content("totalLabel", "總計標籤"), content("totalValue", "總計（文字）"), content("originalPrice", "刪除線原價（選填）"), content("offerLabel", "本場優惠文字", "text", "例如「本場免費」。"),
    content("note", "說明小字", "text", "預設「價值為講者自訂參考，非售價承諾」。"), webinarAccent, propColor("cardColor", "卡片底色"), propColor("cardTextColor", "卡片文字色"),
  ],
  session_schedule: [
    repeater("items", "場次", "場次", [item("startsAt", "日期時間", "datetime"), item("title", "主題"), item("text", "說明", "textarea")], { title: "新的場次" }, "狀態依日期自動顯示（已結束／即將開始／報名中），不能手動標示額滿。報名仍綁定漏斗的講座場次。", 12),
    number("durationMinutes", "每場長度（分鐘）", 15, 600), webinarAccent,
  ],
  deadline_notice: [
    content("label", "前綴文字"), content("closedText", "截止後顯示"), webinarAccent,
  ],
  media_frame: [
    select("frame", "外框", { browser: "瀏覽器視窗", phone: "手機", laptop: "筆電" }), imageField("src", "畫面截圖"), content("alt", "替代文字"),
    content("url", "網址列文字（瀏覽器）"), select("aspect", "畫面比例（瀏覽器）", { "16:10": "16:10", "4:3": "4:3" }),
  ],
  image_gallery: [
    repeater("items", "作品", "作品", [item("src", "圖片", "image"), item("alt", "替代文字"), item("caption", "說明（選填）")], { src: "/placeholder.svg", alt: "作品" }, "點擊放大，可用方向鍵切換、Esc 關閉；圖片維持原比例，不裁切。", 24),
    select("layout", "排列", { masonry: "拼貼（保留原比例）", grid: "等高格狀" }), number("columns", "桌機欄數", 2, 4, "平板最多 2 欄，手機單欄。"),
  ],
  code_snippet: [
    content("filename", "檔名或標題"), select("language", "語言", CODE_LANGUAGE_LABELS), { ...content("code", "程式碼", "textarea", "只展示、不會執行；最多 6,000 字。"), responsive: false },
    toggle("showLineNumbers", "顯示行號"), toggle("showCopy", "顯示複製按鈕"),
  ],
};

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
    select("layout", "版型", { marquee: "橫向捲動（預設）", carousel: "輪播（按鈕切換，不自動播放）", grid: "格狀" }), number("columns", "每列欄數（格狀與輪播，桌機）", 1, 3, "平板最多 2 欄，手機單欄。"),
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
/** C-05: column ratio, tablet stacking and stacked order. */
const columnFields = (two: boolean): readonly FunnelInspectorField[] => [
  content("ariaLabel", "輔助說明"),
  ...(two ? [select("ratio", "欄寬比例（桌機、平板）", { "1:1": "1:1", "7:5": "7:5（左寬）", "5:7": "5:7（右寬）", "3:2": "3:2", "2:3": "2:3", "2:1": "2:1", "1:2": "1:2" })] : []),
  select("stackOn", "何時改成上下堆疊", { mobile: "只有手機（預設）", tablet: "平板與手機" }, two ? "平板寬度不足時，可讓首屏改成上下堆疊。" : "未堆疊時，平板一律 2 欄。"),
  select("mobileOrder", "堆疊時的順序", { default: "依原順序", reverse: "反轉（例如表單在前）" }, "會同時改變閱讀與鍵盤順序。"),
  number("gap", "欄距（px）", 0, 160), ...designFields, ...advancedFields,
];
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
  content_box: { fields: [content("text", "預設內容", "textarea", "盒內沒有子元件時才會顯示。"), select("webinarState", "只在活動狀態顯示（放在「依活動狀態切換」內）", { "": "所有狀態", ...WEBINAR_STATE_LABELS }), ...surfaceColorFields, styleColor("borderColor", "邊框顏色"), select("decoration", "裝飾", { none: "無", frame: "內框線", corners: "四角框線" }), propColor("decorationColor", "裝飾顏色"), ...designFields, ...advancedFields] },
  image: { fields: [content("src", "圖片網址", "text"), content("alt", "替代文字"), content("caption", "圖片說明", "textarea"), ...designFields, ...advancedFields] },
  video: { fields: [content("src", "影片網址"), content("poster", "封面圖片網址"), toggle("controls", "顯示播放控制"), toggle("autoplay", "自動播放"), ...designFields, ...advancedFields] },
  audio: { fields: [content("src", "音訊網址"), toggle("controls", "顯示播放控制"), ...designFields, ...advancedFields] },
  carousel: { fields: [content("ariaLabel", "輪播說明"), ...designFields, ...advancedFields] },
  columns_4: { fields: columnFields(false) },
  columns_3: { fields: columnFields(false) },
  columns_2: { fields: columnFields(true) },
  row: { fields: layout },
  section: { fields: sectionFields },
  form: { fields: [content("title", "表單標題"), content("ariaLabel", "表單說明"), ...designFields, ...advancedFields] },
  form_input: { fields: [content("label", "欄位標籤"), content("placeholder", "提示文字"), content("helpText", "說明文字", "text", "顯示在欄位下方，例如「報名後寄送直播連結」。"), select("width", "寬度", { full: "整列", half: "半列（手機一律整列）" }), content("name", "對應報名欄位 key", "text", "公開頁會用這個 key 對應報名表設定的欄位，例如 name、email、phone。"), { ...content("inputType", "欄位類型", "select"), options: [{ value: "text", label: "文字" }, { value: "email", label: "Email" }, { value: "tel", label: "電話" }, { value: "number", label: "數字" }] }, content("defaultValue", "預設值"), toggle("required", "必填"), ...designFields, ...advancedFields] },
  button: { fields: [content("label", "按鈕文字"), ...designFields, ...advancedFields] },
  checkbox: { fields: [content("label", "核取方塊文字"), toggle("required", "必填"), toggle("checked", "預設勾選"), ...designFields, ...advancedFields] },
  calendar: { fields: [content("eventId", "行事曆事件 ID", "text", "需由既有安全預約整合提供。"), ...designFields, ...advancedFields] },
  x_share_button: { fields: [content("url", "分享網址"), ...designFields, ...advancedFields] },
  survey: { fields: [content("question", "問題", "textarea"), content("options", "選項", "list", "每行一個選項。"), toggle("multiple", "可複選"), ...designFields, ...advancedFields] },
  countdown: { fields: [
    select("variant", "外觀", { blocks: "天時分秒四格", inline: "一行文字", bar: "頁首細長條" }),
    select("source", "倒數到", { fixed: "固定截止時間", webinar_start: "講座開播（漏斗排程）", registration_close: "報名截止（營運設定）" }, "到期後顯示「到期文字」，不會歸零後重新倒數。"),
    datetime("targetDate", "截止時間（固定截止）", "以台灣時間輸入。"), content("label", "前綴文字", "text", "例如「距離開播」。"),
    content("expiredText", "到期文字"), content("liveText", "直播中文字"), content("replayText", "回放期文字"),
    select("align", "對齊（四格）", { center: "置中", left: "靠左" }), webinarAccent, propColor("numberColor", "數字顏色"), propColor("cellColor", "格子底色"), propColor("barColor", "細長條底色"), propColor("barTextColor", "細長條文字色"),
    ...designFields, ...advancedFields,
  ] },
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
  event_facts: { fields: [...webinarFields.event_facts, ...designFields, ...advancedFields] },
  speaker_profiles: { fields: [...webinarFields.speaker_profiles, ...designFields, ...advancedFields] },
  agenda_timeline: { fields: [...webinarFields.agenda_timeline, ...designFields, ...advancedFields] },
  callout: { fields: [...webinarFields.callout, ...designFields, ...advancedFields] },
  fit_compare: { fields: [...webinarFields.fit_compare, ...designFields, ...advancedFields] },
  add_to_calendar: { fields: [...webinarFields.add_to_calendar, ...designFields, ...advancedFields] },
  announcement_bar: { fields: [...webinarFields.announcement_bar, { id: "visible", label: "顯示這個元件", group: "design", kind: "checkbox", target: "visible", responsive: true }, ...advancedFields] },
  value_stack: { fields: [...webinarFields.value_stack, ...designFields, ...advancedFields] },
  session_schedule: { fields: [...webinarFields.session_schedule, ...designFields, ...advancedFields] },
  deadline_notice: { fields: [...webinarFields.deadline_notice, ...designFields, ...advancedFields] },
  webinar_state: { fields: layout, capabilityNote: "在裡面放「內容盒」，並在每個內容盒選擇要顯示的活動狀態（開場前／直播中／回放期／已結束）；狀態依漏斗的講座排程自動切換。" },
  media_frame: { fields: [...webinarFields.media_frame, ...designFields, ...advancedFields] },
  image_gallery: { fields: [...webinarFields.image_gallery, ...designFields, ...advancedFields] },
  code_snippet: { fields: [...webinarFields.code_snippet, ...designFields, ...advancedFields] },
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
      if (sub.kind === "datetime") { const iso = funnelInspectorDateTime(raw); if (iso !== null) output[sub.key] = iso; continue; }
      output[sub.key] = (sub.kind === "image" || sub.kind === "url" ? raw.trim() : raw).slice(0, sub.kind === "textarea" ? 2_000 : 2_048);
    }
    return output;
  });
}

/**
 * Date-time input → stored UTC ISO. Accepts a picker value (YYYY-MM-DDTHH:mm in
 * `timezone`) or an ISO string; "" clears the value. Invalid input is null.
 */
export function funnelInspectorDateTime(value: string, timezone = FUNNEL_EVENT_DEFAULT_TIMEZONE): string | null {
  const text = value.trim();
  if (!text) return "";
  const zone = isFunnelTimezone(timezone) ? timezone : FUNNEL_EVENT_DEFAULT_TIMEZONE;
  const local = zonedLocalInputToIso(text, zone);
  if (local) return local;
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})$/u.test(text)) return null;
  const time = Date.parse(text);
  return Number.isFinite(time) ? new Date(time).toISOString() : null;
}

function fieldValue(field: FunnelInspectorField, value: unknown, timezone?: string): unknown | null {
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
  if (field.kind === "datetime") return funnelInspectorDateTime(value, timezone);
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
  const nextValue = fieldValue(field, value, typeof node.props.timezone === "string" ? node.props.timezone : undefined);
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
