import { CONVERSION_TEMPLATE_SAMPLE_MARK, conversionOfferCard, conversionTemplateKit, type ConversionTemplateDefinition } from "../conversion/types";

/**
 * 銷售 07：低價入門商品頁（specs/sales-07-tripwire-mealprep.md）。
 * 暖杏底、焦橘按鈕與蔬菜綠點綴；價格前置：首屏右側就是報價卡與營運截止提示（手機緊接在 H1 後）。
 * 往下只回答「裡面有什麼、做出來長怎樣、誰寫的、別人怎麼說」，最後 FAQ 旁再放一次報價卡。
 * 只用營運設定的截止時間，不寫死倒數或名額。作者與品牌為虛構；插畫在 public/funnel-illustrations/sales/07/（原創）。
 */
const ART = "/funnel-illustrations/sales/07";
const BG = "#fff8f1";
const CARD = "#ffffff";
const INK = "#2a1a10";
const BODY = "#4d3a2e";
const PRIMARY = "#b93d17";
const GREEN = "#2f7a3f";
const PEACH = "#ffe8d6";
const LINE = "#f0dccb";
/** Deep green for small accent text on the peach band (the brand green is just under 4.5:1 there). */
const GREEN_DEEP = "#25602f";

function build(prefix: string) {
  const { node, section, columns2, stack, headline, text, button } = conversionTemplateKit(prefix);
  const h2 = (id: string, value: string, mobileText?: string) => headline(id, value, "h2", { color: INK, fontSize: 38, lineHeight: 1.28 }, { tablet: { style: { fontSize: 32 } }, mobile: { style: { fontSize: 26, lineHeight: 1.35 }, ...(mobileText ? { props: { text: mobileText } } : {}) } });
  const heading = (id: string, eyebrow: string, title: string, color = GREEN) => stack(`${id}_heading`, [
    text(`${id}_eyebrow`, eyebrow, "eyebrow", { color, letterSpacing: 2 }),
    h2(`${id}_title`, title),
  ], 10, { textAlign: "center" });
  const offerStyle = { backgroundColor: CARD, color: INK, borderColor: INK, borderWidth: 2, borderRadius: 22, padding: 32, shadow: "strong" } as const;
  const offerLines = ["✓ 5 天 10 道午晚餐食譜（PDF，手機好讀）", "✓ 採買清單＋週末 3 小時備餐時間表", "✓ 付款完成後，下載連結寄到你的 Email"];

  return [
    // 1. 首屏：左 H1 與插畫，右報價卡＋截止提示（平板以下：H1 → 報價卡）。
    section("hero", [
      columns2("hero_split", [
        text("hero_eyebrow", "新手備餐入門｜PDF 食譜包", "eyebrow", { color: PRIMARY, letterSpacing: 2 }),
        headline("hero_title", "一個週末，\n備好 5 天午晚餐", "h1", { color: INK, fontSize: 60, lineHeight: 1.18 }, {
          tablet: { style: { fontSize: 46 } },
          mobile: { style: { fontSize: 34, lineHeight: 1.25 } },
        }),
        text("hero_lead", "營養師設計的 10 道備餐食譜，週日花 3 小時，週一到週五打開冰箱就有飯吃。", "lead", { color: BODY }),
        button("hero_more", "先看食譜包裡有什麼 ↓", "#inside", { backgroundColor: "transparent", color: INK, borderColor: INK, borderWidth: 2, borderRadius: 300, padding: "12px 24px", width: "fit-content", fontSize: 16 }),
        node("hero_art", "image", { src: `${ART}/hero-boxes.svg`, alt: "插畫：四個裝好午晚餐的備餐保鮮盒疊在一起" }, undefined, { imageWidth: 100 }, { tablet: { visible: false }, mobile: { visible: false } }),
      ], stack("hero_buy", [
        conversionOfferCard(prefix, "offer", {
          title: "一週備餐食譜包",
          lines: offerLines,
          note: "入門價以結帳頁顯示為準；數位商品，付款完成後即寄出。",
          style: offerStyle,
          mobile: { style: { padding: 20 } },
          titleColor: INK,
          noteColor: BODY,
          htmlId: "offer",
        }),
        node("hero_deadline", "deadline_notice", { label: "入門價供應至", closedText: "入門價已結束，歡迎留意下一次的備餐企劃。", accentColor: PRIMARY }, undefined, { color: INK }),
      ], 16), { ratio: "7:5", stackOn: "tablet", gap: 56, align: "center" }),
    ], { background: BG, color: BODY, maxWidth: 1160, paddingY: 80, paddingYTablet: 48, paddingYMobile: 28 }),

    // 2. 包含內容。
    section("inside", [
      heading("inside", "WHAT'S INSIDE", "打開食譜包，你會拿到", GREEN_DEEP),
      node("inside_list", "icon_list", { layout: "grid", columns: 3, numbered: false, accentColor: PRIMARY, items: [
        { icon: "book", title: "10 道午晚餐食譜", text: "每道都標好份量、熱量與蛋白質，照著做不用算。" },
        { icon: "check", title: "一頁採買清單", text: "依超市區域排好，週六一趟買齊，不會多買。" },
        { icon: "clock", title: "3 小時備餐時間表", text: "烤箱、電鍋、爐子同時開工，哪一步先做都寫好了。" },
        { icon: "shield", title: "保存與回熱表", text: "哪些冷藏、哪些冷凍，微波幾分鐘最好吃。" },
        { icon: "heart", title: "替換食材建議", text: "不吃牛、吃素或過敏，都有對應的替換方式。" },
        { icon: "star", title: "便當盒擺盤示範", text: "帶去公司也好看，同事會問你在哪買的。" },
      ] }, undefined, { color: BODY, textAlign: "left" }),
    ], { background: PEACH, color: BODY, maxWidth: 1120, gap: 44, htmlId: "inside" }),

    // 3. 菜色預覽。
    section("dishes", [
      heading("dishes", "PREVIEW", "這週你會吃到的菜色", PRIMARY),
      node("dishes_cards", "image_cards", { columns: 4, aspect: "4:3", corners: false, accentColor: PRIMARY, items: [
        { src: `${ART}/dish-chicken.svg`, alt: "菜色插畫：檸檬香草雞胸便當，配糙米飯與花椰菜", title: "檸檬香草雞胸", text: "烤箱一次烤 5 份，冷藏 4 天依然多汁。" },
        { src: `${ART}/dish-salmon.svg`, alt: "菜色插畫：烤鮭魚、地瓜條與四季豆", title: "烤鮭魚佐地瓜", text: "同一個烤盤完成主菜與澱粉，洗碗也省事。" },
        { src: `${ART}/dish-tofu.svg`, alt: "菜色插畫：照燒豆腐丁、青蔥與小番茄", title: "照燒豆腐丁", text: "素食也能吃飽，醬汁可以一次做一週份。" },
        { src: `${ART}/dish-curry.svg`, alt: "菜色插畫：根莖蔬菜咖哩配白飯", title: "根莖蔬菜咖哩", text: "冷凍保存最穩，忙的那天直接回熱。" },
      ] }, undefined, { color: INK, textAlign: "left" }, { mobile: { props: { aspect: "16:9" } } }),
      text("dishes_note", "插畫為菜色示意，請替換成你的實拍照片。", "small", { color: BODY, textAlign: "center" }),
    ], { background: BG, color: BODY, maxWidth: 1200, gap: 40 }),

    // 4. 作者（小頭像置中）。
    section("author", [
      node("author_card", "speaker_profiles", { layout: "featured", size: "small", photoShape: "circle", accentColor: PRIMARY, gradientFrom: PRIMARY, gradientTo: GREEN, items: [
        { photo: `${ART}/author.svg`, alt: "營養師曾小米的插畫頭像（虛構，可替換為照片）", name: "曾小米", role: "營養師（虛構）", tags: "上班族備餐,減醣飲食,家常料理", bio: "在醫院營養室工作時，最常聽到的是「我知道要吃好，但沒時間煮」。這份食譜包是我自己每週日的備餐流程，整理成新手也做得到的版本（範本示意經歷）。" },
      ] }, undefined, { color: INK }),
    ], { background: CARD, color: BODY, maxWidth: 720, align: "center" }),

    // 5. 評價（範本示意）。
    section("reviews", [
      heading("reviews", "REVIEWS", "照著做了一週之後", PRIMARY),
      node("reviews_wall", "testimonial_wall", { layout: "grid", columns: 3, autoplay: false, showRating: false, cardColor: CARD, cardTextColor: BODY, accentColor: PRIMARY, items: [
        { name: "上班族 A", title: CONVERSION_TEMPLATE_SAMPLE_MARK, text: "第一次備餐就成功，週三中午打開便當的時候真的很有成就感。" },
        { name: "新手爸媽 B", title: CONVERSION_TEMPLATE_SAMPLE_MARK, text: "採買清單幫大忙，週六一趟超市就搞定，不會再買一堆用不完的菜。" },
        { name: "研究生 C", title: CONVERSION_TEMPLATE_SAMPLE_MARK, text: "回熱表很實用，咖哩冷凍兩週拿出來還是很好吃。" },
      ] }, undefined, { textAlign: "left" }),
    ], { background: PEACH, color: BODY, maxWidth: 1120, gap: 40, align: "center" }),

    // 6. FAQ＋退款說明＋第二張報價卡。
    section("close", [
      columns2("close_split", [
        h2("close_title", "買之前想先問"),
        node("close_faq", "faq", { items: [
          { question: "完全沒下過廚也做得到嗎？", answer: "可以。每道菜都只用電鍋、烤箱或一只平底鍋，步驟都有照片順序說明。" },
          { question: "需要買特別的廚具嗎？", answer: "準備 10 個保鮮盒和一個烤盤就夠了，清單裡有推薦的尺寸。" },
          { question: "食譜是一個人的份量嗎？", answer: "預設是一人 5 天午晚餐，每道菜都附兩人份的換算。" },
          { question: "付款後多久收到？", answer: "付款完成後，下載連結會寄到你填寫的 Email，可以重複下載。" },
        ] }, undefined, { color: BODY, textAlign: "left" }),
        node("close_refund", "callout", { tone: "info", title: "退款說明（請依實際政策修改）", text: "數位商品寄出後，若檔案無法開啟或內容與介紹不符，7 天內來信即可申請退款。\n\n以上為範本示意，請改成你的實際退款政策。" }, undefined, { color: INK, textAlign: "left" }),
      ], stack("close_buy", [
        conversionOfferCard(prefix, "offer_again", {
          title: "這個週末就開始備餐",
          lines: offerLines,
          note: "入門價以結帳頁顯示為準；數位商品，付款完成後即寄出。",
          style: offerStyle,
          mobile: { style: { padding: 20 } },
          titleColor: INK,
          noteColor: BODY,
        }),
        node("close_deadline", "deadline_notice", { label: "入門價供應至", closedText: "入門價已結束，歡迎留意下一次的備餐企劃。", accentColor: PRIMARY }, undefined, { color: INK }),
      ], 16), { ratio: "7:5", stackOn: "tablet", gap: 56, align: "start" }),
    ], { background: BG, color: BODY, maxWidth: 1120, paddingY: 96 }),

    // 7. 頁尾。
    section("footer", [
      text("footer_text", "© 小米的備餐廚房（虛構品牌）｜食譜包為數位商品，付款完成後以 Email 寄送。", "small", { color: BODY }),
      button("footer_top", "回到報價", "#offer", { backgroundColor: "transparent", color: INK, borderColor: INK, borderWidth: 1, borderRadius: 10, padding: "10px 20px", width: "fit-content", margin: "0 auto", fontSize: 15 }),
    ], { background: CARD, color: BODY, maxWidth: 960, paddingY: 40, paddingYTablet: 36, paddingYMobile: 28, gap: 12, align: "center" }),
  ];
}

