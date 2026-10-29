import { conversionTemplateKit, type ConversionTemplateDefinition } from "../conversion/types";

/**
 * 名單 06：新品候補名單頁（specs/leads-06-waitlist-outdoor.md）。
 * 深墨綠底、黃銅線稿：首屏像一張產品設計圖，H1、表單置中，表單下方是標註尺寸的背包線稿；
 * 往下是設計重點、細節特寫、上市流程（不寫日期）、候補權益＋FAQ，最後在山稜線背景上再收一次名單。
 * 品牌「霧嶺 Ridge & Fog」與產品為虛構示意，不寫人數、剩餘數量或上市日期。
 */
const ART = "/funnel-illustrations/leads/06";
const FOREST = "#0f1714";
const CARD = "#18221e";
const DEEP = "#0b120f";
const INK = "#f3f1ea";
const BODY = "#c8d3cc";
const MUTED = "#9fada5";
const BRASS = "#c9a46a";
const LINE = "#2c3a33";

function build(prefix: string) {
  const { node, section, columns2, stack, headline, text, button, form } = conversionTemplateKit(prefix);
  const cta = { backgroundColor: BRASS, color: FOREST, borderRadius: 2, fontSize: 18, letterSpacing: 2 } as const;
  const fields = [{ name: "email", label: "Email", type: "email" as const, placeholder: "name@example.com", required: true, helpText: "開賣通知與首批配色會寄到這裡" }];
  const note = "只寄上市相關通知，不轉售名單；隨時可以一鍵退訂。";
  const eyebrow = (id: string, value: string) => text(id, value, "eyebrow", { color: BRASS, letterSpacing: 4 });
  const h2 = (id: string, value: string, mobileText?: string) => headline(id, value, "h2", { color: INK, fontSize: 40, lineHeight: 1.35, letterSpacing: 1 }, {
    tablet: { style: { fontSize: 34 } },
    mobile: { style: { fontSize: 27, letterSpacing: 0 }, ...(mobileText ? { props: { text: mobileText } } : {}) },
  });
  const formCard = { backgroundColor: CARD, borderColor: LINE, borderWidth: 1, borderRadius: 4, padding: 28, color: INK, textAlign: "left", width: "min(100%, 520px)", margin: "0 auto" } as const;

  return [
    // 1. 首屏：設計圖般的置中構圖。表單緊接在承諾之後，線稿放在表單下方，手機首屏就看得到欄位。
    section("hero", [
      eyebrow("hero_eyebrow", "候補名單開放中｜RIDGE & FOG"),
      headline("hero_title", "為城市與山路之間\n而做的 28L 背包", "h1", { color: INK, fontSize: 64, lineHeight: 1.22, letterSpacing: 2 }, {
        tablet: { style: { fontSize: 50 } },
        mobile: { style: { fontSize: 34, lineHeight: 1.3, letterSpacing: 0 }, props: { text: "為城市與山路之間而做的 28L 背包" } },
      }),
      text("hero_lead", "霧嶺 Model 28 即將上市。加入候補，開賣時優先收到通知與首批配色資訊。", "lead", { color: BODY, width: "min(100%, 600px)", margin: "0 auto" }),
      form("hero_form", {
        fields,
        submitLabel: "加入候補名單",
        submitStyle: cta,
        note,
        htmlId: "optin",
        style: { ...formCard, shadow: "strong" },
        mobile: { style: { padding: 18 } },
      }),
      node("hero_drawing", "image", { src: `${ART}/pack-blueprint.svg`, alt: "霧嶺 Model 28 背包線稿：高 46 公分、寬 30 公分，標示捲頂主艙、筆電夾層、壓縮帶、快取前袋與水壺袋" }, undefined, { imageWidth: 100, margin: "24px 0 0" }, {
        mobile: { props: { src: `${ART}/pack-mobile.svg` } },
      }),
    ], { background: FOREST, color: BODY, maxWidth: 1040, paddingY: 96, paddingYTablet: 64, paddingYMobile: 28, gap: 24, align: "center" }),

    // 2. 四個設計重點：左側標題欄、右側 2×2。
    section("design", [
      columns2("design_split", [
        eyebrow("design_eyebrow", "DESIGN NOTES"),
        h2("design_title", "一只背包，\n跟著你從捷運\n走到稜線", "一只背包，跟著你從捷運走到稜線"),
        text("design_text", "通勤要俐落、週末要能裝。我們花了很長時間測試，把兩種需求收進同一個 28 公升。", undefined, { color: BODY }),
      ], [
        node("design_list", "icon_list", { layout: "grid", columns: 2, numbered: false, accentColor: BRASS, items: [
          { icon: "mountain", title: "捲頂式主艙 22–28L", text: "平日捲緊像一般後背包，週末展開多裝一件外套與午餐。" },
          { icon: "shield", title: "840D 防潑水布料", text: "雨天通勤不怕濕；表面耐磨，刮到樹枝也不起毛。" },
          { icon: "compass", title: "側開快取設計", text: "不用放下背包，從側邊就能拿到筆電與錢包。" },
          { icon: "leaf", title: "回收材質內裡", text: "內裡與織帶使用回收聚酯纖維，顏色選擇低調耐看。" },
        ] }, undefined, { color: BODY, textAlign: "left" }),
      ], { ratio: "5:7", stackOn: "tablet", gap: 64, align: "start" }),
    ], { background: CARD, color: BODY, maxWidth: 1120, gap: 24 }),

    // 3. 細節特寫。
    section("details", [
      eyebrow("details_eyebrow", "CLOSE-UP"),
      h2("details_title", "靠近一點看"),
      text("details_text", "打樣階段的三個細節。正式版顏色與材質，會在開賣前先寄給候補名單。", undefined, { color: BODY, width: "min(100%, 620px)", margin: "0 auto" }),
      node("details_gallery", "image_gallery", { layout: "grid", columns: 3, items: [
        { src: `${ART}/detail-zip.svg`, alt: "細節線稿：防潑水隱藏拉鍊與加大拉片", caption: "防潑水隱藏拉鍊，戴手套也拉得動" },
        { src: `${ART}/detail-buckle.svg`, alt: "細節線稿：可拆式胸扣與加寬肩帶", caption: "可拆式胸扣，長時間背也不勒肩" },
        { src: `${ART}/detail-fabric.svg`, alt: "細節線稿：布料表面的水珠不吸附", caption: "840D 布料，雨水停在表面" },
      ] }, undefined, { color: MUTED }),
    ], { background: FOREST, color: BODY, maxWidth: 1160, gap: 20, align: "center" }),

    // 4. 上市流程（不寫日期）。
    section("launch", [
      eyebrow("launch_eyebrow", "ROAD TO LAUNCH"),
      h2("launch_title", "從打樣到你的肩上"),
      node("launch_steps", "agenda_timeline", { layout: "steps", accentColor: BRASS, cardColor: CARD, items: [
        { time: "PROTOTYPE", title: "打樣與實測", text: "在城市通勤與郊山步道實際背負，調整肩帶與背板。" },
        { time: "PREVIEW", title: "候補名單搶先看", text: "首批配色、細節照片與尺寸說明，先寄給候補名單。" },
        { time: "EARLY ACCESS", title: "候補優先開賣", text: "開賣當下寄出通知信，候補名單比公開上市更早收到。" },
        { time: "LAUNCH", title: "公開上市", text: "官網與合作門市同步販售，並提供保固與維修服務。" },
      ] }, undefined, { color: INK, textAlign: "left" }),
      text("launch_note", "實際時程以品牌公告為準，我們會用 Email 通知每一個階段。", "small", { color: MUTED }),
    ], { background: DEEP, color: BODY, maxWidth: 1120, gap: 24, align: "center" }),

    // 5. 候補權益與 FAQ。
    section("perks", [
      columns2("perks_split", [
        eyebrow("perks_eyebrow", "WAITLIST"),
        h2("perks_title", "候補名單\n會收到什麼", "候補名單會收到什麼"),
        node("perks_list", "icon_list", { layout: "list", numbered: false, accentColor: BRASS, items: [
          { icon: "clock", title: "開賣優先通知", text: "比公開上市更早收到購買連結。" },
          { icon: "gem", title: "首批配色搶先看", text: "配色、實拍照與尺寸建議一次寄給你。" },
          { icon: "message", title: "參與最後一輪意見", text: "小問卷決定隔層與配件細節。" },
        ] }, undefined, { color: BODY, textAlign: "left" }),
      ], [
        node("perks_faq", "faq", { items: [
          { question: "加入候補要付費嗎？", answer: "不用。候補名單只是開賣通知，不需要預付訂金，也不代表一定要購買。" },
          { question: "會寄很多信嗎？", answer: "只在上市流程的重要階段寄信，通常是配色公開與開賣通知。每封信底部都可以退訂。" },
          { question: "身高比較矮適合背嗎？", answer: "背板長度依常見身形設計，開賣前會寄出尺寸對照與試背建議，可以先比對再決定。" },
          { question: "會在實體店販售嗎？", answer: "公開上市後會陸續進入合作門市，候補名單會先收到門市資訊。" },
        ] }, undefined, { color: BODY, textAlign: "left" }),
      ], { ratio: "5:7", stackOn: "tablet", gap: 64, align: "start" }),
    ], { background: FOREST, color: BODY, maxWidth: 1120, gap: 24 }),

    // 6. 第二次表單：山稜線背景。
    section("again", [
      eyebrow("again_eyebrow", "JOIN THE WAITLIST"),
      h2("again_title", "開賣那天，\n第一個通知你", "開賣那天，第一個通知你"),
      form("again_form", {
        fields,
        submitLabel: "加入候補名單",
        submitStyle: cta,
        note,
        style: { ...formCard, padding: 32 },
        mobile: { style: { padding: 18 } },
      }),
    ], { background: FOREST, color: BODY, maxWidth: 640, paddingY: 120, paddingYTablet: 96, paddingYMobile: 56, gap: 24, align: "center", props: { backgroundImage: `${ART}/ridge.svg`, backgroundPosition: "bottom", overlayColor: FOREST, overlayOpacity: 30, overlayFade: "top" } }),

    // 7. 頁尾。
    section("footer", [
      stack("footer_brand", [
        text("footer_mark", "RIDGE & FOG｜霧嶺", "eyebrow", { color: BRASS, letterSpacing: 4 }),
        text("footer_text", "© 霧嶺 Ridge & Fog（虛構品牌示意）｜我們不會把你的 Email 提供給第三方。", "small", { color: MUTED }),
      ], 8),
      button("footer_top", "回到頂端", "#optin", { backgroundColor: "transparent", color: INK, borderColor: LINE, borderWidth: 1, borderRadius: 2, padding: "10px 20px", width: "fit-content", margin: "0 auto", fontSize: 15 }),
    ], { background: DEEP, color: MUTED, maxWidth: 960, paddingY: 48, paddingYTablet: 40, paddingYMobile: 32, gap: 16, align: "center" }),
  ];
}

