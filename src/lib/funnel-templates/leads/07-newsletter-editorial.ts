import { CONVERSION_TEMPLATE_SAMPLE_MARK, conversionTemplateKit, type ConversionTemplateDefinition } from "../conversion/types";

/**
 * 名單 07：電子報訂閱頁（specs/leads-07-newsletter-editorial.md）。
 * 紙張底、宋體報頭：首屏像一份週報的刊頭（細線、報名大字、發刊資訊），表單就在刊頭下方；
 * 往下是每期內容、過往三期（巷弄線稿）、主編的話、讀者回饋，最後在深綠底收第二次訂閱。
 * 電子報「週日慢讀」與主編何以寧為虛構示意。
 */
const ART = "/funnel-illustrations/leads/07";
const PAPER = "#f6f2ea";
const CARD = "#fffdf8";
const INK = "#1f1d1a";
const BODY = "#45413a";
const MUTED = "#5f5a51";
const GREEN = "#2f5d46";
const GREEN_DEEP = "#24483a";
const RULE = "#d9d1c2";
const ON_GREEN = "#e9efe9";

function build(prefix: string) {
  const { node, section, headline, text, button, form } = conversionTemplateKit(prefix);
  const cta = { backgroundColor: GREEN, color: "#ffffff", borderRadius: 0, fontSize: 18, letterSpacing: 2 } as const;
  const fields = [{ name: "email", label: "Email", type: "email" as const, placeholder: "name@example.com", required: true }];
  const note = "每週一封，免費。不寄廣告信，隨時可以一鍵退訂。";
  // 報頭細線：空的 content_box 在公開頁會顯示佔位字，所以用拉伸的 SVG 細線。
  const rule = (id: string, kind: "double" | "thin") => node(id, "image", { src: `${ART}/rule-${kind}.svg`, alt: "" }, undefined, { imageWidth: 100 });
  const kicker = (id: string, value: string) => text(id, value, "eyebrow", { color: GREEN, letterSpacing: 4 });
  const h2 = (id: string, value: string) => headline(id, value, "h2", { color: INK, fontSize: 38, lineHeight: 1.4 }, { tablet: { style: { fontSize: 32 } }, mobile: { style: { fontSize: 26 } } });

  return [
    // 1. 首屏：刊頭。細線框起報名大字，發刊資訊與表單緊接在下方。
    section("hero", [
      text("hero_kicker", "城市散步電子報｜每週日早上寄出・免費", "eyebrow", { color: GREEN, letterSpacing: 3 }),
      rule("hero_rule_top", "double"),
      headline("hero_title", "週日慢讀", "h1", { color: INK, fontSize: 128, lineHeight: 1.1, letterSpacing: 16 }, {
        tablet: { style: { fontSize: 100, letterSpacing: 12 } },
        mobile: { style: { fontSize: 60, letterSpacing: 6 } },
      }),
      rule("hero_rule_bottom", "thin"),
      text("hero_meta", "每週日 07:00 寄出　｜　約 8 分鐘讀完　｜　一次一條巷子", "small", { color: MUTED, letterSpacing: 1 }, { mobile: { props: { text: "每週日 07:00｜約 8 分鐘讀完" } } }),
      headline("hero_subtitle", "一封帶你走進城市巷弄的信", "h2", { color: INK, fontSize: 34, lineHeight: 1.45, margin: "16px 0 0" }, { tablet: { style: { fontSize: 30 } }, mobile: { style: { fontSize: 22, margin: "4px 0 0" } } }),
      text("hero_lead", "一條散步路線、一家老店的故事、一張手繪地圖。週日早上泡杯咖啡，慢慢讀。", "lead", { color: BODY, width: "min(100%, 600px)", margin: "0 auto" }, { mobile: { visible: false } }),
      form("hero_form", {
        fields,
        submitLabel: "免費訂閱",
        submitStyle: cta,
        note,
        htmlId: "optin",
        style: { backgroundColor: CARD, borderColor: RULE, borderWidth: 1, borderRadius: 0, padding: 28, color: INK, textAlign: "left", width: "min(100%, 520px)", margin: "8px auto 0" },
        mobile: { style: { padding: 18 } },
      }),
    ], { background: PAPER, color: BODY, maxWidth: 960, paddingY: 72, paddingYTablet: 56, paddingYMobile: 24, gap: 20, align: "center" }),

    // 2. 每期你會收到。
    section("inside", [
      kicker("inside_kicker", "IN EVERY ISSUE"),
      h2("inside_title", "每一期，你會收到三樣東西"),
      node("inside_list", "icon_list", { layout: "grid", columns: 3, numbered: true, accentColor: GREEN, items: [
        { icon: "compass", title: "一條散步路線", text: "30 到 60 分鐘走得完，附手繪地圖與最適合出發的時段。" },
        { icon: "book", title: "一段巷弄故事", text: "老店、老屋與住在那裡的人，寫下地圖上看不到的細節。" },
        { icon: "leaf", title: "一份週末小清單", text: "市集、展覽與值得繞過去的小店，挑三個就好。" },
      ] }, undefined, { color: BODY, textAlign: "left" }),
    ], { background: CARD, color: BODY, maxWidth: 1080, gap: 24, align: "center" }),

    // 3. 過往三期。
    section("issues", [
      kicker("issues_kicker", "BACK ISSUES"),
      h2("issues_title", "最近三期，先讀讀看"),
      node("issues_cards", "content_cards", { columns: 3, accentColor: GREEN, cardColor: CARD, cardTextColor: INK, items: [
        { src: `${ART}/issue-alley.svg`, alt: "窄巷線稿：鐵窗、盆栽與停在門口的機車", category: "第 41 期｜散步路線", title: "鐵窗花與盆栽的午後巷子", text: "從捷運站走五分鐘，轉進一條只容兩台機車錯身的巷子。", href: "#optin", linkLabel: "訂閱，收下一期" },
        { src: `${ART}/issue-store.svg`, alt: "老雜貨店線稿：條紋遮雨棚、木架與門口的貓", category: "第 42 期｜老店故事", title: "開了四十年的雜貨店", text: "老闆記得每位熟客的口味，貓咪負責顧門口。", href: "#optin", linkLabel: "訂閱，收下一期" },
        { src: `${ART}/issue-banyan.svg`, alt: "廟口線稿：大榕樹、長椅與腳踏車", category: "第 43 期｜週末清單", title: "廟口大榕樹下的週末", text: "樹下的長椅、隔壁的豆花攤，和一張手繪散步地圖。", href: "#optin", linkLabel: "訂閱，收下一期" },
      ] }, undefined, { color: BODY, textAlign: "left" }),
    ], { background: PAPER, color: BODY, maxWidth: 1160, gap: 24, align: "center" }),

    // 4. 主編的話。
    section("editor", [
      kicker("editor_kicker", "FROM THE EDITOR"),
      headline("editor_quote", "「認識一座城市最好的方法，\n是故意走錯一條路。」", "h3", { color: INK, fontSize: 34, lineHeight: 1.6 }, {
        tablet: { style: { fontSize: 28 } },
        mobile: { style: { fontSize: 21 } },
      }),
      node("editor_card", "speaker_profiles", { layout: "featured", photoShape: "portrait", accentColor: GREEN, items: [
        { photo: `${ART}/editor.svg`, alt: "主編何以寧的插畫肖像（請替換為你的照片）", name: "何以寧", role: "《週日慢讀》主編（虛構人物）", tags: "城市散步,地方誌,手繪地圖", bio: "在報社跑了多年地方新聞，後來發現自己最喜歡的，是採訪結束後繞路走回家的那段時間。這份電子報把那些路寫下來，寄給也喜歡慢慢走的你。" },
      ] }, undefined, { color: INK, textAlign: "left" }),
    ], { background: CARD, color: BODY, maxWidth: 960, gap: 32, align: "center" }),

    // 5. 讀者回饋（範本示意）。
    section("readers", [
      kicker("readers_kicker", "LETTERS"),
      h2("readers_title", "讀者回信"),
      node("readers_wall", "testimonial_wall", { layout: "grid", columns: 3, autoplay: false, showRating: false, accentColor: GREEN, cardColor: CARD, cardTextColor: INK, items: [
        { name: "讀者 A｜上班族", title: CONVERSION_TEMPLATE_SAMPLE_MARK, text: "週日早上最期待的一封信。照著路線走，才發現住了五年的城市還有好多沒去過的巷子。" },
        { name: "讀者 B｜退休老師", title: CONVERSION_TEMPLATE_SAMPLE_MARK, text: "文字很溫柔，像有人陪著散步。手繪地圖我都印出來，貼在冰箱上。" },
        { name: "讀者 C｜咖啡店老闆", title: CONVERSION_TEMPLATE_SAMPLE_MARK, text: "常有客人拿著電子報的地圖走進來。原來有人用這麼細的眼光看我們這條街。" },
      ] }, undefined, { textAlign: "left" }),
    ], { background: PAPER, color: BODY, maxWidth: 1160, gap: 24, align: "center" }),

    // 6. 第二次表單：深綠底。
    section("again", [
      text("again_kicker", "SUBSCRIBE", "eyebrow", { color: ON_GREEN, letterSpacing: 4 }),
      headline("again_title", "這個週日，\n一起慢慢走", "h2", { color: "#ffffff", fontSize: 44, lineHeight: 1.35 }, { tablet: { style: { fontSize: 36 } }, mobile: { style: { fontSize: 28 }, props: { text: "這個週日，一起慢慢走" } } }),
      text("again_text", "留下 Email，下一期週日早上寄到你的信箱。", undefined, { color: ON_GREEN }),
      form("again_form", {
        fields,
        submitLabel: "免費訂閱",
        submitStyle: cta,
        note,
        style: { backgroundColor: CARD, borderRadius: 0, padding: 28, color: INK, textAlign: "left", width: "min(100%, 480px)", margin: "0 auto", shadow: "medium" },
        mobile: { style: { padding: 18 } },
      }),
    ], { background: GREEN_DEEP, color: ON_GREEN, maxWidth: 640, paddingY: 104, paddingYTablet: 80, paddingYMobile: 56, gap: 20, align: "center" }),

    // 7. 頁尾。
    section("footer", [
      text("footer_mark", "週日慢讀", undefined, { color: INK, fontSize: 22, letterSpacing: 6 }),
      text("footer_text", "© 週日慢讀｜城市散步電子報（虛構示意）｜我們不會把你的 Email 提供給第三方。", "small", { color: MUTED }),
      button("footer_top", "回到頂端", "#optin", { backgroundColor: "transparent", color: INK, borderColor: RULE, borderWidth: 1, borderRadius: 0, padding: "10px 20px", width: "fit-content", margin: "0 auto", fontSize: 15 }),
    ], { background: PAPER, color: MUTED, maxWidth: 960, paddingY: 48, paddingYTablet: 40, paddingYMobile: 32, gap: 12, align: "center" }),
  ];
}

