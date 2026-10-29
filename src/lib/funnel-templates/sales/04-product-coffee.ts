import { CONVERSION_TEMPLATE_SAMPLE_MARK, conversionOfferCard, conversionTemplateKit, type ConversionTemplateDefinition } from "../conversion/types";

/**
 * 銷售 04：實體商品銷售頁（specs/sales-04-product-coffee.md）。
 * 電商商品頁的節奏：首屏左商品主圖、右標題與報價卡，一進來就能買；往下是組合內容、
 * 特色、規格白卡、評價、配送與退換，最後 FAQ 旁再放一次報價卡。
 * 售價、庫存與結帳一律來自綁定商品；配送與退換只寫原則，提醒商家填入實際政策。
 */
const ART = "/funnel-illustrations/sales/04";
const BG = "#f6f3ee";
const CARD = "#ffffff";
const INK = "#231c16";
const BODY = "#4a4038";
const PRIMARY = "#5b3a24";
const GREEN = "#3f5f45";
const SAGE = "#eef1ea";
const LINE = "#e4ddd2";
const SAMPLE = CONVERSION_TEMPLATE_SAMPLE_MARK;

function build(prefix: string) {
  const { node, section, columns2, stack, headline, text, button } = conversionTemplateKit(prefix);
  const eyebrow = (id: string, value: string) => text(id, value, "eyebrow", { color: GREEN, letterSpacing: 3 });
  const h2 = (id: string, value: string, mobileText?: string) => headline(id, value, "h2", { color: INK, fontSize: 36, lineHeight: 1.35 }, {
    tablet: { style: { fontSize: 31 } },
    mobile: { style: { fontSize: 25, lineHeight: 1.4 }, ...(mobileText ? { props: { text: mobileText } } : {}) },
  });
  const offerLines = ["✓ 濾杯、手沖壺、磨豆機、分享壺與濾紙", "✓ 附沖煮教學影片與參數卡", "✓ 出貨方式與時間依結帳頁說明"];
  const offerStyle = { backgroundColor: CARD, borderColor: LINE, borderWidth: 1, borderRadius: 14, padding: 28, shadow: "medium", color: INK } as const;

  return [
    // 1. 首屏：左商品主圖（手機在上），右標題、三個賣點與報價卡。
    section("hero", [
      columns2("hero_split", [
        node("hero_image", "image", { src: `${ART}/kit-hero.svg`, alt: "入門手沖咖啡器材組商品示意：手沖壺、濾杯、分享壺、磨豆機與濾紙" }, undefined, { imageWidth: 100, borderRadius: 20 }),
      ], [
        eyebrow("hero_eyebrow", "日向焙煎｜入門手沖組"),
        headline("hero_title", "在家沖一杯好咖啡，\n從這組 5 件器材開始", "h1", { color: INK, fontSize: 44, lineHeight: 1.3 }, {
          tablet: { style: { fontSize: 38 } },
          mobile: { style: { fontSize: 28, lineHeight: 1.35 }, props: { text: "在家沖一杯好咖啡，從這組 5 件器材開始" } },
        }),
        // 手機的主圖在上、報價卡較遠：首屏另給一顆捲到報價卡的按鈕（L-7）。
        button("hero_jump", "查看價格與購買", "#offer", { backgroundColor: PRIMARY, color: CARD, borderRadius: 10, fontSize: 17, width: "100%" }, { desktop: { visible: false }, tablet: { visible: false }, mobile: { visible: true } }),
        text("hero_points", "✓ 為新手挑好的一整套，不用再比較規格\n✓ 細口壺好控水，第一次就沖得穩\n✓ 附沖煮教學影片，收到當天就能上手", undefined, { color: BODY, lineHeight: 1.9 }),
        conversionOfferCard(prefix, "offer", {
          title: "入門手沖組（5 件）", lines: offerLines,
          note: "付款在安全金流頁面完成；付款完成後會寄出訂單確認信。",
          titleColor: INK, noteColor: BODY, htmlId: "offer", style: offerStyle, mobile: { style: { padding: 20 } },
        }),
      ], { ratio: "1:1", stackOn: "tablet", gap: 56, align: "start" }),
    ], { background: BG, color: BODY, maxWidth: 1160, paddingY: 72, paddingYTablet: 48, paddingYMobile: 24, gap: 24 }),

    // 2. 組合內容：4 張商品圖卡。
    section("kit", [
      eyebrow("kit_eyebrow", "組合內容"),
      h2("kit_title", "一盒裝好，打開就能沖"),
      node("kit_cards", "image_cards", { columns: 4, aspect: "1:1", corners: false, accentColor: GREEN, items: [
        { src: `${ART}/item-dripper.svg`, alt: "陶瓷濾杯示意", title: "陶瓷濾杯", text: "三孔設計，流速穩定，1–2 杯份。" },
        { src: `${ART}/item-kettle.svg`, alt: "細口手沖壺示意", title: "細口手沖壺", text: "細長壺嘴，水柱粗細好控制。" },
        { src: `${ART}/item-grinder.svg`, alt: "手搖磨豆機示意", title: "手搖磨豆機", text: "刻度可調，從細到粗都能磨。" },
        { src: `${ART}/item-server.svg`, alt: "玻璃分享壺與濾紙示意", title: "分享壺＋濾紙", text: "耐熱玻璃壺，附一包濾紙。" },
      ] }, undefined, { color: INK, textAlign: "left" }, { mobile: { props: { aspect: "16:9" } } }),
    ], { background: CARD, color: BODY, maxWidth: 1160, gap: 24, align: "center" }),

    // 3. 特色：3 欄。
    section("features", [
      eyebrow("features_eyebrow", "為什麼是這一組"),
      h2("features_title", "少走冤枉路的器材選擇"),
      node("features_list", "icon_list", { layout: "grid", columns: 3, numbered: false, accentColor: GREEN, items: [
        { icon: "target", title: "新手好上手", text: "每件器材都選最不容易失敗的款式，沖出來的味道穩定。" },
        { icon: "leaf", title: "耐用好清洗", text: "陶瓷、不鏽鋼與耐熱玻璃，用清水沖洗就乾淨。" },
        { icon: "book", title: "附教學與參數卡", text: "粉量、水溫、注水時間寫在一張卡上，照著做就好。" },
      ] }, undefined, { color: BODY, textAlign: "left" }),
    ], { background: BG, color: BODY, maxWidth: 1080, gap: 28, align: "center" }),

    // 4. 規格：左說明、右白卡規格表。
    section("specs", [
      columns2("specs_split", [
        eyebrow("specs_eyebrow", "商品規格"),
        h2("specs_title", "每一件，都寫清楚"),
        text("specs_text", "規格為範本示意，套用後請改成實際商品的材質、容量與尺寸。尺寸以實際商品為準。", undefined, { color: BODY }),
        text("specs_tip", "建議沖煮參數：咖啡粉 15g、水溫 90–92°C、總水量 225ml、約 2 分 30 秒完成。", "small", { color: GREEN, backgroundColor: SAGE, borderRadius: 10, padding: "12px 16px" }),
      ], stack("specs_card", [
        node("specs_list", "icon_list", { layout: "list", numbered: false, accentColor: PRIMARY, items: [
          { icon: "check", title: "陶瓷濾杯", text: "陶瓷材質｜1–2 杯份｜三孔設計" },
          { icon: "check", title: "細口手沖壺", text: "不鏽鋼｜容量 600ml｜可用於瓦斯爐與電磁爐" },
          { icon: "check", title: "手搖磨豆機", text: "陶瓷刀盤｜刻度可調｜豆倉 30g" },
          { icon: "check", title: "玻璃分享壺", text: "耐熱玻璃｜容量 500ml" },
          { icon: "check", title: "錐形濾紙", text: "1–2 杯份｜一包 40 張" },
        ] }, undefined, { color: INK, textAlign: "left" }),
      ], 0, { backgroundColor: CARD, borderColor: LINE, borderWidth: 1, borderRadius: 16, padding: 32, shadow: "soft" }, { mobile: { style: { padding: 20 } } }), { ratio: "5:7", stackOn: "tablet", gap: 48, align: "center" }),
    ], { background: SAGE, color: BODY, maxWidth: 1080, gap: 24 }),

    // 5. 評價：格狀（範本示意）。
    section("reviews", [
      eyebrow("reviews_eyebrow", "買家怎麼說"),
      h2("reviews_title", "第一杯就成功的人，比你想的多"),
      node("reviews_wall", "testimonial_wall", { layout: "grid", columns: 3, showRating: true, accentColor: PRIMARY, cardColor: BG, cardTextColor: INK, items: [
        { name: "買家 A｜上班族", rating: 5, title: `早上的十分鐘儀式（${SAMPLE}）`, text: "照參數卡沖，第一杯就比便利商店好喝。現在每天早上都自己沖。" },
        { name: "買家 B｜送禮", rating: 5, title: `送給爸爸的生日禮物（${SAMPLE}）`, text: "盒子很好看，一整組不用自己湊，爸爸看著影片就學會了。" },
        { name: "買家 C｜咖啡新手", rating: 4, title: `磨豆機比想像中順（${SAMPLE}）`, text: "以前以為手搖很累，其實一杯份一分鐘左右就磨好了。" },
      ] }, undefined, { textAlign: "left" }),
    ], { background: CARD, color: BODY, maxWidth: 1120, gap: 24, align: "center" }),

    // 6. 配送與退換：只寫原則，提醒商家填入實際政策。
    section("shipping", [
      node("shipping_callout", "callout", { tone: "info", title: "配送與退換", text: "付款完成後依訂單順序備貨出貨，出貨時會以 Email 通知；配送方式與時間以結帳頁為準。\n\n收到商品如有破損或缺件，請在到貨後盡快來信並附上照片，我們會協助換貨或退款。\n\n以上為範本文字，請依你實際的配送、鑑賞期與退換貨政策修改。" }, undefined, { textAlign: "left" }),
    ], { background: BG, color: BODY, maxWidth: 760, paddingY: 64, paddingYTablet: 56, paddingYMobile: 40 }),

    // 7. FAQ＋再一次報價卡。
    section("faq", [
      columns2("faq_split", [
        eyebrow("faq_eyebrow", "常見問題"),
        h2("faq_title", "下單前，你可能想問"),
        node("faq_list", "faq", { items: [
          { question: "完全沒沖過咖啡，用得來嗎？", answer: "可以。組合附沖煮教學影片與參數卡，照著步驟做，第一次就能沖出穩定的味道。" },
          { question: "有附咖啡豆嗎？", answer: "這組只有器材，不含咖啡豆。建議搭配中焙、研磨前保存良好的豆子。" },
          { question: "手沖壺可以直接放在爐上加熱嗎？", answer: "可以用於瓦斯爐與電磁爐；請依實際商品說明使用。" },
          { question: "多久會出貨？", answer: "付款完成後依訂單順序備貨，實際出貨時間與配送方式以結帳頁說明為準。" },
          { question: "可以開發票嗎？", answer: "可以，結帳時填寫發票資料即可；需要統一編號請一併填寫。" },
        ] }, undefined, { textAlign: "left", color: INK }),
      ], conversionOfferCard(prefix, "offer_again", {
          title: "入門手沖組（5 件）", lines: offerLines,
          note: "付款在安全金流頁面完成；付款完成後會寄出訂單確認信。",
          titleColor: INK, noteColor: BODY, style: offerStyle, mobile: { style: { padding: 20 } },
      }), { ratio: "7:5", stackOn: "tablet", gap: 48, align: "start" }),
    ], { background: CARD, color: BODY, maxWidth: 1120, gap: 24 }),

    section("footer", [
      text("footer_text", "© 日向焙煎（虛構品牌）｜商品與訂單問題，請來信洽詢。", "small", { color: "#e9e1d6" }),
      button("footer_top", "回到商品", "#offer", { backgroundColor: "transparent", color: "#f6f3ee", borderColor: "#8a7766", borderWidth: 1, borderRadius: 10, padding: "10px 20px", width: "fit-content", margin: "0 auto", fontSize: 15 }),
    ], { background: INK, color: "#e9e1d6", maxWidth: 960, paddingY: 40, paddingYTablet: 36, paddingYMobile: 28, gap: 14, align: "center" }),
  ];
}

