import type { FunnelNodeStyle, FunnelNodeType } from "@/lib/funnel-page-document";

/**
 * Starting content of a showcase element added from the editor palette, so
 * the merchant sees a working example to edit instead of an empty box. All
 * text is generic placeholder copy; images point at the shipped placeholder.
 */
const PLACEHOLDER = "/placeholder.svg";

const DEFAULT_PROPS: Partial<Record<FunnelNodeType, Record<string, unknown>>> = {
  nav_bar: {
    brand: "品牌名稱", homeHref: "#top", sticky: true, ctaLabel: "立即報名", ctaHref: "#signup",
    items: [
      { label: "關於我們", href: "#about" },
      { label: "課程", href: "#courses", submenu: "入門課程 | #courses\n進階課程 | #courses" },
      { label: "常見問題", href: "#faq" },
    ],
    socials: [{ network: "facebook", href: "https://www.facebook.com/" }, { network: "instagram", href: "https://www.instagram.com/" }],
  },
  shape_divider: { shape: "triangle", position: "top", height: 64 },
  section_title: { eyebrow: "ABOUT US", title: "區塊標題", subtitle: "", level: "h2", decoration: "line" },
  icon_list: {
    numbered: true, layout: "list",
    items: [
      { icon: "compass", title: "第一個重點", text: "用一兩句話說明這個重點能帶給讀者什麼。" },
      { icon: "target", title: "第二個重點", text: "保持簡短，讓讀者快速掃過也能理解。" },
      { icon: "trophy", title: "第三個重點", text: "最後一點可以放成果或保證。" },
    ],
  },
  stats: {
    animate: true, framed: false,
    items: [{ value: "1200", suffix: "+", label: "學員人數" }, { value: "98", suffix: "%", label: "課程滿意度" }, { value: "15", suffix: "年", label: "教學經驗" }],
  },
  logo_strip: {
    title: "合作與報導", tone: "grayscale", logoHeight: 36,
    items: [{ src: PLACEHOLDER, alt: "合作夥伴一" }, { src: PLACEHOLDER, alt: "合作夥伴二" }, { src: PLACEHOLDER, alt: "合作夥伴三" }],
  },
  image_cards: {
    columns: 3, aspect: "4:3", corners: true,
    items: [
      { src: PLACEHOLDER, alt: "", title: "卡片標題一", text: "簡短說明。" },
      { src: PLACEHOLDER, alt: "", title: "卡片標題二", text: "簡短說明。" },
      { src: PLACEHOLDER, alt: "", title: "卡片標題三", text: "簡短說明。" },
    ],
  },
  content_cards: {
    columns: 3,
    items: [
      { src: PLACEHOLDER, alt: "", category: "分類", date: "2026-01-01", title: "文章標題一", text: "文章摘要。", href: "#", linkLabel: "READ MORE" },
      { src: PLACEHOLDER, alt: "", category: "分類", date: "2026-01-01", title: "文章標題二", text: "文章摘要。", href: "#", linkLabel: "READ MORE" },
      { src: PLACEHOLDER, alt: "", category: "分類", date: "2026-01-01", title: "文章標題三", text: "文章摘要。", href: "#", linkLabel: "READ MORE" },
    ],
  },
  video_gallery: { columns: 3, items: [{ url: "", title: "影片標題一" }, { url: "", title: "影片標題二" }, { url: "", title: "影片標題三" }] },
  testimonial_wall: {
    rows: 1, autoplay: true, speed: "normal", showRating: true,
    items: [
      { name: "學員 A", verified: true, date: "2026 年 1 月", rating: 5, title: "評價標題", text: "請填入經同意公開的真實評價。" },
      { name: "學員 B", verified: true, date: "2026 年 1 月", rating: 5, title: "評價標題", text: "請填入經同意公開的真實評價。" },
      { name: "學員 C", verified: false, date: "2026 年 1 月", rating: 4, title: "評價標題", text: "請填入經同意公開的真實評價。" },
    ],
  },
  // Webinar elements (C-01～C-18): dates always come from the funnel's webinar schedule, never from these defaults.
  event_facts: { layout: "row", formatLabel: "線上直播", priceLabel: "免費" },
  speaker_profiles: { layout: "featured", size: "large", items: [{ name: "講者姓名", role: "職稱｜專長", bio: "用 2–3 行說明講者的具體成果與專長。", tags: "成就一,成就二" }] },
  agenda_timeline: {
    layout: "vertical",
    items: [
      { time: "20:00", title: "開場與今日目標", text: "說明這場講座能帶走什麼。" },
      { time: "20:15", title: "主題一", text: "第一段內容的重點。" },
      { time: "21:00", title: "問答時間", text: "現場回答大家的問題。" },
    ],
  },
  callout: { tone: "info", title: "活動注意事項", text: "請填入參加前需要知道的說明。" },
  fit_compare: { fitTitle: "適合你，如果你…", fitItems: ["第一個適合的情況", "第二個適合的情況"], notFitTitle: "可能不適合，如果你…", notFitItems: ["第一個不適合的情況"] },
  add_to_calendar: { googleLabel: "加入 Google 日曆", icsLabel: "下載行事曆檔（Apple／Outlook）" },
  announcement_bar: { text: "免費線上講座報名中", showCountdown: false },
  value_stack: {
    title: "報名就能獲得",
    items: [{ title: "講座完整內容", text: "", value: "" }, { title: "講義與檢查清單", text: "", value: "" }],
    offerLabel: "本場免費", note: "價值為講者自訂參考，非售價承諾",
  },
  session_schedule: { durationMinutes: 90, items: [{ title: "第 1 堂：主題", text: "" }, { title: "第 2 堂：主題", text: "" }] },
  deadline_notice: { label: "報名截止", closedText: "本場報名已截止" },
  media_frame: { frame: "browser", src: PLACEHOLDER, alt: "產品畫面", url: "app.example.com" },
  image_gallery: { layout: "masonry", columns: 3, items: [{ src: PLACEHOLDER, alt: "作品一" }, { src: PLACEHOLDER, alt: "作品二" }, { src: PLACEHOLDER, alt: "作品三" }] },
  code_snippet: { language: "javascript", filename: "example.js", code: "const greeting = 'Hello';\nconsole.log(greeting);", showLineNumbers: true, showCopy: true },
  countdown: { variant: "blocks", source: "webinar_start", label: "距離開播" },
};

export function funnelShowcaseDefaultProps(type: FunnelNodeType): Record<string, unknown> | null {
  const props = DEFAULT_PROPS[type];
  return props ? structuredClone(props) : null;
}

/** The divider needs both colours to be visible; everything else inherits its surroundings. */
export function funnelShowcaseDefaultStyle(type: FunnelNodeType): FunnelNodeStyle {
  return type === "shape_divider" ? { color: "#0b0b0c", backgroundColor: "#ffffff" } : {};
}
