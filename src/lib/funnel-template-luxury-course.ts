import type { FunnelNode, FunnelNodeAction, FunnelNodeType, FunnelPageSettings } from "@/lib/funnel-page-document";

/**
 * 「高質感課程品牌（黑金）」首頁範本：虛構的線上課程品牌「航向自由學院」。
 * 版面語言是黑底金字、襯線標題；所有文字都是原創示意內容，圖片是
 * `public/funnel-illustrations/luxury/` 的自製 SVG（講師照為明顯的替換佔位圖），
 * Logo 列是虛構的示意字標，評價為標明「範本示意」的內容，商家套用後需替換。
 */

const ART = "/funnel-illustrations/luxury";
const GOLD = "#c9a063";
/** Bronze accent for cream sections (gold on cream fails WCAG AA for small text). */
const BRONZE = "#7d5f32";
const NIGHT = "#0b0b0c";
const NIGHT_SOFT = "#121212";
const CREAM = "#f7f3ec";
const INK = "#1f1a15";
const INK_BODY = "#3d352c";
const LIGHT = "#f5f1e8";
const LIGHT_BODY = "#d9d2c5";

/** Page typography and background applied when the template is used (editable in 頁面設定). */
export const LUXURY_COURSE_THEME: { typography: Partial<FunnelPageSettings["typography"]>; background: { color: string } } = {
  typography: { headingFont: "serif-tc", bodyFont: "sans-tc", bodySize: 17, bodyLineHeight: 1.8, textColor: LIGHT_BODY, headingColor: LIGHT, linkColor: GOLD },
  background: { color: NIGHT },
};

type Style = FunnelNode["style"];