export const template: ConversionTemplateDefinition = {
  id: "sales-product-coffee",
  kind: "sales",
  number: 4,
  name: "實體商品銷售頁（手沖咖啡）",
  description: "電商商品頁：首屏商品主圖＋報價卡，往下是組合內容、特色、規格白卡、評價、配送與退換，FAQ 旁再放一次報價卡。",
  category: "實體商品",
  purposes: ["sales"],
  styles: ["natural"],
  preview: { eyebrow: "銷售頁", headline: "在家沖一杯好咖啡，從這組 5 件器材開始", summary: "商品主圖＋首屏報價卡", palette: [BG, PRIMARY, GREEN], sectionCount: 8 },
  theme: { typography: { headingFont: "serif-tc", bodyFont: "sans-tc", bodySize: 17, bodyLineHeight: 1.75, textColor: BODY, headingColor: INK, linkColor: PRIMARY }, background: { color: BG } },
  settings: { scrollReveal: "rise", stickyCta: { enabled: true, label: "購買入門手沖組", target: "offer", showDate: false, devices: "mobile_tablet", buttonColor: PRIMARY, buttonTextColor: CARD, backgroundColor: CARD } },
  build,
  thankYou: {
    name: "手沖咖啡・訂單感謝頁",
    description: "說明訂單確認信、備貨出貨與收到後的沖煮教學。",
    tokens: { background: BG, surface: CARD, ink: INK, body: BODY, accent: PRIMARY, onAccent: CARD, line: LINE, footerBackground: INK, footerText: "#e9e1d6", radius: 10 },
    eyebrow: "已收到你的訂單",
    title: "謝謝你，第一杯手沖咖啡快到了",
    intro: "付款完成後，你會收到一封訂單確認信；出貨時會再寄一封出貨通知。如果沒看到，請檢查促銷內容或垃圾郵件匣。",
    card: { title: "出貨說明", text: "入門手沖組（5 件）：付款確認後依訂單順序備貨，出貨方式與時間以結帳頁說明為準。收到後請先確認 5 件器材都在盒內。", buttonLabel: "看看接下來的步驟", buttonHref: "#ty-steps" },
    steps: [
      { icon: "message", title: "收訂單確認信", text: "確認信裡有訂單編號與收件資料，有錯請盡快回信更正。" },
      { icon: "rocket", title: "備貨出貨", text: "出貨時會寄出貨通知；配送進度以物流通知為準。" },
      { icon: "play", title: "看沖煮教學", text: "收到後掃描參數卡上的連結看教學影片，照著沖第一杯。" },
    ],
    next: { eyebrow: "收到之後", title: "挑一包適合新手的咖啡豆", text: "器材到了，豆子也很重要。可以從中焙、果香不過酸的豆子開始。", buttonLabel: "了解選豆建議", buttonHref: "#ty-steps" },
    faq: [
      { question: "多久會出貨？", answer: "付款完成後依訂單順序備貨，實際出貨時間與配送方式以結帳頁說明與出貨通知為準。" },
      { question: "收到商品有破損怎麼辦？", answer: "請在到貨後盡快來信，附上訂單編號與照片，我們會協助換貨或退款。" },
      { question: "發票會怎麼寄？", answer: "電子發票會寄到結帳時填寫的 Email；需要統一編號請確認結帳時已填寫。" },
    ],
    footer: "© 日向焙煎（虛構品牌）｜商品與訂單問題，請來信洽詢。",
  },
};
