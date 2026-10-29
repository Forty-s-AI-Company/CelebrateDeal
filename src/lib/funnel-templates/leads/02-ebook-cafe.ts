import { CONVERSION_TEMPLATE_SAMPLE_MARK, conversionTemplateKit, type ConversionTemplateDefinition } from "../conversion/types";

/**
 * 名單 02：電子書封面名單頁（specs/leads-02-ebook-cafe.md）。
 * 奶茶底、宋體大標與焙茶棕按鈕：首屏左側是立體電子書封面、右側是承諾與表單卡；
 * 往下用數據列、三組章節卡、適合／不適合、作者與讀者回饋建立信任，最後 FAQ 旁邊再放一次表單。
 * 主題、作者與回饋都是虛構示意，商家套用後換成自己的電子書。
 */
const ART = "/funnel-illustrations/leads/02";
const BG = "#f7f1e8";
const BAND = "#efe4d3";
const CARD = "#fffaf2";
const INK = "#2a1d14";
const BODY = "#4a3a2e";
const PRIMARY = "#7a3e1d";
const LINE = "#e3d2b6";
const WHITE = "#ffffff";
const FOOTER_TEXT = "#e9dccb";

function build(prefix: string) {
  const { node, section, columns2, stack, headline, text, button, form } = conversionTemplateKit(prefix);
  const cta = { backgroundColor: PRIMARY, color: WHITE, borderRadius: 6, fontSize: 18, letterSpacing: 1 } as const;
  const fields = [
    { name: "name", label: "姓名", placeholder: "怎麼稱呼你", required: false, half: true },
    { name: "email", label: "Email", type: "email" as const, placeholder: "name@example.com", required: true, half: true },
  ];
  const note = "電子書會寄到這個信箱。之後每月一封開店實務信，可隨時退訂。";
  const formCard = { backgroundColor: CARD, borderColor: LINE, borderWidth: 1, borderRadius: 10, padding: 28, color: INK, textAlign: "left", shadow: "medium" } as const;
  const title = (id: string, eyebrow: string, value: string, subtitle = "", decoration: "line" | "none" = "line") => node(id, "section_title", {
    eyebrow, title: value, subtitle, level: "h2", decoration, eyebrowItalic: false, accentColor: PRIMARY,
  }, undefined, { color: INK });

  return [
    // 1. 首屏：左立體封面（平板與手機排在表單後面、縮小置中），右承諾＋表單卡。
    section("hero", [
      columns2("hero_split", [
        node("hero_cover", "image", { src: `${ART}/ebook-cover.svg`, alt: "電子書《開咖啡店前，先算這 12 筆錢》的立體封面" }, undefined, { imageWidth: 100, textAlign: "center" }, {
          tablet: { style: { imageWidth: 52 } },
          mobile: { style: { imageWidth: 78 } },
        }),
      ], [
        text("hero_eyebrow", "免費電子書｜42 頁 PDF", "eyebrow", { color: PRIMARY, letterSpacing: 3 }),
        headline("hero_title", "開咖啡店前，\n先算這 12 筆錢", "h1", { color: INK, fontSize: 52, lineHeight: 1.22, letterSpacing: 1 }, {
          tablet: { style: { fontSize: 44 } },
          mobile: { style: { fontSize: 30, lineHeight: 1.3, letterSpacing: 0 }, props: { text: "開咖啡店前，先算這 12 筆錢" } },
        }),
        text("hero_promise", "從押金、裝修到第一年的現金流，用一份清單避開最常見的開店成本陷阱。", "lead", { color: BODY }),
        form("hero_form", {
          fields,
          submitLabel: "免費索取電子書",
          submitStyle: cta,
          note,
          htmlId: "optin",
          style: formCard,
          mobile: { style: { padding: 18 } },
        }),
      ], { ratio: "5:7", stackOn: "tablet", mobileOrder: "reverse", gap: 64, align: "center" }),
    ], { background: BG, color: BODY, maxWidth: 1160, paddingY: 96, paddingYTablet: 56, paddingYMobile: 28, gap: 24 }),

    // 2. 數據列（範本示意）。
    section("numbers", [
      node("numbers_stats", "stats", { animate: true, framed: false, accentColor: PRIMARY, items: [
        { value: "42", suffix: "頁", label: `可列印的 PDF（${CONVERSION_TEMPLATE_SAMPLE_MARK}）` },
        { value: "12", suffix: "章", label: `每章一筆錢（${CONVERSION_TEMPLATE_SAMPLE_MARK}）` },
        { value: "3", suffix: "份", label: `附錄試算表（${CONVERSION_TEMPLATE_SAMPLE_MARK}）` },
      ] }, undefined, { color: INK }),
    ], { background: BAND, color: BODY, maxWidth: 960, paddingY: 56, paddingYTablet: 48, paddingYMobile: 36, gap: 12 }),

    // 3. 12 章拆成 3 組。
    section("chapters", [
      title("chapters_title", "INSIDE THE BOOK", "12 章，照開店的順序排好", "每一章只講一筆錢：要準備多少、什麼時候付、最常低估在哪裡。"),
      node("chapters_cards", "content_cards", { columns: 3, accentColor: PRIMARY, cardColor: CARD, cardTextColor: INK, items: [
        { src: `${ART}/part-before.svg`, alt: "店面與租約線稿", category: "第 1–4 章｜開店前", title: "租約、押金與頂讓金", text: "看懂租約裡的隱藏費用，算出簽約當天要準備的現金。" },
        { src: `${ART}/part-build.svg`, alt: "平面圖與吧台線稿", category: "第 5–8 章｜裝修", title: "裝修、設備與證照", text: "咖啡機、水電與消防，哪些不能省、哪些可以晚點買。" },
        { src: `${ART}/part-run.svg`, alt: "收銀機與現金流折線", category: "第 9–12 章｜營運", title: "人事、耗材與周轉金", text: "第一年最容易斷的是現金流，留多少周轉金才安心。" },
      ] }, undefined, { color: BODY, textAlign: "left" }),
    ], { background: BG, color: BODY, maxWidth: 1160, gap: 44 }),

    // 4. 適合／不適合。
    section("fit", [
      title("fit_title", "IS IT FOR YOU", "這本電子書寫給誰", "", "none"),
      node("fit_compare", "fit_compare", {
        fitTitle: "適合你，如果你…",
        fitItems: ["正在找店面，想知道要準備多少錢", "已經有咖啡專業，但沒有算過開店成本", "想先估算，再決定要不要辭職開店"],
        notFitTitle: "可能不適合，如果你…",
        notFitItems: ["已經營運一年以上，需要的是行銷策略", "想找加盟方案或品牌授權"],
        cardColor: CARD, fitColor: "#3f6b3a", notFitColor: PRIMARY,
      }, undefined, { color: INK, textAlign: "left" }),
    ], { background: BAND, color: BODY, maxWidth: 1000, gap: 40, align: "center" }),

    // 5. 作者。
    section("author", [
      node("author_card", "speaker_profiles", { layout: "featured", photoShape: "portrait", accentColor: PRIMARY, gradientFrom: PRIMARY, gradientTo: INK, items: [
        { photo: `${ART}/author.svg`, alt: "吳品瑄的照片（請替換為作者照片）", name: "吳品瑄", role: "餐飲開店顧問（虛構）", tags: "開店顧問,成本規劃,咖啡吧台", bio: "做過吧台手、店長，後來專門陪人開店（範本示意經歷）。看過太多店不是倒在咖啡不好喝，而是倒在第一年的現金流。這本電子書整理了我每次第一次見面都會問的 12 個問題。" },
      ] }, undefined, { color: INK }),
    ], { background: BG, color: BODY, maxWidth: 1040 }),

    // 6. 讀者回饋（範本示意）。
    section("reviews", [
      title("reviews_title", "READERS", "讀完的人怎麼說", "", "none"),
      node("reviews_wall", "testimonial_wall", { layout: "grid", columns: 3, autoplay: false, showRating: false, cardColor: CARD, cardTextColor: BODY, accentColor: PRIMARY, items: [
        { name: "讀者 A｜準備開店中", title: CONVERSION_TEMPLATE_SAMPLE_MARK, text: "原本只算了裝修和咖啡機，看完才發現押金和周轉金加起來比裝修還多。" },
        { name: "讀者 B｜咖啡師", title: CONVERSION_TEMPLATE_SAMPLE_MARK, text: "附錄試算表很好用，填完數字就知道自己還差多少，跟家人討論也比較有底。" },
        { name: "讀者 C｜二次創業", title: CONVERSION_TEMPLATE_SAMPLE_MARK, text: "第一次開店就是被頂讓金坑到。第 3 章如果早點看到，可以少走很多冤枉路。" },
      ] }, undefined, { textAlign: "left" }),
    ], { background: BAND, color: BODY, maxWidth: 1160, gap: 40, align: "center" }),

    // 7. FAQ（左）＋第二次表單（右）。
    section("again", [
      columns2("again_split", [
        title("again_faq_title", "QUESTIONS", "索取前常見的問題"),
        node("again_faq", "faq", { items: [
          { question: "電子書真的免費嗎？", answer: "免費。留下 Email 後會收到下載連結，不需要信用卡，也不會自動扣款。" },
          { question: "試算表要用什麼軟體開？", answer: "提供 Google 試算表與 Excel 兩種格式，手機也能看，建議用電腦填寫。" },
          { question: "我還沒找到店面，也適合看嗎？", answer: "很適合。先把 12 筆錢算過一次，找店面時就知道哪些條件可以談。" },
          { question: "之後會一直收到推銷信嗎？", answer: "每月最多一封開店實務信，每封信底部都有退訂連結。" },
        ] }, undefined, { color: BODY, textAlign: "left" }),
      ],
        stack("again_panel", [
          text("again_eyebrow", "免費電子書", "eyebrow", { color: PRIMARY, letterSpacing: 3 }),
          headline("again_title", "簽約之前，先把帳算一次", "h2", { color: INK, fontSize: 30, lineHeight: 1.4 }, { mobile: { style: { fontSize: 24 } } }),
          text("again_text", "42 頁 PDF＋3 份試算表，一分鐘內寄到你的信箱。", undefined, { color: BODY }),
          form("again_form", {
            fields: fields.map((field) => ({ ...field, half: false })),
            submitLabel: "免費索取電子書",
            submitStyle: cta,
            note,
            style: { color: INK, textAlign: "left" },
          }),
        ], 16, { backgroundColor: CARD, borderColor: LINE, borderWidth: 1, borderRadius: 10, padding: 32, textAlign: "left", shadow: "medium" }, { mobile: { style: { padding: 16 } } }),
        { ratio: "7:5", stackOn: "tablet", gap: 56, align: "start" }),
    ], { background: BG, color: BODY, maxWidth: 1160, gap: 24 }),

    // 8. 頁尾。
    section("footer", [
      text("footer_text", "© 品瑄開店研究室（虛構）｜我們不會把你的 Email 提供給第三方。", "small", { color: FOOTER_TEXT }),
      button("footer_top", "回到頂端索取電子書", "#optin", { backgroundColor: "transparent", color: WHITE, borderColor: FOOTER_TEXT, borderWidth: 1, borderRadius: 6, padding: "10px 20px", width: "fit-content", margin: "0 auto", fontSize: 15 }),
    ], { background: INK, color: FOOTER_TEXT, maxWidth: 960, paddingY: 44, paddingYTablet: 36, paddingYMobile: 28, gap: 14, align: "center" }),
  ];
}

