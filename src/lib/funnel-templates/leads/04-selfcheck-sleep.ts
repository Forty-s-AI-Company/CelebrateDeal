import { conversionTemplateKit, type ConversionTemplateDefinition } from "../conversion/types";

/**
 * 名單 04：自我檢測報告名單頁（specs/leads-04-selfcheck-sleep.md）。
 * 夜空深藍首屏（文楷標題、月光黃點綴）接米綠內容區：首屏左承諾＋表單、右檢測表預覽；
 * 往下是 4 種睡眠卡關型、檢測表會告訴你什麼、衛教聲明、講師，最後回到夜空色再放一次表單。
 * 檢測表是可下載的紙本自評，不收集答案、不做診斷；講師為虛構示意。
 */
const ART = "/funnel-illustrations/leads/04";
const NIGHT = "#18233f";
const NIGHT_BODY = "#d3dbec";
const MOON = "#f2d27a";
const BG = "#f4f6f1";
const CARD = "#ffffff";
const INK = "#1b2a2a";
const BODY = "#3c4a48";
const PRIMARY = "#2f6b5b";
const LINE = "#dfe5dc";
const NIGHT_FOOTER = "#111a30";

function build(prefix: string) {
  const { node, section, columns2, headline, text, button, form } = conversionTemplateKit(prefix);
  const cta = { backgroundColor: PRIMARY, color: CARD, borderRadius: 300, fontSize: 18, letterSpacing: 1 } as const;
  const fields = [{ name: "email", label: "Email", type: "email" as const, placeholder: "name@example.com", required: true, helpText: "檢測表與對照建議會寄到這個信箱" }];
  const note = "只寄檢測表與每週一封睡眠小練習，可隨時退訂。";
  const formCard = { backgroundColor: CARD, borderRadius: 18, padding: 26, color: INK, textAlign: "left", shadow: "strong" } as const;
  const title = (id: string, eyebrow: string, value: string, subtitle = "") => node(id, "section_title", {
    eyebrow, title: value, subtitle, level: "h2", decoration: "none", eyebrowItalic: false, accentColor: PRIMARY,
  }, undefined, { color: INK });

  return [
    // 1. 首屏：夜空深藍，左 H1＋說明＋表單（手機在預覽之前），右檢測表預覽。
    section("hero", [
      columns2("hero_split", [
        text("hero_eyebrow", "免費自我檢測｜約 3 分鐘", "eyebrow", { color: MOON, letterSpacing: 3 }),
        headline("hero_title", "你是哪一種睡不好？\n10 題找出你的睡眠卡關型", "h1", { color: CARD, fontSize: 50, lineHeight: 1.3 }, {
          tablet: { style: { fontSize: 42 } },
          mobile: { style: { fontSize: 29, lineHeight: 1.38 }, props: { text: "你是哪一種睡不好？10 題找出你的睡眠卡關型" } },
        }),
        text("hero_promise", "一張可以印出來的檢測表：花 3 分鐘勾選，對照 4 種常見的卡關型，找到今晚就能先調整的一件小事。", "lead", { color: NIGHT_BODY }),
        form("hero_form", {
          fields,
          submitLabel: "寄給我檢測表",
          submitStyle: cta,
          note,
          htmlId: "optin",
          style: { ...formCard, width: "min(100%, 520px)" },
          mobile: { style: { padding: 18 } },
        }),
      ], [
        node("hero_preview", "image", { src: `${ART}/night-check.svg`, alt: "睡眠習慣自我檢測表示意：月亮夜空與三道勾選題目" }, undefined, { imageWidth: 100, textAlign: "center" }, {
          tablet: { style: { imageWidth: 70 } },
          mobile: { style: { imageWidth: 92 } },
        }),
      ], { ratio: "7:5", stackOn: "tablet", gap: 56, align: "center" }),
    ], { background: NIGHT, color: NIGHT_BODY, maxWidth: 1180, paddingY: 96, paddingYTablet: 64, paddingYMobile: 28, gap: 24 }),

    // 2. 4 種睡眠卡關型。
    section("types", [
      title("types_title", "4 TYPES", "睡不好，通常卡在這 4 個地方", "檢測表會依你的勾選，對照出最接近的一型（可能不只一型）。"),
      node("types_cards", "content_cards", { columns: 4, accentColor: PRIMARY, cardColor: CARD, cardTextColor: INK, items: [
        { src: `${ART}/type-mind.svg`, alt: "頭頂有思緒線團的睡眠插圖", category: "A 型", title: "腦袋停不下來", text: "身體很累，躺下後卻開始想明天的事。" },
        { src: `${ART}/type-drift.svg`, alt: "時鐘指針一天比一天晚的插圖", category: "B 型", title: "作息一直往後飄", text: "週末晚睡晚起，週一早上特別難熬。" },
        { src: `${ART}/type-light.svg`, alt: "半夜醒來兩次的睡眠曲線插圖", category: "C 型", title: "淺眠容易醒", text: "有點聲音就醒，醒來後很難再睡著。" },
        { src: `${ART}/type-screen.svg`, alt: "棉被裡亮著手機的插圖", category: "D 型", title: "睡前停不下手機", text: "本來只想看一下，回神已經過了一小時。" },
      ] }, undefined, { color: BODY, textAlign: "left" }),
    ], { background: BG, color: BODY, maxWidth: 1200, gap: 44 }),

    // 3. 檢測表會告訴你什麼。
    section("learn", [
      title("learn_title", "WHAT YOU GET", "做完檢測表，你會知道"),
      node("learn_list", "icon_list", { layout: "grid", columns: 3, numbered: false, accentColor: PRIMARY, items: [
        { icon: "compass", title: "你最接近哪一型", text: "10 題各有對應的型別，加總後就知道主要卡在哪裡。" },
        { icon: "leaf", title: "今晚先改的一件事", text: "每一型都附一個不用花錢、今晚就能試的小調整。" },
        { icon: "clock", title: "兩週後再測一次", text: "表格留了第二次的欄位，比較看看自己有沒有變化。" },
      ] }, undefined, { color: BODY, textAlign: "left" }),
    ], { background: CARD, color: BODY, maxWidth: 1080, gap: 44, align: "center" }),

    // 4. 衛教聲明。
    section("notice", [
      node("notice_callout", "callout", { tone: "compliance", title: "衛教聲明", text: "本檢測為一般衛教，不是醫療診斷，也不能取代專業評估。\n\n長期失眠、白天嗜睡影響生活，或有打呼、呼吸中止等情形，請就醫諮詢。" }, undefined, { color: INK, textAlign: "left" }),
    ], { background: CARD, color: BODY, maxWidth: 800, paddingY: 0, paddingYTablet: 0, paddingYMobile: 8, gap: 16 }),

    // 5. 講師。
    section("speaker", [
      node("speaker_card", "speaker_profiles", { layout: "featured", size: "small", accentColor: PRIMARY, gradientFrom: PRIMARY, gradientTo: NIGHT, items: [
        { name: "許靜怡", role: "睡眠衛教講師（虛構）", tags: "睡眠衛教,作息調整,放鬆練習", bio: "在社區與企業帶睡眠衛教課多年（範本示意經歷）。我發現多數人不是不知道要早睡，而是不知道自己卡在哪。這張檢測表是我每堂課的第一份作業。" },
      ] }, undefined, { color: BODY }),
    ], { background: CARD, color: BODY, maxWidth: 680, gap: 16, align: "center" }),

    // 6. 第二次表單（回到夜空色）。
    section("again", [
      text("again_eyebrow", "今晚就能開始", "eyebrow", { color: MOON, letterSpacing: 3 }),
      headline("again_title", "睡前花 3 分鐘，認識你的睡眠", "h2", { color: CARD, fontSize: 36, lineHeight: 1.4 }, { mobile: { style: { fontSize: 25 } } }),
      text("again_text", "留下 Email，檢測表與 4 型對照建議會一起寄給你。", undefined, { color: NIGHT_BODY }),
      form("again_form", {
        fields,
        submitLabel: "寄給我檢測表",
        submitStyle: cta,
        note,
        style: { ...formCard, width: "min(100%, 500px)", margin: "0 auto" },
        mobile: { style: { padding: 18 } },
      }),
    ], { background: NIGHT, color: NIGHT_BODY, maxWidth: 680, gap: 20, align: "center", paddingY: 104, paddingYMobile: 56 }),

    // 7. 頁尾。
    section("footer", [
      text("footer_text", "© 靜怡的睡眠練習室（虛構）｜我們不會把你的 Email 提供給第三方。", "small", { color: NIGHT_BODY }),
      button("footer_top", "回到頂端", "#optin", { backgroundColor: "transparent", color: CARD, borderColor: NIGHT_BODY, borderWidth: 1, borderRadius: 300, padding: "10px 22px", width: "fit-content", margin: "0 auto", fontSize: 15 }),
    ], { background: NIGHT_FOOTER, color: NIGHT_BODY, maxWidth: 960, paddingY: 40, paddingYTablet: 36, paddingYMobile: 28, gap: 12, align: "center" }),
  ];
}

