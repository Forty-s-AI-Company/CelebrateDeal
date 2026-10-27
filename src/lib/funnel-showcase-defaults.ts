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
};

export function funnelShowcaseDefaultProps(type: FunnelNodeType): Record<string, unknown> | null {
  const props = DEFAULT_PROPS[type];
  return props ? structuredClone(props) : null;
}

/** The divider needs both colours to be visible; everything else inherits its surroundings. */
export function funnelShowcaseDefaultStyle(type: FunnelNodeType): FunnelNodeStyle {
  return type === "shape_divider" ? { color: "#0b0b0c", backgroundColor: "#ffffff" } : {};
}
