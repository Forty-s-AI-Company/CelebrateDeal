import { CONVERSION_TEMPLATE_SAMPLE_MARK, conversionOfferCard, conversionTemplateKit, type ConversionTemplateDefinition } from "../conversion/types";

/**
 * 銷售 01：長篇課程銷售頁（specs/sales-01-course-watercolor.md）。
 * 紙底、酒紅按鈕與文楷標題：水彩暈染首屏＋作品拼貼，往下依序處理「我真的畫得出來嗎」的疑慮——
 * 痛點、老師的故事、8 週課綱、學員作品與回饋，最後才是價值清單＋報價卡、退費說明與 FAQ。
 * 售價與結帳只來自報價卡（綁定的商品）；價值清單的金額只是展示並標示範本示意。
 */
const ART = "/funnel-illustrations/sales/01";
const BG = "#fbf7f2";
const CARD = "#ffffff";
const INK = "#2b2330";
const BODY = "#4b4350";
const MUTED = "#625a66";
const PRIMARY = "#8f3b5c";
const BLUE = "#2f5f8a";
const ROSE = "#f5ebe8";
const LINE = "#e9dfd8";
const SAMPLE = CONVERSION_TEMPLATE_SAMPLE_MARK;

function build(prefix: string) {
  const { node, section, columns2, stack, headline, text, button } = conversionTemplateKit(prefix);
  const cta = { backgroundColor: PRIMARY, color: CARD, borderRadius: 100, fontSize: 18, padding: "16px 36px", width: "fit-content" } as const;
  const ctaCenter = { ...cta, margin: "0 auto" } as const;
  const panel = { backgroundColor: CARD, borderColor: LINE, borderWidth: 1, borderRadius: 20, padding: 40, shadow: "soft" } as const;
  const eyebrow = (id: string, value: string, color: string = PRIMARY) => text(id, value, "eyebrow", { color, letterSpacing: 2 });
  const h2 = (id: string, value: string, mobileText?: string) => headline(id, value, "h2", { color: INK, fontSize: 38, lineHeight: 1.35 }, {
    tablet: { style: { fontSize: 32 } },
    mobile: { style: { fontSize: 26, lineHeight: 1.4 }, ...(mobileText ? { props: { text: mobileText } } : {}) },
  });

  return [
    // 1. 首屏：水彩暈染背景、左文案右作品拼貼。成果就是標題，CTA 直接捲到報價卡。
    section("hero", [
      columns2("hero_split", [
        eyebrow("hero_eyebrow", "零基礎水彩｜8 週線上陪伴課"),
        headline("hero_title", "8 週，從不敢下筆\n到畫完一本水彩小冊", "h1", { color: INK, fontSize: 54, lineHeight: 1.3 }, {
          tablet: { style: { fontSize: 44 } },
          mobile: { style: { fontSize: 32, lineHeight: 1.35 }, props: { text: "8 週，從不敢下筆到畫完一本水彩小冊" } },
        }),
        text("hero_lead", "不用美術底子，也不用一次買齊昂貴畫材。每週一個主題、一張作業，老師親自批改，8 週後你會有一本自己畫的小冊子。", "lead", { color: BODY }),
        button("hero_cta", "查看課程方案", "#offer", cta, { mobile: { style: { width: "100%" } } }),
        text("hero_points", "✓ 每週一支 30 分鐘示範影片　✓ 作業批改 4 次　✓ 一年內無限次回看", "small", { color: MUTED, lineHeight: 1.9 }, { mobile: { props: { text: "✓ 每週一支 30 分鐘示範影片\n✓ 作業批改 4 次\n✓ 一年內無限次回看" } } }),
      ], [
        node("hero_collage", "image", { src: `${ART}/hero-collage.svg`, alt: "學員水彩作品拼貼示意：檸檬、繡球花與港口小景" }, undefined, { imageWidth: 100 }),
      ], { ratio: "1:1", stackOn: "tablet", gap: 56, align: "center" }),
    ], { background: BG, color: BODY, maxWidth: 1160, paddingY: 96, paddingYTablet: 64, paddingYMobile: 32, gap: 24, props: { backgroundImage: `${ART}/wash-hero.svg`, backgroundPosition: "right" } }),

    // 2. 你是不是也這樣：四個常見卡關，2 欄白卡。
    section("pain", [
      eyebrow("pain_eyebrow", "開始之前"),
      h2("pain_title", "你是不是也這樣？"),
      stack("pain_panel", [
        node("pain_list", "icon_list", { layout: "grid", columns: 2, numbered: false, accentColor: PRIMARY, items: [
          { icon: "heart", title: "收藏了上百張水彩圖", text: "每張都好喜歡，但一拿起筆就不知道從哪裡開始。" },
          { icon: "spark", title: "顏色一疊就變髒", text: "想要透明感，畫出來卻總是灰灰濁濁的一片。" },
          { icon: "clock", title: "看了很多影片還是卡住", text: "影片很快、步驟很多，暫停十次也跟不上。" },
          { icon: "message", title: "畫完不知道哪裡要改", text: "覺得怪怪的，卻沒有人能告訴你下一張該怎麼調整。" },
        ] }, undefined, { color: BODY, textAlign: "left" }),
      ], 0, panel, { mobile: { style: { padding: 22 } } }),
      text("pain_answer", "這些都不是天分問題，是少了「順序」與「有人看你的作業」。", "lead", { color: BLUE, textAlign: "center" }),
    ], { background: CARD, color: BODY, maxWidth: 960, gap: 24, align: "center" }),

    // 3. 老師的故事：大頭照＋經歷，數據標示範本示意。
    section("teacher", [
      eyebrow("teacher_eyebrow", "關於老師"),
      h2("teacher_title", "我也曾經，連一顆檸檬都畫不好"),
      node("teacher_card", "speaker_profiles", { layout: "featured", photoShape: "portrait", accentColor: PRIMARY, gradientFrom: PRIMARY, gradientTo: BLUE, items: [
        { photo: `${ART}/teacher.svg`, alt: "蘇映晴老師照片（請替換為本人照片）", name: "蘇映晴", role: "插畫家・水彩講師（虛構人物）", bio: "三十歲才第一次拿起水彩筆。從那顆畫壞的檸檬開始，我把自己一路摸索的順序整理成 8 週：先學會控制水，再學顏色，最後才是構圖。現在帶過的學員裡，有一半以前完全沒畫過畫。", tags: "插畫家,水彩講師,繪本作者" },
      ] }, undefined, { color: INK, textAlign: "left" }),
      node("teacher_stats", "stats", { animate: true, framed: false, accentColor: PRIMARY, items: [
        { value: "8", suffix: "年", label: `水彩教學經驗（${SAMPLE}）` },
        { value: "2600", suffix: "+", label: `線上課學員（${SAMPLE}）` },
        { value: "4.9", suffix: "/5", label: `課程平均評分（${SAMPLE}）` },
      ] }, undefined, { color: INK }),
    ], { background: BG, color: BODY, maxWidth: 1040, gap: 36, align: "center" }),

    // 4. 8 週課綱：直式時間軸＋中段 CTA。
    section("syllabus", [
      eyebrow("syllabus_eyebrow", "8 週課綱", BLUE),
      h2("syllabus_title", "一週只學一件事，\n第 8 週畫完你的小冊", "一週只學一件事，第 8 週畫完你的小冊"),
      text("syllabus_lead", "每週一支示範影片、一份講義與一張作業。照順序畫，每一週都建立在上一週的基礎上。", undefined, { color: BODY, textAlign: "center" }),
      stack("syllabus_panel", [
        node("syllabus_timeline", "agenda_timeline", { layout: "vertical", accentColor: BLUE, items: [
          { time: "第 1 週", title: "認識水與紙", text: "平塗、漸層與留白，先學會讓水聽你的話。", tag: "基礎" },
          { time: "第 2 週", title: "色彩的濃淡", text: "只用三原色調出 12 種顏色，畫一顆有光的檸檬。", tag: "基礎" },
          { time: "第 3 週", title: "濕中濕暈染", text: "天空、花瓣與柔和背景，掌握水量的時機。", tag: "技法" },
          { time: "第 4 週", title: "光與影", text: "從亮到暗的三個層次，讓杯子與水果立起來。", tag: "技法" },
          { time: "第 5 週", title: "花卉與葉子", text: "一筆成形的筆觸練習，畫一束繡球花。", tag: "主題" },
          { time: "第 6 週", title: "小動物", text: "毛流與輪廓的取捨，畫一隻枝頭上的小麻雀。", tag: "主題" },
          { time: "第 7 週", title: "風景與構圖", text: "三分法與前中後景，畫一張港口小景。", tag: "構圖" },
          { time: "第 8 週", title: "完成你的小冊", text: "挑出 6 張作品、補上封面與手寫標題，裝訂成冊。", tag: "成果" },
        ] }, undefined, { color: INK, textAlign: "left" }),
      ], 0, panel, { mobile: { style: { padding: 20 } } }),
      button("syllabus_cta", "查看課程方案", "#offer", ctaCenter),
    ], { background: CARD, color: BODY, maxWidth: 820, gap: 24, align: "center" }),

    // 5. 學員作品：拼貼圖庫（範本示意）。
    section("works", [
      eyebrow("works_eyebrow", "學員作品"),
      h2("works_title", "他們 8 週前，也說自己不會畫"),
      node("works_gallery", "image_gallery", { layout: "masonry", columns: 3, items: [
        { src: `${ART}/work-lemons.svg`, alt: "學員作品示意：盤子上的檸檬", caption: `第 2 週・檸檬（${SAMPLE}）` },
        { src: `${ART}/work-hydrangea.svg`, alt: "學員作品示意：藍紫色繡球花", caption: `第 5 週・繡球花（${SAMPLE}）` },
        { src: `${ART}/work-harbor.svg`, alt: "學員作品示意：黃昏港口", caption: `第 7 週・港口小景（${SAMPLE}）` },
        { src: `${ART}/work-teacup.svg`, alt: "學員作品示意：玫瑰色茶杯", caption: `第 4 週・茶杯（${SAMPLE}）` },
        { src: `${ART}/work-forest.svg`, alt: "學員作品示意：晨霧中的森林", caption: `第 7 週・晨霧森林（${SAMPLE}）` },
        { src: `${ART}/work-sparrow.svg`, alt: "學員作品示意：枝頭上的小麻雀", caption: `第 6 週・小麻雀（${SAMPLE}）` },
      ] }),
      text("works_note", `以上作品為${SAMPLE}插圖，發布前請替換為經學員同意公開的作品。`, "small", { color: MUTED, textAlign: "center" }),
    ], { background: BG, color: BODY, maxWidth: 1120, gap: 24, align: "center" }),

    // 6. 學員回饋：格狀評價（範本示意）。
    section("reviews", [
      eyebrow("reviews_eyebrow", "學員回饋", BLUE),
      h2("reviews_title", "最常聽到的一句話：「原來我可以」"),
      node("reviews_wall", "testimonial_wall", { layout: "grid", columns: 3, showRating: true, accentColor: PRIMARY, cardColor: BG, cardTextColor: INK, items: [
        { name: "學員 A｜會計", rating: 5, title: `第一次畫出透明感（${SAMPLE}）`, text: "以前顏色一疊就髒，第 2 週學會等紙乾的時機，檸檬終於有光了。" },
        { name: "學員 B｜國小老師", rating: 5, title: `批改很具體（${SAMPLE}）`, text: "老師會圈出哪一筆水太多、哪裡可以留白，下一張馬上就知道怎麼改。" },
        { name: "學員 C｜退休族", rating: 5, title: `節奏剛剛好（${SAMPLE}）`, text: "一週一個主題，週末畫兩個小時就跟得上，不會有壓力。" },
        { name: "學員 D｜工程師", rating: 5, title: `下班後的固定時光（${SAMPLE}）`, text: "畫畫變成我每週最期待的事，小冊子現在放在辦公桌上。" },
        { name: "學員 E｜新手媽媽", rating: 4, title: `回看很方便（${SAMPLE}）`, text: "孩子睡了才有時間，影片可以分段看，講義也整理得很清楚。" },
        { name: "學員 F｜設計師", rating: 5, title: `補上了基本功（${SAMPLE}）`, text: "平常用電腦畫圖，這堂課讓我重新理解水和顏色，手繪變得好玩。" },
      ] }, undefined, { textAlign: "left" }),
    ], { background: CARD, color: BODY, maxWidth: 1120, gap: 28, align: "center" }),

    // 7. 你會得到（價值清單，純展示）＋報價卡（價格與結帳來自綁定商品）。
    section("plan", [
      eyebrow("plan_eyebrow", "課程方案"),
      h2("plan_title", "這 8 週，你會得到"),
      node("plan_deadline", "deadline_notice", { label: "本梯次報名截止", closedText: "本梯次已截止報名，歡迎留意下一梯次", accentColor: PRIMARY }, undefined, { color: INK }),
      columns2("plan_split", [
        node("plan_stack", "value_stack", {
          title: "課程內容",
          items: [
            { title: "8 週示範影片", text: "每週 30 分鐘，慢速示範＋重點字幕。", value: "NT$4,800" },
            { title: "作業批改 4 次", text: "老師逐張圈註，告訴你下一張怎麼改。", value: "NT$3,200" },
            { title: "每週直播答疑", text: "直播中直接問，錯過也能看回放。", value: "NT$1,600" },
            { title: "講義與色卡 PDF", text: "調色表、構圖格線與畫材清單。", value: "NT$600" },
            { title: "學員社群", text: "和同梯同學一起交作業、互相打氣。", value: "NT$800" },
          ],
          totalLabel: "總價值", totalValue: "NT$11,000",
          note: `價值為${SAMPLE}參考，非售價承諾；實際售價以右側方案為準。`,
          accentColor: PRIMARY, cardColor: CARD, cardTextColor: INK,
        }, undefined, { textAlign: "left" }),
      ], conversionOfferCard(prefix, "offer", {
        title: "零基礎水彩 8 週線上課",
        lines: ["✓ 8 週示範影片＋每週直播答疑", "✓ 作業批改 4 次", "✓ 講義、色卡與學員社群", "✓ 一年內無限次回看"],
        note: "付款在安全金流頁面完成；付款完成後，課程開通信會寄到你的 Email。",
        titleColor: INK, noteColor: BODY, htmlId: "offer",
        style: { backgroundColor: CARD, borderColor: PRIMARY, borderWidth: 2, borderRadius: 20, padding: 36, shadow: "medium", color: INK },
        mobile: { style: { padding: 22 } },
      }), { ratio: "7:5", stackOn: "tablet", gap: 40, align: "start" }),
    ], { background: ROSE, color: BODY, maxWidth: 1080, gap: 24, align: "center" }),

    // 8. 安心保證（提醒商家依實際政策修改）。
    section("guarantee", [
      node("guarantee_callout", "callout", { tone: "info", title: "7 天安心退費", text: "開課 7 天內覺得不適合，且觀看進度未超過 2 週，可來信申請全額退費。\n\n以上為範本文字，請依你實際的退費政策修改，並與結帳頁的退款政策一致。" }, undefined, { textAlign: "left" }),
    ], { background: BG, color: BODY, maxWidth: 760, paddingY: 64, paddingYTablet: 56, paddingYMobile: 40 }),

    // 9. FAQ＋最後 CTA。
    section("faq", [
      eyebrow("faq_eyebrow", "常見問題", BLUE),
      h2("faq_title", "報名前，你可能想問"),
      node("faq_list", "faq", { items: [
        { question: "完全沒有畫畫經驗也可以嗎？", answer: "可以。第 1 週從怎麼拿筆、怎麼控制水量開始，課程就是為零基礎設計的。" },
        { question: "需要先買哪些畫材？", answer: "一盒 12 色固體水彩、兩支圓頭筆與一本 300g 水彩紙就夠了。開通後會收到畫材清單與替代選擇。" },
        { question: "每週要花多少時間？", answer: "影片約 30 分鐘，加上作業練習，每週約 2–3 小時。進度可以自己安排。" },
        { question: "錯過直播怎麼辦？", answer: "每場直播都有回放，也可以把問題留在學員社群，老師會在下一次直播回答。" },
        { question: "課程可以看多久？", answer: "開通後一年內無限次回看，講義可以下載保存。" },
        { question: "可以開發票或分期嗎？", answer: "結帳時可填寫發票資料；付款方式依結帳頁顯示為準。" },
      ] }, undefined, { textAlign: "left", color: INK }),
    ], { background: CARD, color: BODY, maxWidth: 760, gap: 24, align: "center" }),

    section("closing", [
      h2("closing_title", "下一本小冊，從第一筆開始"),
      text("closing_text", "8 週後回頭看，你會驚訝那顆畫壞的檸檬，原來只是起點。", "lead", { color: BODY }),
      button("closing_cta", "查看課程方案", "#offer", ctaCenter),
    ], { background: BG, color: BODY, maxWidth: 720, gap: 20, align: "center", paddingY: 104, paddingYMobile: 64, props: { backgroundImage: `${ART}/wash-hero.svg`, backgroundPosition: "center" } }),

    section("footer", [
      text("footer_text", "© 映晴水彩教室（虛構品牌）｜課程問題請來信，我們會在 2 個工作天內回覆。", "small", { color: "#e8e1ea" }),
    ], { background: INK, color: "#e8e1ea", maxWidth: 960, paddingY: 40, paddingYTablet: 36, paddingYMobile: 28, align: "center" }),
  ];
}

