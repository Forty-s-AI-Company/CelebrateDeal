import { WEBINAR_TEMPLATE_SAMPLE_MARK, webinarTemplateKit, type WebinarTemplateDefinition } from "./types";

/**
 * specs/13：電商數據導向報名頁。黑底首屏用超大「NT$600 → NT$900」當記憶點，右側瀏覽器框放報表；
 * 之後是白底網格、1px 細框、4px 小圓角。橘色只用在數字、按鈕與重點；淺色底的橘色小字改用 #c2410c。
 * 數字一律標示為虛構案例，不做收入保證。
 */
const ART = "/funnel-illustrations/webinar/13";
const BG = "#ffffff";
const BAND = "#fff4ea";
const INK = "#0a0a0a";
const BODY = "#333333";
const MUTED = "#666666";
const ORANGE = "#ff6a00";
const ORANGE_TEXT = "#c2410c";
const DARK = "#111111";
const LINE = "#e5e5e5";
const ON_DARK = "#d4d4d4";

function build(prefix: string) {
  const { node, section, columns2, stack, headline, text, button, form } = webinarTemplateKit(prefix);
  const cta = { backgroundColor: ORANGE, color: INK, borderColor: INK, borderWidth: 2, borderRadius: 4, padding: "16px 32px", fontSize: 18 } as const;
  const h2 = (id: string, value: string, extra = {}) => headline(id, value, "h2", { color: INK, fontSize: 34, lineHeight: 1.3, ...extra }, { mobile: { style: { fontSize: 24 } } });
  const eyebrow = (id: string, value: string, color = ORANGE_TEXT) => text(id, value, "eyebrow", { color, letterSpacing: 2 });
  const card = { backgroundColor: BG, borderColor: LINE, borderWidth: 1, borderRadius: 4, padding: 32 } as const;

  return [
    // 1. 公告條＋inline 倒數（綁漏斗開播時間）。
    node("announcement", "announcement_bar", { text: "免費線上直播｜{{webinar.date}}｜小電商客單價拆解", showCountdown: true, countdownLabel: "距離開播", barColor: ORANGE, barTextColor: INK }),

    // 2. 首屏：超大數字、H1、條件小字、活動資訊列、CTA；右側瀏覽器框報表。
    section("hero", [
      columns2("hero_columns", [
        eyebrow("hero_eyebrow", "免費直播｜小店成長數據室", ORANGE),
        headline("hero_number", "NT$600 → NT$900", "h1", { color: ORANGE, fontSize: 88, lineHeight: 1.05, letterSpacing: -2 }, {
          tablet: { style: { fontSize: 72 } },
          mobile: { style: { fontSize: 52, letterSpacing: -1 } },
        }),
        headline("hero_title", "不多花廣告費，用 4 個加購設計\n把客單價拉高 50%", "h2", { color: "#ffffff", fontSize: 40, lineHeight: 1.3 }, {
          tablet: { style: { fontSize: 34 } },
          mobile: { style: { fontSize: 26 }, props: { text: "不多花廣告費，用 4 個加購設計把客單價拉高 50%" } },
        }),
        text("hero_condition", "數字為虛構案例示意；實際成效依商品、流量與執行而異。", "small", { color: ON_DARK }),
        button("hero_cta", "免費報名直播", "#register", cta, { mobile: { style: { width: 100 } } }),
        node("hero_facts", "event_facts", { layout: "row", formatLabel: "線上直播", priceLabel: "免費", showDuration: true, accentColor: ORANGE }, undefined, { color: "#ffffff" }),
      ], [
        node("hero_dashboard", "media_frame", { frame: "browser", src: `${ART}/dashboard.svg`, alt: "電商營運報表示意：客單價與加購率的長條圖與數字卡", url: "report.example", aspect: "16:10" }),
      ], { ratio: "7:5", gap: 56, stackOn: "tablet", align: "center" }),
    ], { background: INK, color: ON_DARK, maxWidth: 1160, gap: 24, paddingY: 88, paddingYTablet: 64, paddingYMobile: 40 }),

    // 3. 數據列（4 欄 → 平板 2 欄 → 手機 2×2）。
    section("stats", [
      node("stats_numbers", "stats", { animate: true, accentColor: ORANGE_TEXT, items: [
        { value: "22", suffix: "%", label: "加購採用率" },
        { value: "50", prefix: "+", suffix: "%", label: "平均客單價變化" },
        { value: "1.8", suffix: "%", label: "退貨率" },
        { value: "31", suffix: "%", label: "90 天回購率" },
      ] }, undefined, { color: INK }),
      text("stats_note", `以上為虛構案例的${WEBINAR_TEMPLATE_SAMPLE_MARK}數據，發布前請替換為可查證的資料並註明來源。`, "small", { color: MUTED, textAlign: "center" }),
    ], { background: BAND, color: BODY, maxWidth: 1160, gap: 16, paddingY: 64, paddingYMobile: 48 }),

    // 4. 4 個加購設計。
    section("tactics", [
      eyebrow("tactics_eyebrow", "直播內容"),
      h2("tactics_title", "4 個不用多花廣告費的加購設計"),
      node("tactics_list", "icon_list", { layout: "grid", columns: 2, numbered: true, accentColor: ORANGE_TEXT, items: [
        { title: "湊免運門檻", text: "用客單價分布找出門檻，讓差一點的人自然多買一件。" },
        { title: "搭配組", text: "把常一起買的商品組起來，價格設計比單買更划算。" },
        { title: "結帳頁小額加購", text: "結帳前推薦低單價、不用考慮的小物，提高成交件數。" },
        { title: "訂閱補貨", text: "消耗品改成定期配送，把一次性客人變成固定營收。" },
      ] }, undefined, { color: INK, textAlign: "left", width: 100 }),
    ], { background: BG, color: BODY, maxWidth: 1160, gap: 24 }),

    // 5. 案例拆解：前後指標對照（虛構）。
    section("case", [
      eyebrow("case_eyebrow", "案例拆解（虛構）"),
      h2("case_title", "同一家店，導入前後的 3 個指標"),
      node("case_columns", "columns_2", { ratio: "1:1", gap: 24 }, [
        stack("case_before", [
          text("case_before_label", "導入前", "eyebrow", { color: MUTED, letterSpacing: 2 }),
          headline("case_before_value", "NT$600", "h3", { color: INK, fontSize: 48, lineHeight: 1.1 }, { mobile: { style: { fontSize: 40 } } }),
          node("case_before_list", "bulleted_list", { items: ["平均客單價 NT$600", "加購採用率 4%", "沒有免運門檻"] }, undefined, { color: BODY }),
        ], 12, card),
        stack("case_after", [
          text("case_after_label", "導入 8 週後", "eyebrow", { color: ORANGE_TEXT, letterSpacing: 2 }),
          headline("case_after_value", "NT$900", "h3", { color: INK, fontSize: 48, lineHeight: 1.1 }, { mobile: { style: { fontSize: 40 } } }),
          node("case_after_list", "bulleted_list", { items: ["平均客單價 NT$900（+50%）", "加購採用率 22%", "免運門檻 NT$990"] }, undefined, { color: BODY }),
        ], 12, { ...card, borderColor: INK, borderWidth: 2 }),
      ]),
      text("case_note", `${WEBINAR_TEMPLATE_SAMPLE_MARK}：案例與數字為虛構，用來說明拆解方式，不代表成效保證。`, "small", { color: MUTED }),
    ], { background: "#fafafa", color: BODY, maxWidth: 1000, gap: 24 }),

    // 6. 講者。
    section("speaker", [
      eyebrow("speaker_eyebrow", "講者"),
      node("speaker_card", "speaker_profiles", { layout: "featured", photoShape: "square", accentColor: ORANGE_TEXT, gradientFrom: ORANGE, gradientTo: INK, items: [
        { photo: `${ART}/speaker.svg`, alt: "講者鄭宇翔的照片（請替換）", name: "鄭宇翔", role: "電商顧問｜「小店成長數據室」主持人", bio: "專門陪小型品牌看懂後台數字。相信先把現有客人服務好，比再買一次流量更划算。", tags: "電商營運,數據分析,結帳優化" },
      ] }, undefined, { color: BODY, textAlign: "left" }),
    ], { background: BG, color: BODY, maxWidth: 1000, gap: 24 }),

    // 7. 參加禮（純展示，不影響任何金額）。
    section("bonus", [
      eyebrow("bonus_eyebrow", "參加禮"),
      h2("bonus_title", "看完直播，帶走 3 份工具"),
      node("bonus_stack", "value_stack", { title: "直播參加者限定", accentColor: ORANGE_TEXT, cardColor: BG, cardTextColor: INK, items: [
        { title: "加購商品挑選表", text: "依毛利與購買頻率，挑出最適合當加購的商品。", value: "參考價值 NT$490" },
        { title: "免運門檻試算表", text: "輸入客單價分布，算出不傷毛利的門檻。", value: "參考價值 NT$690" },
        { title: "結帳頁檢查清單", text: "20 個結帳流程檢查點，上線前逐項確認。", value: "參考價值 NT$390" },
      ], totalLabel: "總參考價值", totalValue: "NT$1,570", offerLabel: "直播參加者免費", note: "價值為講者自訂參考，非售價承諾。" }, undefined, { color: INK }),
    ], { background: BAND, color: BODY, maxWidth: 760, gap: 24, align: "center" }),

    // 8. 報名表。
    section("signup", [
      eyebrow("signup_eyebrow", "免費報名"),
      h2("signup_title", "把你的客單價，拉到下一個數字"),
      text("signup_date", "{{webinar.startAt}}｜線上直播", undefined, { color: BODY }),
      form("signup_form", {
        fields: [
          { name: "name", label: "姓名", placeholder: "王小明", required: true },
          { name: "email", label: "Email", type: "email", placeholder: "name@example.com", required: true, helpText: "直播連結與參加禮會寄到這個信箱" },
        ],
        submitLabel: "免費報名直播",
        submitStyle: { backgroundColor: ORANGE, color: INK, borderColor: INK, borderWidth: 2, borderRadius: 4, fontSize: 18 },
        note: "報名後寄送直播連結，可隨時取消訂閱。",
        htmlId: "register",
        style: { ...card, padding: 36, color: INK, textAlign: "left", width: 100, borderColor: INK, borderWidth: 2 },
        mobile: { style: { padding: 16 } },
      }),
    ], { background: BG, color: BODY, maxWidth: 560, gap: 20, align: "center" }),

    // 9. FAQ。
    section("faq", [
      h2("faq_title", "常見問題", { textAlign: "center" }),
      node("faq_list", "faq", { items: [
        { question: "適合哪些電商平台？", answer: "自架官網、開店平台或社群團購都適用，示範的設計不綁定特定平台。" },
        { question: "需要技術能力嗎？", answer: "不需要。所有設計都能用後台既有功能完成，不必寫程式。" },
        { question: "有回放嗎？", answer: "依主辦單位的回放設定，報名後會收到回放資訊。" },
        { question: "會推銷代操服務嗎？", answer: "直播最後 5 分鐘會簡短介紹顧問服務，是否了解由你決定。" },
      ] }, undefined, { textAlign: "left", color: BODY }),
    ], { background: "#fafafa", color: BODY, maxWidth: 760, gap: 24 }),

    // 頁尾 CTA。
    section("footer_cta", [
      headline("footer_number", "NT$600 → NT$900", "h2", { color: ORANGE, fontSize: 56, lineHeight: 1.1 }, { mobile: { style: { fontSize: 36 } } }),
      text("footer_text", "下一個數字，從這場直播開始。{{webinar.startAt}}", undefined, { color: ON_DARK }),
      button("footer_button", "免費報名直播", "#register", cta),
    ], { background: DARK, color: ON_DARK, maxWidth: 760, gap: 20, align: "center", paddingY: 88, paddingYMobile: 56 }),
  ];
}

export const template: WebinarTemplateDefinition = {
  id: "webinar-ecommerce-data",
  number: 13,
  name: "電商數據導向報名頁",
  description: "黑底首屏的超大數字標題，搭配報表裝置框、數據列、案例前後對照與參加禮；適合電商、廣告與業務等可量化的主題。",
  category: "電商講座",
  purposes: ["webinar", "sales"],
  styles: ["vivid"],
  preview: { eyebrow: "Webinar", headline: "NT$600 → NT$900", summary: "超大數字首屏＋報表裝置框", palette: [INK, ORANGE, BAND], sectionCount: 10 },
  theme: { typography: { headingFont: "display-latin", bodyFont: "sans-tc", bodySize: 17, bodyLineHeight: 1.75, textColor: BODY, headingColor: INK, linkColor: ORANGE_TEXT }, background: { color: BG } },
  settings: { eventTitle: "客單價從 600 到 900：小電商的 4 個加購設計", scrollReveal: "rise", stickyCta: { enabled: true, label: "免費報名直播", showDate: true, devices: "mobile_tablet", buttonColor: ORANGE, buttonTextColor: INK, backgroundColor: INK } },
  build,
};
