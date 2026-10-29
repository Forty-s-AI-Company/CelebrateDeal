import { conversionTemplateKit, type ConversionTemplateDefinition } from "../conversion/types";

/**
 * 名單 01：極簡清單索取頁（specs/leads-01-checklist-minimal.md）。
 * 米白底、墨黑大標與焦橙按鈕；首屏左文案＋表單、右疊放紙卡的清單內頁預覽，
 * 往下只講「你會拿到什麼」與四週節奏，沒有導覽列、只有一個動作。
 */
const ART = "/funnel-illustrations/leads/01";
const BG = "#fafaf7";
const CARD = "#ffffff";
const INK = "#14181f";
const BODY = "#3b4250";
const MUTED = "#5b6270";
const PRIMARY = "#c2410c";
const TINT = "#fdf1ea";
const LINE = "#e6e3dc";

function build(prefix: string) {
  const { node, section, columns2, stack, headline, text, button, form } = conversionTemplateKit(prefix);
  const cta = { backgroundColor: PRIMARY, color: CARD, borderRadius: 10, fontSize: 18 } as const;
  const fields = [{ name: "email", label: "Email", type: "email" as const, placeholder: "name@example.com", required: true }];
  const note = "只寄這份清單與每月一封小店經營信，可隨時退訂。";

  return [
    // 1. 首屏：資源名稱即標題，表單緊接在承諾後面；右側是清單內頁預覽。
    section("hero", [
      columns2("hero_split", [
        text("hero_eyebrow", "免費下載｜PDF＋可編輯試算表", "eyebrow", { color: PRIMARY }),
        headline("hero_title", "Instagram\n30 天貼文企劃清單", "h1", { color: INK, fontSize: 56, lineHeight: 1.18 }, {
          tablet: { style: { fontSize: 46 } },
          mobile: { style: { fontSize: 32, lineHeight: 1.25 }, props: { text: "Instagram 30 天貼文企劃清單" } },
        }),
        text("hero_promise", "每天 10 分鐘，照著清單發。一個月內不用再煩惱「今天要 po 什麼」。", "lead", { color: BODY }),
        form("hero_form", {
          fields,
          submitLabel: "寄給我清單",
          submitStyle: cta,
          note,
          htmlId: "optin",
          style: { backgroundColor: CARD, borderColor: LINE, borderWidth: 1, borderRadius: 14, padding: 24, color: INK, shadow: "soft" },
          mobile: { style: { padding: 18 } },
        }),
      ], [
        node("hero_preview", "image", { src: `${ART}/checklist-preview.svg`, alt: "清單內頁示意：第一週每天的貼文主題與勾選框" }, undefined, { imageWidth: 100 }),
      ], { ratio: "7:5", stackOn: "tablet", gap: 56, align: "center" }),
    ], { background: BG, color: BODY, maxWidth: 1120, paddingY: 88, paddingYTablet: 56, paddingYMobile: 28, gap: 24 }),

    // 2. 你會拿到。
    section("gets", [
      headline("gets_title", "下載後，你會拿到", "h2", { color: INK, fontSize: 34 }, { mobile: { style: { fontSize: 25 } } }),
      node("gets_list", "icon_list", { layout: "grid", columns: 3, numbered: false, accentColor: PRIMARY, items: [
        { icon: "book", title: "30 個貼文主題", text: "依週次排好，從自我介紹、商品故事到客人常見問題，照順序發就好。" },
        { icon: "message", title: "5 種文案開頭", text: "卡住時直接套用：提問、數字、反差、清單、小故事。" },
        { icon: "chart", title: "每週檢查表", text: "只看觸及、收藏與私訊三個數字，知道哪種貼文值得多發。" },
      ] }, undefined, { color: BODY, textAlign: "left" }),
    ], { background: CARD, color: BODY, maxWidth: 1080, gap: 40, align: "center" }),

    // 3. 四週節奏。
    section("weeks", [
      text("weeks_eyebrow", "清單裡有什麼", "eyebrow", { color: PRIMARY }),
      headline("weeks_title", "四週，一週一個重點", "h2", { color: INK, fontSize: 34 }, { mobile: { style: { fontSize: 25 } } }),
      stack("weeks_panel", [
        node("weeks_list", "icon_list", { layout: "grid", columns: 2, numbered: true, accentColor: PRIMARY, items: [
          { icon: "users", title: "第 1 週：讓人認識你", text: "自我介紹、開店原因、工作日常，先建立「這是誰」。" },
          { icon: "heart", title: "第 2 週：讓人喜歡商品", text: "商品背後的故事、製作過程與使用情境。" },
          { icon: "message", title: "第 3 週：讓人開口問", text: "限時動態互動題與常見問題，把觀眾變成會私訊的人。" },
          { icon: "target", title: "第 4 週：讓人願意買", text: "客人回饋、搭配建議與一則清楚的購買說明。" },
        ] }, undefined, { color: BODY, textAlign: "left" }),
      ], 0, { backgroundColor: CARD, borderColor: LINE, borderWidth: 1, borderRadius: 16, padding: 40 }, { mobile: { style: { padding: 22 } } }),
    ], { background: BG, color: BODY, maxWidth: 960, gap: 20, align: "center" }),

    // 4. 作者一句話。
    section("author", [
      node("author_card", "speaker_profiles", { layout: "featured", size: "small", accentColor: PRIMARY, gradientFrom: PRIMARY, gradientTo: INK, items: [
        { name: "林小禾", role: "小店社群顧問（虛構）", bio: "我陪過許多手作與餐飲小店經營 Instagram。這份清單是我每次第一堂課都會給的功課：不用靈感，照著做就有內容。", tags: "小店經營,社群企劃" },
      ] }, undefined, { color: BODY }),
    ], { background: CARD, color: BODY, maxWidth: 640, gap: 16, align: "center" }),

    // 5. 第二次表單。
    section("again", [
      headline("again_title", "明天就從第 1 天開始", "h2", { color: INK, fontSize: 34 }, { mobile: { style: { fontSize: 25 } } }),
      text("again_text", "留下 Email，清單和試算表會在一分鐘內寄到你的信箱。", undefined, { color: BODY }),
      form("again_form", {
        fields,
        submitLabel: "寄給我清單",
        submitStyle: cta,
        note,
        style: { backgroundColor: CARD, borderColor: LINE, borderWidth: 1, borderRadius: 14, padding: 28, color: INK, textAlign: "left", width: "min(100%, 480px)", margin: "0 auto", shadow: "soft" },
        mobile: { style: { padding: 18 } },
      }),
    ], { background: TINT, color: BODY, maxWidth: 640, gap: 20, align: "center" }),

    // 6. 頁尾。
    section("footer", [
      text("footer_text", "© 小禾的小店社群筆記｜我們不會把你的 Email 提供給第三方。", "small", { color: MUTED }),
      button("footer_top", "回到頂端", "#optin", { backgroundColor: "transparent", color: INK, borderColor: LINE, borderWidth: 1, borderRadius: 10, padding: "10px 20px", width: "fit-content", margin: "0 auto", fontSize: 15 }),
    ], { background: BG, color: MUTED, maxWidth: 960, paddingY: 40, paddingYTablet: 36, paddingYMobile: 28, gap: 12, align: "center" }),
  ];
}