export const template: ConversionTemplateDefinition = {
  id: "sales-course-watercolor",
  kind: "sales",
  number: 1,
  name: "長篇課程銷售頁（水彩）",
  description: "完整說服的長篇課程頁：水彩首屏、痛點、老師故事、8 週課綱、作品與回饋，再到價值清單＋報價卡、退費說明與 FAQ。",
  category: "線上課程",
  purposes: ["sales"],
  styles: ["warm"],
  preview: { eyebrow: "銷售頁", headline: "8 週，從不敢下筆到畫完一本水彩小冊", summary: "長篇課程銷售信＋報價卡", palette: [BG, PRIMARY, BLUE], sectionCount: 11 },
  theme: { typography: { headingFont: "wenkai-tc", bodyFont: "sans-tc", bodySize: 17, bodyLineHeight: 1.8, textColor: BODY, headingColor: INK, linkColor: PRIMARY }, background: { color: BG } },
  settings: { scrollReveal: "rise", stickyCta: { enabled: true, label: "查看課程方案", target: "offer", showDate: false, devices: "mobile_tablet", buttonColor: PRIMARY, buttonTextColor: CARD, backgroundColor: CARD } },
  build,
  thankYou: {
    name: "水彩課程・訂單感謝頁",
    description: "說明付款確認信與課程開通方式，引導加入學員社群。",
    tokens: { background: BG, surface: CARD, ink: INK, body: BODY, accent: PRIMARY, onAccent: CARD, line: LINE, footerBackground: INK, footerText: "#e8e1ea", radius: 16 },
    eyebrow: "已收到你的訂單",
    title: "謝謝你，準備好第一張水彩紙吧",
    intro: "付款完成後，你會收到一封付款確認信與課程開通信。如果 10 分鐘內沒看到，請檢查促銷內容或垃圾郵件匣。",
    card: { title: "課程開通說明", text: "零基礎水彩 8 週線上課：付款確認後即可用結帳時填寫的 Email 登入課程，第 1 週影片、講義與畫材清單已經準備好。", buttonLabel: "看看接下來怎麼做", buttonHref: "#ty-steps" },
    steps: [
      { icon: "message", title: "收付款確認信", text: "確認信裡有登入連結。把寄件者加入通訊錄，之後的作業提醒才不會漏接。" },
      { icon: "book", title: "登入課程", text: "先看第 1 週影片，照畫材清單準備好紙、筆與顏料。" },
      { icon: "users", title: "加入學員社群", text: "在社群自我介紹，第一次作業也從這裡上傳。" },
    ],
    next: { eyebrow: "上課前", title: "加入同梯學員社群", text: "和同梯同學一起交作業、互相打氣；老師每週會在社群公告直播時間。", buttonLabel: "了解社群怎麼加入", buttonHref: "#ty-steps" },
    faq: [
      { question: "發票什麼時候會寄出？", answer: "電子發票會在付款完成後寄到結帳時填寫的 Email；需要統一編號請在結帳時填寫。" },
      { question: "想申請退費怎麼辦？", answer: "請依課程頁的退費說明來信申請，並附上訂單編號，我們會在工作天內回覆處理進度。" },
      { question: "沒收到信或無法登入？", answer: "先檢查垃圾郵件匣；仍找不到時，請來信並附上訂單編號與結帳時的 Email。" },
    ],
    footer: "© 映晴水彩教室（虛構品牌）｜課程問題請來信，我們會在 2 個工作天內回覆。",
  },
};