export const template: ConversionTemplateDefinition = {
  id: "leads-newsletter-editorial",
  kind: "leads",
  number: 7,
  name: "編輯感電子報訂閱頁",
  description: "紙張底與宋體刊頭的電子報訂閱頁：報名大字、發刊資訊、過往三期與主編的話，像一份會寄到信箱的週報。",
  category: "電子報訂閱",
  purposes: ["leads"],
  styles: ["natural"],
  preview: { eyebrow: "名單頁", headline: "週日慢讀：一封帶你走進城市巷弄的信", summary: "刊頭首屏＋過往三期", palette: [PAPER, GREEN, INK], sectionCount: 7 },
  theme: { typography: { headingFont: "serif-tc", bodyFont: "sans-tc", bodySize: 17, bodyLineHeight: 1.85, textColor: BODY, headingColor: INK, linkColor: GREEN }, background: { color: PAPER } },
  settings: { scrollReveal: "fade", stickyCta: { enabled: true, label: "免費訂閱電子報", target: "optin", showDate: false, devices: "mobile_tablet", buttonColor: GREEN, buttonTextColor: "#ffffff", backgroundColor: PAPER } },
  build,
  thankYou: {
    name: "編輯感電子報・名單感謝頁",
    description: "提醒點擊確認連結（雙重確認），並請讀者加入通訊錄、回信說說自己住哪裡。",
    tokens: { background: PAPER, surface: CARD, ink: INK, body: BODY, accent: GREEN, onAccent: "#ffffff", line: RULE, footerBackground: INK, footerText: "#e6dfd2", radius: 0 },
    eyebrow: "還差一步",
    title: "確認信已寄出，請點信中的連結",
    intro: "為了確定是你本人訂閱，我們寄了一封確認信。點擊信裡的「確認訂閱」，下個週日早上就會收到第一期。沒看到的話，請看看促銷內容或垃圾郵件匣。",
    card: { title: "《週日慢讀》訂閱確認", text: "確認後，每週日 07:00 寄出一封：一條散步路線、一段巷弄故事與一份週末小清單。", buttonLabel: "接下來怎麼做", buttonHref: "#ty-steps" },
    steps: [
      { icon: "message", title: "收信確認", text: "打開確認信，點擊「確認訂閱」。沒有確認的話，我們不會寄出任何電子報。" },
      { icon: "users", title: "加入通訊錄", text: "把寄件者加入通訊錄，週日的信就不會被分到促銷或垃圾郵件匣。" },
      { icon: "compass", title: "回信告訴我們你住哪", text: "直接回覆確認信，告訴我們你住哪個城市，也許下一期就寫你家附近的巷子。" },
    ],
    footer: "© 週日慢讀｜城市散步電子報（虛構示意）｜每封信底部都可以一鍵退訂。",
  },
};