export const template: ConversionTemplateDefinition = {
  id: "sales-tripwire-mealprep",
  kind: "sales",
  number: 7,
  name: "低價入門商品頁",
  description: "價格前置的入門商品頁：首屏就是報價卡與營運截止提示，接著內容清單、菜色預覽、作者與評價，FAQ 旁再給一次結帳。",
  category: "入門商品",
  purposes: ["sales"],
  styles: ["vivid"],
  preview: { eyebrow: "銷售頁", headline: "一個週末備好 5 天午晚餐", summary: "首屏報價卡＋菜色預覽", palette: [BG, PRIMARY, GREEN], sectionCount: 7 },
  theme: { typography: { headingFont: "sans-tc", bodyFont: "sans-tc", bodySize: 17, bodyLineHeight: 1.75, textColor: BODY, headingColor: INK, linkColor: PRIMARY }, background: { color: BG } },
  settings: { scrollReveal: "rise", stickyCta: { enabled: true, label: "購買食譜包", target: "offer", showDate: false, devices: "mobile_tablet", buttonColor: PRIMARY, buttonTextColor: CARD, backgroundColor: CARD } },
  build,
  thankYou: {
    name: "備餐食譜包・訂單感謝頁",
    description: "說明付款確認信與下載方式，並推薦完整 4 週備餐課。",
    tokens: { background: BG, surface: CARD, ink: INK, body: BODY, accent: PRIMARY, onAccent: CARD, line: LINE, footerBackground: INK, footerText: "#f5e3d3", radius: 12 },
    eyebrow: "訂單已送出",
    title: "這個週末，\n冰箱就會被填滿",
    intro: "付款完成後，確認信與食譜包下載連結會寄到你填寫的 Email。沒看到的話，請檢查促銷內容或垃圾郵件匣。",
    card: { title: "一週備餐食譜包（PDF）", text: "10 道午晚餐食譜、採買清單與 3 小時備餐時間表。建議先印出採買清單，週六帶去超市。", buttonLabel: "看接下來怎麼做", buttonHref: "#ty-steps" },
    steps: [
      { icon: "message", title: "收確認信", text: "付款完成後寄出，信裡有食譜包的下載連結。" },
      { icon: "book", title: "下載並存到手機", text: "PDF 可以重複下載，存到手機做菜時直接看。" },
      { icon: "heart", title: "週末開始備餐", text: "週六採買、週日照時間表做 3 小時，週一就有便當。" },
    ],
    next: { eyebrow: "做完一週還想繼續？", title: "完整 4 週備餐課", text: "四週不重複的菜單、每週直播答疑與冷凍備餐進階技巧，讓備餐變成習慣。", buttonLabel: "了解 4 週備餐課", buttonHref: "#ty-steps" },
    faq: [
      { question: "發票會寄到哪裡？", answer: "付款完成後開立電子發票，寄到結帳時填寫的 Email。" },
      { question: "檔案打不開可以退款嗎？", answer: "先回覆確認信，我們會重新寄送；仍無法使用時依退款說明處理。範本示意，請依實際政策修改。" },
      { question: "做菜遇到問題可以問誰？", answer: "直接回覆確認信，營運團隊會在上班時間回覆。" },
    ],
    footer: "© 小米的備餐廚房（虛構品牌）｜回覆確認信即可聯絡我們。",
  },
};
