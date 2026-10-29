import { CONVERSION_TEMPLATE_SAMPLE_MARK, conversionOfferCard, conversionTemplateKit, type ConversionTemplateDefinition } from "../conversion/types";

/**
 * 銷售 02：短版數位商品頁（specs/sales-02-digital-planner.md）。
 * 白底極簡：首屏左邊是平板上的手帳預覽、右邊是標題與報價卡，首屏就能買；
 * 往下只放包含內容、內頁預覽、使用者回饋，最後 FAQ 旁再放一次報價卡。
 * 售價與結帳按鈕一律來自訂單表單綁定的商品（conversionOfferCard），範本不寫價格。
 * 品牌「紙上日常」與回饋皆為虛構示意。
 */
const ART = "/funnel-illustrations/sales/02";
const BG = "#ffffff";
const SOFT = "#f4f1ee";
const INK = "#1c1b1a";
const BODY = "#4a4744";
const MUTED = "#5e5a56";
const PRIMARY = "#1c1b1a";
const ACCENT = "#a64a32";
const LINE = "#e3ddd6";

function build(prefix: string) {
  const { node, section, columns2, headline, text, button } = conversionTemplateKit(prefix);
  const eyebrow = (id: string, value: string) => text(id, value, "eyebrow", { color: ACCENT, letterSpacing: 2 });
  const h2 = (id: string, value: string) => headline(id, value, "h2", { color: INK, fontSize: 36, lineHeight: 1.35 }, { tablet: { style: { fontSize: 31 } }, mobile: { style: { fontSize: 25 } } });
  const offerStyle = { backgroundColor: BG, borderColor: LINE, borderWidth: 1, borderRadius: 16, padding: 28, color: INK, shadow: "soft" } as const;
  const offerLines = [
    "✓ 年、月、週、日全頁超連結",
    "✓ 12 種封面＋5 種內頁底色",
    "✓ 之後的版本更新免費下載",
  ];
  const offerNote = "數位商品，付款完成後以 Email 寄送下載連結。內容請依實際商品修改。";

  return [
    // 1. 首屏：平板預覽＋標題＋報價卡（1440 首屏同時看得到標題與結帳按鈕）。
    section("hero", [
      columns2("hero_split", [
        node("hero_preview", "image", { src: `${ART}/hero-tablet.svg`, alt: "平板上的數位手帳：月計畫頁與右側年、月、週、日、習慣超連結分頁" }, undefined, { imageWidth: 100 }, {
          // 手機預覽縮小，讓結帳按鈕留在首屏。
          mobile: { style: { imageWidth: 68, margin: "0 auto" } },
        }),
      ], [
        eyebrow("hero_eyebrow", "紙上日常｜數位手帳模板組"),
        headline("hero_title", "一本就夠的數位手帳：\n年、月、週、日一次排好", "h1", { color: INK, fontSize: 44, lineHeight: 1.3 }, {
          tablet: { style: { fontSize: 40 } },
          mobile: { style: { fontSize: 28, lineHeight: 1.35 }, props: { text: "一本就夠的數位手帳：年、月、週、日一次排好" } },
        }),
        text("hero_lead", "PDF 手帳模板，匯入平板的筆記 App 就能開始寫。不用再每年重買紙本。", undefined, { color: BODY }, { mobile: { visible: false } }),
        conversionOfferCard(prefix, "offer", { title: "數位手帳模板組", lines: offerLines, note: offerNote, style: offerStyle, mobile: { style: { padding: 20 } }, titleColor: INK, noteColor: BODY, htmlId: "offer" }),
      ], { ratio: "1:1", stackOn: "tablet", gap: 40, align: "center" }),
    ], { background: BG, color: BODY, maxWidth: 1200, paddingY: 56, paddingYTablet: 48, paddingYMobile: 16, gap: 24 }),

    // 2. 包含內容。
    section("includes", [
      eyebrow("includes_eyebrow", "WHAT'S INSIDE"),
      h2("includes_title", "打開檔案，你會拿到"),
      node("includes_list", "icon_list", { layout: "grid", columns: 3, numbered: false, accentColor: ACCENT, items: [
        { icon: "compass", title: "年度總覽", text: "一頁看完整年，標記生日、旅行與重要的日子。" },
        { icon: "book", title: "月計畫", text: "月曆格加上本月重點與回顧，月底花五分鐘整理。" },
        { icon: "check", title: "週計畫", text: "每天三行待辦，搭配顏色標記工作、生活與自己。" },
        { icon: "clock", title: "日計畫", text: "時間軸、今日三件事與喝水紀錄，忙的日子也不亂。" },
        { icon: "chart", title: "習慣追蹤", text: "五個習慣、每天一格，連續完成就塗滿。" },
        { icon: "gem", title: "12 種封面", text: "換季換心情，封面與內頁底色都可以自由搭配。" },
      ] }, undefined, { color: BODY, textAlign: "left" }),
      node("includes_covers", "image", { src: `${ART}/covers.svg`, alt: "手帳封面示意：六種顏色與圖形的封面並排" }, undefined, { imageWidth: 100, margin: "16px 0 0" }),
    ], { background: SOFT, color: BODY, maxWidth: 1080, gap: 24, align: "center" }),

    // 3. 內頁預覽。
    section("pages", [
      eyebrow("pages_eyebrow", "PREVIEW"),
      h2("pages_title", "內頁長這樣"),
      text("pages_text", "右側分頁全部可以點；從日計畫一鍵回到月曆，不用一直往回滑。", undefined, { color: BODY, width: "min(100%, 600px)", margin: "0 auto" }),
      node("pages_gallery", "image_gallery", { layout: "grid", columns: 3, items: [
        { src: `${ART}/page-week.svg`, alt: "週計畫頁示意：每天三行待辦與顏色標記", caption: "週計畫" },
        { src: `${ART}/page-daily.svg`, alt: "日計畫頁示意：時間軸、今日三件事與喝水紀錄", caption: "日計畫" },
        { src: `${ART}/page-habit.svg`, alt: "習慣追蹤頁示意：五個習慣與兩週方格", caption: "習慣追蹤" },
      ] }, undefined, { color: MUTED }),
    ], { background: BG, color: BODY, maxWidth: 1160, gap: 20, align: "center" }),

    // 4. 使用者回饋（範本示意）。
    section("reviews", [
      eyebrow("reviews_eyebrow", "REVIEWS"),
      h2("reviews_title", "用了一陣子的人說"),
      node("reviews_wall", "testimonial_wall", { layout: "carousel", columns: 3, autoplay: false, showRating: true, accentColor: ACCENT, cardColor: BG, cardTextColor: INK, items: [
        { name: "使用者 A｜研究生", rating: 5, title: `分頁跳轉超順（${CONVERSION_TEMPLATE_SAMPLE_MARK}）`, text: "以前用紙本常常翻半天，現在點一下就到下週，寫論文進度也比較有感。" },
        { name: "使用者 B｜上班族", rating: 5, title: `終於寫完一整年（${CONVERSION_TEMPLATE_SAMPLE_MARK}）`, text: "頁面很乾淨，不會一打開就有壓力。週計畫三行剛剛好，寫得完。" },
        { name: "使用者 C｜自由工作者", rating: 5, title: `封面可以換很療癒（${CONVERSION_TEMPLATE_SAMPLE_MARK}）`, text: "每個月換一次封面和底色，像在用新的本子。" },
        { name: "使用者 D｜新手媽媽", rating: 4, title: `習慣追蹤很實用（${CONVERSION_TEMPLATE_SAMPLE_MARK}）`, text: "記錄喝水和睡眠，忙的時候也能看到自己有好好照顧自己。" },
      ] }, undefined, { textAlign: "left" }),
    ], { background: SOFT, color: BODY, maxWidth: 1160, gap: 24, align: "center" }),

    // 5. FAQ＋報價卡。
    section("faq", [
      columns2("faq_split", [
        eyebrow("faq_eyebrow", "FAQ"),
        h2("faq_title", "購買前常見問題"),
        node("faq_list", "faq", { items: [
          { question: "可以用在哪些裝置？", answer: "這是 PDF 檔，可以匯入 iPad、Android 平板或電腦上支援 PDF 超連結與手寫的筆記 App。購買前請先確認你的 App 支援超連結跳頁。" },
          { question: "付款後怎麼拿到檔案？", answer: "付款完成後會收到確認信，信中有下載連結。沒收到的話，請先檢查垃圾郵件匣，或直接回信聯絡我們。" },
          { question: "可以印出來用嗎？", answer: "可以列印單頁使用，但超連結分頁只在電子版有效。僅限個人使用，請勿轉售或分享檔案。" },
          { question: "之後的更新要再付費嗎？", answer: "不用。模板改版時，我們會寄送新版下載連結給已購買的人。" },
          { question: "可以開發票嗎？", answer: "可以，付款後系統會依你填寫的資料開立電子發票。實際開立方式請依商家設定修改。" },
        ] }, undefined, { color: BODY, textAlign: "left" }),
        node("faq_refund", "callout", { tone: "info", title: "數位商品退款說明", text: "數位商品寄出下載連結後，依法可以不適用七天鑑賞期；若檔案無法開啟或內容與說明不符，請聯絡我們協助處理。\n\n本段為範例文字，請依你的退款政策修改。" }, undefined, { color: INK, textAlign: "left" }),
      ], [
        conversionOfferCard(prefix, "offer_again", { title: "數位手帳模板組", lines: offerLines, note: offerNote, style: offerStyle, mobile: { style: { padding: 20 } }, titleColor: INK, noteColor: BODY }),
      ], { ratio: "7:5", stackOn: "tablet", gap: 56, align: "start" }),
    ], { background: BG, color: BODY, maxWidth: 1160, gap: 24 }),

    // 6. 頁尾。
    section("footer", [
      text("footer_text", "© 紙上日常（虛構品牌示意）｜數位商品僅限個人使用，請勿轉售或分享檔案。", "small", { color: "#d9d4ce" }),
      button("footer_top", "回到購買區", "#offer", { backgroundColor: "transparent", color: "#ffffff", borderColor: "#5e5a56", borderWidth: 1, borderRadius: 8, padding: "10px 20px", width: "fit-content", margin: "0 auto", fontSize: 15 }),
    ], { background: INK, color: "#d9d4ce", maxWidth: 960, paddingY: 40, paddingYTablet: 36, paddingYMobile: 28, gap: 12, align: "center" }),
  ];
}