function luxuryCourseSections(prefix: string) {
  const node = (id: string, type: FunnelNodeType, props: Record<string, unknown> = {}, children?: FunnelNode[], style: Style = {}, options: { actions?: FunnelNodeAction[]; mobile?: { style?: Style; props?: Record<string, unknown>; visible?: boolean }; htmlId?: string } = {}): FunnelNode => ({
    schemaVersion: 1,
    id: `${prefix}_${id}`,
    type,
    props,
    style,
    overrides: options.mobile ? { mobile: options.mobile } : {},
    visible: true,
    actions: options.actions ?? [],
    attributes: options.htmlId ? { id: options.htmlId } : {},
    ...(children ? { children } : {}),
  });

  type SectionOptions = { background: string; color: string; paddingY?: number; paddingYMobile?: number; maxWidth?: number; gap?: number; align?: "left" | "center"; htmlId?: string; props?: Record<string, unknown>; mobileProps?: Record<string, unknown> };
  const section = (id: string, children: FunnelNode[], options: SectionOptions) => {
    const { background, color, paddingY = 112, paddingYMobile = 64, maxWidth = 1160, gap = 40, align, htmlId, props = {}, mobileProps } = options;
    return node(id, "section", props, [node(`${id}_row`, "row", { maxWidth, gap }, children)],
      { padding: `${paddingY}px 32px`, backgroundColor: background, color, ...(align ? { textAlign: align } : {}) },
      { mobile: { style: { padding: `${paddingYMobile}px 20px` }, ...(mobileProps ? { props: mobileProps } : {}) }, htmlId });
  };
  const title = (id: string, eyebrow: string, text: string, options: { subtitle?: string; level?: "h1" | "h2"; accent?: string; color?: string; align?: "left" | "center" } = {}) =>
    node(id, "section_title", { eyebrow, title: text, subtitle: options.subtitle ?? "", level: options.level ?? "h2", decoration: "line", accentColor: options.accent ?? GOLD },
      // Explicit colour: a section reused as a block on a light page must not pick up the page's dark heading colour.
      undefined, { color: options.color ?? LIGHT, ...(options.align ? { textAlign: options.align } : {}) });
  const text = (id: string, value: string, style: Style = {}, textStyle?: "lead" | "small") => node(id, "text", textStyle ? { text: value, textStyle } : { text: value }, undefined, style);
  const goldButton = (id: string, label: string, href: string, extra: Style = {}) => node(id, "button", { label }, undefined,
    { backgroundColor: GOLD, color: "#111111", borderRadius: 0, letterSpacing: 2, padding: "16px 36px", ...extra }, { actions: [{ type: "open_url", href, newTab: false }] });
  const stack = (id: string, children: FunnelNode[], gap = 28, style: Style = {}, mobileStyle?: Style) => node(id, "content_box", { gap }, children, { padding: 0, ...style }, mobileStyle ? { mobile: { style: mobileStyle } } : {});
  const divider = (id: string, shape: "triangle" | "slant" | "wave", position: "top" | "bottom", fill: string, behind: string) =>
    node(id, "shape_divider", { shape, position, height: 72 }, undefined, { color: fill, backgroundColor: behind }, { mobile: { props: { height: 36 } } });

  const nav = () => node("nav", "nav_bar", {
    brand: "航向自由學院", homeHref: "#top", sticky: true, accentColor: GOLD, ctaLabel: "免費講座", ctaHref: "#signup",
    items: [
      { label: "關於講師", href: "#about" },
      { label: "課程", href: "#courses", submenu: "自由思維入門 | #courses\n人生航海圖工作坊 | #courses\n一對一陪跑計畫 | #courses" },
      { label: "學員回饋", href: "#reviews" },
      { label: "知識專欄", href: "#journal" },
      { label: "常見問題", href: "#faq" },
    ],
    socials: [
      { network: "facebook", href: "https://www.facebook.com/" },
      { network: "instagram", href: "https://www.instagram.com/" },
      { network: "youtube", href: "https://www.youtube.com/" },
      { network: "line", href: "https://line.me/" },
    ],
  }, undefined, { backgroundColor: "#0b0b0c", color: LIGHT });

  const hero = () => node("hero", "section", {}, [node("hero_row", "row", { maxWidth: 1200, gap: 0 }, [
    node("hero_columns", "columns_2", { gap: 72 }, [
      node("hero_image", "image", { src: `${ART}/hero-portrait.svg`, alt: "講師形象照（請替換為講師本人照片）" }, undefined, { imageWidth: 100 }),
      stack("hero_copy", [
        title("hero_title", "SAIL TOWARDS FREEDOM", "把人生的舵，\n*交回自己手上*", { level: "h1", subtitle: "陪你整理方向、設計可執行的行動計畫，在工作與生活之間，找回選擇的餘裕。" }),
        goldButton("hero_cta", "預約免費講座", "#signup"),
        text("hero_note", "每月一場線上講座・名額有限・免費參加", { color: "#b8b0a2", letterSpacing: 1 }, "small"),
      ], 32),
    ], { align: "center" }),
  ])], { padding: "72px 32px 104px", backgroundColor: NIGHT, color: LIGHT }, { mobile: { style: { padding: "32px 20px 64px" } }, htmlId: "top" });

  const press = () => section("press", [
    node("press_logos", "logo_strip", {
      title: "媒體報導與合作（示意）", tone: "light", logoHeight: 30,
      items: [
        { src: `${ART}/logo-northwind.svg`, alt: "NORTHWIND（示意 Logo）" },
        { src: `${ART}/logo-atlas.svg`, alt: "Atlas Weekly（示意 Logo）" },
        { src: `${ART}/logo-morning.svg`, alt: "晨光週報（示意 Logo）" },
        { src: `${ART}/logo-lumen.svg`, alt: "LUMEN（示意 Logo）" },
        { src: `${ART}/logo-harbor.svg`, alt: "Harbor Post（示意 Logo）" },
      ],
    }, undefined, { color: "#b8b0a2" }),
  ], { background: NIGHT_SOFT, color: LIGHT_BODY, paddingY: 48, paddingYMobile: 40 });

  // The copy takes the left half on desktop; the background photo shows on the right.
  const method = () => section("method", [
    stack("method_copy", [
      title("method_title", "OUR METHOD", "三個轉折，\n讓改變*真正發生*", { subtitle: "不是再多聽一堂課，而是把想法變成每天的小步驟。" }),
      node("method_points", "icon_list", {
        numbered: true, layout: "list", accentColor: GOLD,
        items: [
          { icon: "compass", title: "看清方向", text: "用價值盤點與生活輪，找出你真正想前進的地方，而不是別人期待的目標。" },
          { icon: "anchor", title: "穩住節奏", text: "把大目標拆成每週的航程，建立不靠意志力也能持續的生活系統。" },
          { icon: "sail", title: "順風啟航", text: "在小組陪伴與定期回顧中修正航線，讓改變累積成看得見的成果。" },
        ],
      }, undefined, { color: LIGHT }),
    ], 40, { width: 50 }, { width: 100 }),
  ], {
    background: NIGHT, color: LIGHT_BODY, htmlId: "about",
    props: { backgroundImage: `${ART}/study-lamp.svg`, backgroundPosition: "right", overlayColor: NIGHT, overlayOpacity: 96, overlayFade: "right" },
    mobileProps: { overlayFade: "none", overlayOpacity: 88 },
  });

  const stats = () => section("stats", [node("stats_numbers", "stats", {
    animate: true, framed: true, accentColor: GOLD,
    items: [
      { value: "12800", suffix: "+", label: "累積學員" },
      { value: "4.9", suffix: "/5", label: "課程平均評分" },
      { value: "260", suffix: "場", label: "線上講座與工作坊" },
    ],
  }, undefined, { color: LIGHT })], {
    background: NIGHT, color: LIGHT, paddingY: 120, paddingYMobile: 72, maxWidth: 1000,
    props: { backgroundImage: `${ART}/ocean-night.svg`, backgroundPosition: "center", overlayColor: NIGHT, overlayOpacity: 55 },
  });

  const courses = () => section("courses", [
    title("courses_title", "COURSES", "選一條適合你的航線", { accent: BRONZE, color: INK, align: "center", subtitle: "從觀念入門到一對一陪跑，依照你現在的位置選擇下一步。" }),
    node("courses_cards", "image_cards", {
      columns: 3, aspect: "4:3", corners: true, accentColor: BRONZE,
      items: [
        { src: `${ART}/card-compass.svg`, alt: "羅盤插圖", title: "自由思維入門", text: "六堂線上課，建立看待工作、金錢與時間的新框架。", href: "#signup", linkLabel: "了解課程" },
        { src: `${ART}/card-mountain.svg`, alt: "山峰插圖", title: "人生航海圖工作坊", text: "兩天實作工作坊，帶走一份寫得清清楚楚的年度計畫。", href: "#signup", linkLabel: "了解課程" },
        { src: `${ART}/card-book.svg`, alt: "書本插圖", title: "一對一陪跑計畫", text: "十二週專屬教練，定期回顧、即時調整，陪你走完關鍵的轉換期。", href: "#signup", linkLabel: "了解課程" },
      ],
    }, undefined, { color: INK_BODY }),
  ], { background: CREAM, color: INK_BODY, htmlId: "courses", gap: 56 });

  const cta = () => section("cta", [node("cta_box", "content_box", { gap: 24, decoration: "frame", decorationColor: GOLD }, [
    title("cta_title", "FREE WEBINAR", "每月一場，\n免費線上講座", { align: "center", subtitle: "九十分鐘，帶你畫出屬於自己的第一張航海圖。\n講座後提供完整講義與一次免費提問。" }),
    goldButton("cta_button", "立即保留席次", "#signup"),
  ], { backgroundColor: "rgba(11, 11, 12, 0.78)", borderColor: GOLD, borderWidth: 1, padding: 64, textAlign: "center" }, { mobile: { style: { padding: "44px 24px" } } })], {
    background: NIGHT, color: LIGHT_BODY, paddingY: 128, paddingYMobile: 72, maxWidth: 820, htmlId: "signup",
    props: { backgroundImage: `${ART}/ocean-night.svg`, backgroundPosition: "bottom", overlayColor: NIGHT, overlayOpacity: 40 },
  });

  /** Same CTA on a plain dark section with corner brackets (no background photo). */
  const ctaCorners = () => section("cta_plain", [node("cta_plain_box", "content_box", { gap: 24, decoration: "corners", decorationColor: GOLD }, [
    title("cta_plain_title", "JOIN US", "下一段航程，\n從這裡開始", { align: "center", subtitle: "留下 Email，搶先收到講座開放報名的通知。" }),
    goldButton("cta_plain_button", "預約免費講座", "#signup"),
  ], { backgroundColor: NIGHT_SOFT, padding: 64, textAlign: "center" }, { mobile: { style: { padding: "44px 24px" } } })], { background: NIGHT, color: LIGHT_BODY, paddingY: 96, paddingYMobile: 64, maxWidth: 820 });

  const features = () => section("features", [node("features_columns", "columns_2", { gap: 72 }, [
    node("features_image", "image", { src: `${ART}/course-workshop.svg`, alt: "課程工作坊示意圖" }, undefined, { imageWidth: 100 }),
    stack("features_copy", [
      title("features_title", "WHY US", "不只是課程，\n是一段*有人同行*的航程"),
      node("features_points", "icon_list", {
        numbered: false, layout: "grid", columns: 2, accentColor: GOLD,
        items: [
          { icon: "book", title: "系統化教材", text: "每一堂課都有講義、練習單與回顧模板。" },
          { icon: "users", title: "小班陪伴", text: "每組最多十二人，教練認得每一位學員。" },
          { icon: "clock", title: "彈性學習", text: "直播之外提供一年回放，跟上自己的步調。" },
          { icon: "shield", title: "七天安心退費", text: "開課七天內不適合，依退費規則全額退還。" },
        ],
      }, undefined, { color: LIGHT }),
    ], 40),
  ], { align: "center" })], { background: NIGHT, color: LIGHT_BODY });

  const reviews = () => section("reviews", [
    title("reviews_title", "REVIEWS", "學員回饋", { align: "center" }),
    node("reviews_wall", "testimonial_wall", {
      rows: 2, autoplay: true, speed: "normal", showRating: true, accentColor: GOLD, cardColor: "#181716", cardTextColor: LIGHT,
      items: [
        { avatar: `${ART}/avatar-1.svg`, name: "Amber．行銷企劃", verified: true, date: "2026 年 9 月", rating: 5, title: "終於知道下一步要做什麼", text: "以前常常想很多卻不知道從哪開始。工作坊結束後，我第一次有一份每週都會打開的計畫。" },
        { avatar: `${ART}/avatar-2.svg`, name: "陳先生．工程師", verified: true, date: "2026 年 8 月", rating: 5, title: "節奏感變得很穩", text: "最有用的是每週回顧的模板，讓我在忙碌的專案中也守住了運動和閱讀時間。" },
        { name: "Mia．自由接案", verified: true, date: "2026 年 8 月", rating: 5, title: "被陪伴的感覺很踏實", text: "小組裡每個人進度不同，但教練都會記得你上週卡在哪裡，這種被看見的感覺很重要。" },
        { avatar: `${ART}/avatar-3.svg`, name: "林小姐．教師", verified: true, date: "2026 年 7 月", rating: 4, title: "觀念課很扎實", text: "入門課的框架很清楚，回放也方便。希望之後能有更多實際案例分享。" },
        { avatar: `${ART}/avatar-4.svg`, name: "Kevin．創業者", verified: true, date: "2026 年 7 月", rating: 5, title: "幫我把夢想拆成行程", text: "陪跑十二週後，我把副業從想法推進到第一位付費客戶，每一步都有人一起檢查。" },
        { name: "張太太．家庭主婦", verified: false, date: "2026 年 6 月", rating: 5, title: "重新找回自己的時間", text: "孩子上學後我一直很迷惘，講座讓我開始規劃屬於自己的學習時間，心情也輕鬆很多。" },
        { name: "Ray．業務主管", verified: true, date: "2026 年 6 月", rating: 5, title: "團隊也一起受惠", text: "把課程裡的週回顧方法帶進團隊會議，大家的優先順序變得更一致。" },
        { name: "Joy．研究生", verified: true, date: "2026 年 5 月", rating: 5, title: "焦慮少了很多", text: "畢業前很焦慮，透過價值盤點，我比較能分辨哪些選擇是真的適合自己。" },
      ],
    }),
    text("reviews_note", "以上為範本示意內容，發布前請替換為經學員同意公開的真實回饋。", { textAlign: "center", color: "#9d968a" }, "small"),
  ], { background: NIGHT_SOFT, color: LIGHT_BODY, maxWidth: 1240, htmlId: "reviews", gap: 48 });

  const journal = () => section("journal", [
    title("journal_title", "JOURNAL", "知識專欄", { accent: BRONZE, color: INK, align: "center" }),
    node("journal_cards", "content_cards", {
      columns: 3, accentColor: BRONZE, cardColor: "#ffffff", cardTextColor: INK,
      items: [
        { src: `${ART}/article-plan.svg`, alt: "規劃筆記插圖", category: "行動計畫", date: "2026.10.12", title: "年度計畫寫不下去？先從一張「不做清單」開始", text: "與其列出更多目標，不如先決定哪些事情今年不再做。", href: "#journal", linkLabel: "READ MORE" },
        { src: `${ART}/article-growth.svg`, alt: "成長曲線插圖", category: "職涯轉換", date: "2026.09.28", title: "轉職前一定要問自己的五個問題", text: "用五個問題檢查動機、資源與風險，讓決定更有把握。", href: "#journal", linkLabel: "READ MORE" },
        { src: `${ART}/article-morning.svg`, alt: "晨間插圖", category: "生活節奏", date: "2026.09.15", title: "建立晨間儀式：每天多出的三十分鐘", text: "不用早起五點，也能用小小的固定習慣，換回一天的主導權。", href: "#journal", linkLabel: "READ MORE" },
      ],
    }),
  ], { background: CREAM, color: INK_BODY, htmlId: "journal", gap: 56 });

  const videos = () => section("videos", [
    title("videos_title", "VIDEOS", "影音頻道", { align: "center", subtitle: "在影片欄位貼上你的 YouTube 網址，訪客按下播放後才會載入影片。" }),
    node("videos_gallery", "video_gallery", {
      columns: 3, accentColor: GOLD,
      items: [
        { url: "", title: "講座精華：畫出你的第一張航海圖", thumbnail: `${ART}/video-talk.svg` },
        { url: "", title: "學員分享：從迷惘到啟航的十二週", thumbnail: `${ART}/video-sea.svg` },
        { url: "", title: "三分鐘學會每週回顧", thumbnail: `${ART}/video-notes.svg` },
      ],
    }, undefined, { color: LIGHT }),
  ], { background: NIGHT, color: LIGHT_BODY, gap: 56 });

  const faq = () => section("faq", [
    title("faq_title", "FAQ", "常見問題", { accent: BRONZE, color: INK, align: "center" }),
    node("faq_list", "faq", { items: [
      { question: "沒有相關背景，也適合參加嗎？", answer: "適合。入門課從基本觀念開始，所有練習都附範例，跟著做就能完成。" },
      { question: "課程是直播還是錄影？", answer: "主要課程為線上直播，結束後提供一年回放，錯過也能補上。" },
      { question: "免費講座需要準備什麼？", answer: "準備紙筆或一份空白文件即可，講座中會帶你完成第一張航海圖。" },
      { question: "可以退費嗎？", answer: "開課七天內若覺得不適合，可依退費規則申請全額退費。" },
    ] }, [], { color: INK_BODY, textAlign: "left" }),
  ], { background: CREAM, color: INK_BODY, maxWidth: 860, htmlId: "faq", gap: 48 });

  const footer = () => section("footer", [
    node("footer_brand", "headline", { text: "航向自由學院", level: "h3" }, undefined, { color: LIGHT, letterSpacing: 4 }),
    node("footer_menu", "menu", { items: [
      { label: "關於講師", href: "#about" }, { label: "課程", href: "#courses" }, { label: "學員回饋", href: "#reviews" }, { label: "知識專欄", href: "#journal" }, { label: "常見問題", href: "#faq" },
    ] }, undefined, { color: LIGHT_BODY, textAlign: "center" }),
    text("footer_copy", "© 2026 航向自由學院（範本示意品牌）・保留所有權利", { color: "#9d968a" }, "small"),
  ], { background: NIGHT, color: LIGHT_BODY, paddingY: 64, paddingYMobile: 48, align: "center", gap: 20 });

  return {
    nav, hero, press, method, stats, courses, cta, ctaCorners, features, reviews, journal, videos, faq, footer,
    dividerCourses: () => divider("divider_courses", "triangle", "top", NIGHT, CREAM),
    dividerCta: () => divider("divider_cta", "triangle", "top", CREAM, NIGHT),
  };
}

export type LuxuryCourseSectionName = keyof ReturnType<typeof luxuryCourseSections>;

/** One section of the template on its own (the block library reuses them as 版型區塊). */
export function buildLuxuryCourseSection(name: LuxuryCourseSectionName, prefix: string): FunnelNode {
  return luxuryCourseSections(prefix)[name]();
}

export function buildLuxuryCourseTemplate(prefix: string): FunnelNode[] {
  const s = luxuryCourseSections(prefix);
  return [
    s.nav(), s.hero(), s.press(), s.method(), s.stats(), s.dividerCourses(), s.courses(), s.dividerCta(),
    s.cta(), s.features(), s.reviews(), s.journal(), s.videos(), s.faq(), s.footer(),
  ];
}