export const template: ConversionTemplateDefinition = {
  id: "leads-selfcheck-sleep",
  kind: "leads",
  number: 4,
  name: "自我檢測報告名單頁",
  description: "夜空首屏＋檢測表預覽：4 種卡關型插圖、檢測結果說明、衛教聲明與講師，收尾再放一次表單。",
  category: "測驗／自我檢測",
  purposes: ["leads"],
  styles: ["natural"],
  preview: { eyebrow: "名單頁", headline: "你是哪一種睡不好？10 題找出你的睡眠卡關型", summary: "夜空首屏＋可下載自我檢測表", palette: [NIGHT, MOON, BG], sectionCount: 7 },
  theme: { typography: { headingFont: "wenkai-tc", bodyFont: "sans-tc", bodySize: 18, bodyLineHeight: 1.8, textColor: BODY, headingColor: INK, linkColor: PRIMARY }, background: { color: BG } },
  settings: { scrollReveal: "fade", stickyCta: { enabled: true, label: "寄給我檢測表", target: "optin", showDate: false, devices: "mobile_tablet", buttonColor: PRIMARY, buttonTextColor: CARD, backgroundColor: NIGHT } },
  build,
  thankYou: {
    name: "睡眠自我檢測・名單感謝頁",
    description: "交付檢測表、提醒收信，並推薦 21 天睡眠練習課。",
    tokens: { background: BG, surface: CARD, ink: INK, body: BODY, accent: PRIMARY, onAccent: CARD, line: LINE, footerBackground: NIGHT, footerText: NIGHT_BODY, radius: 24 },
    eyebrow: "檢測表已寄出",
    title: "今晚睡前，花 3 分鐘做一次",
    intro: "一分鐘內會收到標題為「你的睡眠習慣自我檢測表」的信。沒看到的話，請檢查促銷內容或垃圾郵件匣。",
    card: { title: "睡眠習慣自我檢測表", text: "10 題勾選表＋4 種卡關型對照建議（PDF，可列印也可在手機上填）。本檢測為一般衛教，不是醫療診斷。", buttonLabel: "下載檢測表", buttonHref: "#ty-steps" },
    steps: [
      { icon: "message", title: "打開信件", text: "把寄件者加入通訊錄，之後的睡眠小練習才不會被分到促銷匣。" },
      { icon: "clock", title: "今晚做檢測", text: "睡前 30 分鐘勾選 10 題，照實填就好，沒有標準答案。" },
      { icon: "leaf", title: "對照建議", text: "找到你最接近的一型，先試一個小調整，兩週後再測一次。" },
    ],
    next: { eyebrow: "想有人陪你練習？", title: "21 天睡眠練習課", text: "每天一段 10 分鐘的音檔與練習單，從作息、睡前習慣到放鬆練習，一步一步調整。課程為衛教內容，不取代醫療。", buttonLabel: "了解練習課", buttonHref: "#ty-steps" },
    footer: "© 靜怡的睡眠練習室（虛構）｜如需取消訂閱，可點擊信件底部的退訂連結。",
  },
};