export const template: ConversionTemplateDefinition = {
  id: "leads-ebook-cafe",
  kind: "leads",
  number: 2,
  name: "電子書封面名單頁",
  description: "立體電子書封面＋章節拆解：數據列、三組章節卡、適合對象、作者與讀者回饋，FAQ 旁再放一次表單。",
  category: "電子書／白皮書",
  purposes: ["leads"],
  styles: ["warm"],
  preview: { eyebrow: "名單頁", headline: "開咖啡店前，先算這 12 筆錢", summary: "電子書立體封面＋章節拆解", palette: [BG, PRIMARY, INK], sectionCount: 8 },
  theme: { typography: { headingFont: "serif-tc", bodyFont: "sans-tc", bodySize: 18, bodyLineHeight: 1.8, textColor: BODY, headingColor: INK, linkColor: PRIMARY }, background: { color: BG } },
  settings: { scrollReveal: "rise", stickyCta: { enabled: true, label: "免費索取電子書", target: "optin", showDate: false, devices: "mobile_tablet", buttonColor: PRIMARY, buttonTextColor: WHITE, backgroundColor: CARD } },
  build,
  thankYou: {
    name: "電子書・名單感謝頁",
    description: "交付電子書、提醒收信，並推薦開店前一對一諮詢。",
    tokens: { background: BG, surface: CARD, ink: INK, body: BODY, accent: PRIMARY, onAccent: WHITE, line: LINE, footerBackground: INK, footerText: FOOTER_TEXT, radius: 6 },
    eyebrow: "已收到你的 Email",
    title: "去信箱打開你的開店預算書",
    intro: "一分鐘內會收到標題為「開咖啡店前，先算這 12 筆錢」的信。沒看到的話，請檢查促銷內容或垃圾郵件匣。",
    card: { title: "《開咖啡店前，先算這 12 筆錢》", text: "42 頁 PDF＋3 份附錄試算表（Google 試算表與 Excel）。建議存到電腦，邊看邊填。", buttonLabel: "下載電子書", buttonHref: "#ty-steps" },
    steps: [
      { icon: "message", title: "打開確認信", text: "把寄件者加入通訊錄，之後的開店實務信才不會被分到促銷匣。" },
      { icon: "book", title: "先看第 3 章", text: "押金與頂讓金是最常被低估的一筆，先看這章最有感。" },
      { icon: "chart", title: "用試算表算一次", text: "把你看中的店面數字填進附錄試算表，看看周轉金夠不夠。" },
    ],
    next: { eyebrow: "想有人幫你看數字？", title: "開店前一對一諮詢", text: "60 分鐘線上會談，一起看你的店面條件與預算表，帶走一份調整過的開店預算。", buttonLabel: "了解諮詢方式", buttonHref: "#ty-steps" },
    footer: "© 品瑄開店研究室（虛構）｜如需取消訂閱，可點擊信件底部的退訂連結。",
  },
};