export const template: ConversionTemplateDefinition = {
  id: "leads-waitlist-outdoor",
  kind: "leads",
  number: 6,
  name: "新品候補名單頁",
  description: "深墨綠與黃銅線稿的新品上市前候補頁：設計圖般的首屏、細節特寫、不寫日期的上市流程與候補權益。",
  category: "新品候補／搶先名單",
  purposes: ["leads", "brand"],
  styles: ["luxe"],
  preview: { eyebrow: "名單頁", headline: "為城市與山路之間而做的 28L 背包", summary: "深色設計圖首屏＋候補權益", palette: [FOREST, BRASS, INK], sectionCount: 7 },
  theme: { typography: { headingFont: "serif-tc", bodyFont: "sans-tc", bodySize: 17, bodyLineHeight: 1.8, textColor: BODY, headingColor: INK, linkColor: BRASS }, background: { color: FOREST } },
  settings: { scrollReveal: "fade", stickyCta: { enabled: true, label: "加入候補名單", target: "optin", showDate: false, devices: "mobile_tablet", buttonColor: BRASS, buttonTextColor: FOREST, backgroundColor: DEEP } },
  build,
  thankYou: {
    name: "新品候補・名單感謝頁",
    description: "確認候補身分、提醒收信，並引導追蹤品牌與等待開賣通知。",
    tokens: { background: FOREST, surface: CARD, ink: INK, body: BODY, accent: BRASS, onAccent: FOREST, line: LINE, footerBackground: DEEP, footerText: MUTED, radius: 2 },
    eyebrow: "候補登記完成",
    title: "你已在候補名單上",
    intro: "確認信正在路上。幾分鐘內沒收到的話，請看看促銷內容或垃圾郵件匣，並把寄件者加入通訊錄。",
    card: { title: "霧嶺 Model 28｜候補名單", text: "開賣時你會比公開上市更早收到通知；首批配色與實拍照也會先寄給你。候補不需付費，也不代表一定要購買。", buttonLabel: "看看接下來會發生什麼", buttonHref: "#ty-steps" },
    steps: [
      { icon: "message", title: "收信確認", text: "打開確認信，點擊信中的按鈕，完成候補登記。" },
      { icon: "compass", title: "追蹤品牌", text: "在社群追蹤霧嶺，看打樣實測與步道上的背負紀錄。" },
      { icon: "clock", title: "等待優先通知", text: "開賣當下我們會寄信給你，比公開上市更早拿到購買連結。" },
    ],
    footer: "© 霧嶺 Ridge & Fog（虛構品牌示意）｜每封信底部都可以一鍵退訂。",
  },
};