export const template: ConversionTemplateDefinition = {
  id: "leads-checklist-minimal",
  kind: "leads",
  number: 1,
  name: "極簡清單索取頁",
  description: "資源名稱就是標題、表單緊接在承諾後：清單內頁預覽、三點收穫與四週節奏，只有一個動作。",
  category: "清單／小抄",
  purposes: ["leads"],
  styles: ["minimal"],
  preview: { eyebrow: "名單頁", headline: "Instagram 30 天貼文企劃清單", summary: "極簡首屏表單＋清單預覽", palette: [BG, PRIMARY, INK], sectionCount: 6 },
  theme: { typography: { headingFont: "sans-tc", bodyFont: "sans-tc", bodySize: 18, bodyLineHeight: 1.75, textColor: BODY, headingColor: INK, linkColor: PRIMARY }, background: { color: BG } },
  settings: { scrollReveal: "rise", stickyCta: { enabled: true, label: "免費下載清單", target: "optin", showDate: false, devices: "mobile_tablet", buttonColor: PRIMARY, buttonTextColor: CARD, backgroundColor: BG } },
  build,
  thankYou: {
    name: "極簡清單・名單感謝頁",
    description: "交付清單、提醒收信，並推薦一對一社群健檢。",
    tokens: { background: BG, surface: CARD, ink: INK, body: BODY, accent: PRIMARY, onAccent: CARD, line: LINE, footerBackground: INK, footerText: "#d7dae0", radius: 10 },
    eyebrow: "已收到你的 Email",
    title: "清單正在寄出，去信箱看看吧",
    intro: "一分鐘內會收到一封標題為「你的 30 天貼文企劃清單」的信。沒看到的話，請檢查促銷內容或垃圾郵件匣。",
    card: { title: "Instagram 30 天貼文企劃清單", text: "PDF 清單＋可編輯的試算表。建議先存到手機，每天發文前打開看一眼。", buttonLabel: "直接下載清單", buttonHref: "#ty-steps" },
    steps: [
      { icon: "message", title: "打開確認信", text: "把寄件者加入通訊錄，之後的小店經營信才不會被分到促銷匣。" },
      { icon: "book", title: "存到手機", text: "清單放在手機桌面，發文前花 30 秒看今天的主題。" },
      { icon: "rocket", title: "明天發第 1 篇", text: "從「自我介紹」開始，不用完美，先發出去再說。" },
    ],
    next: { eyebrow: "想走得更快？", title: "一對一 Instagram 小店健檢", text: "40 分鐘線上會談，一起看你的帳號與最近 9 篇貼文，帶走 3 個馬上能改的地方。", buttonLabel: "了解健檢方案", buttonHref: "#ty-steps" },
    footer: "© 小禾的小店社群筆記｜如需取消訂閱，可點擊信件底部的退訂連結。",
  },
};