export const template: ConversionTemplateDefinition = {
  id: "sales-digital-planner",
  kind: "sales",
  number: 2,
  name: "短版數位商品頁",
  description: "白底極簡的數位商品頁：首屏平板預覽旁就是報價卡，往下只放包含內容、內頁預覽、回饋與 FAQ，適合模板、電子書與素材包。",
  category: "數位商品",
  purposes: ["sales"],
  styles: ["minimal"],
  preview: { eyebrow: "銷售頁", headline: "一本就夠的數位手帳：年、月、週、日一次排好", summary: "首屏報價卡＋內頁預覽", palette: [BG, ACCENT, INK], sectionCount: 6 },
  theme: { typography: { headingFont: "sans-tc", bodyFont: "sans-tc", bodySize: 17, bodyLineHeight: 1.75, textColor: BODY, headingColor: INK, linkColor: PRIMARY }, background: { color: BG } },
  settings: { scrollReveal: "rise", stickyCta: { enabled: true, label: "立即購買", target: "offer", showDate: false, devices: "mobile_tablet", buttonColor: PRIMARY, buttonTextColor: BG, backgroundColor: BG } },
  build,
  thankYou: {
    name: "數位手帳・訂單感謝頁",
    description: "說明付款確認信與下載方式，附匯入步驟與發票、退款、聯絡 FAQ。",
    tokens: { background: BG, surface: SOFT, ink: INK, body: BODY, accent: PRIMARY, onAccent: BG, line: LINE, footerBackground: INK, footerText: "#d9d4ce", radius: 8 },
    eyebrow: "訂單已送出",
    title: "謝謝你的訂購",
    intro: "付款完成後，確認信會寄到你填寫的 Email，信中有手帳的下載連結。幾分鐘內沒看到的話，請檢查促銷內容或垃圾郵件匣。",
    card: { title: "下載說明｜數位手帳模板組", text: "檔案為 PDF 格式，下載後匯入平板上支援超連結的筆記 App 即可使用。下載連結請妥善保存，僅限個人使用。", buttonLabel: "看匯入步驟", buttonHref: "#ty-steps" },
    steps: [
      { icon: "message", title: "收付款確認信", text: "付款完成後，系統寄出確認信與下載連結。" },
      { icon: "rocket", title: "下載檔案", text: "建議用平板直接下載，或先存到雲端硬碟再開啟。" },
      { icon: "book", title: "匯入 App", text: "在筆記 App 選擇「匯入 PDF」，打開月計畫頁，點右側分頁試試看。" },
    ],
    next: { eyebrow: "一起寫下去", title: "加入使用者社群", text: "分享你的手帳頁面、交換排版靈感，也會最先收到模板更新通知。", buttonLabel: "了解社群", buttonHref: "#ty-steps" },
    faq: [
      { question: "我的裝置可以用嗎？", answer: "支援 PDF 超連結與手寫的筆記 App 都可以使用，例如平板或電腦上的 PDF 標註 App。若無法跳頁，請確認 App 的超連結設定。" },
      { question: "發票什麼時候寄？", answer: "付款完成後，電子發票會依你填寫的資料開立並寄到 Email。實際開立方式請依商家設定修改。" },
      { question: "可以退款嗎？", answer: "數位商品寄出下載連結後，通常不適用七天鑑賞期；若檔案無法開啟或內容與說明不符，請聯絡我們處理。請依你的退款政策修改。" },
      { question: "怎麼聯絡你們？", answer: "直接回覆確認信即可，我們會在工作天內回覆。" },
    ],
    footer: "© 紙上日常（虛構品牌示意）｜數位商品僅限個人使用。",
  },
};
