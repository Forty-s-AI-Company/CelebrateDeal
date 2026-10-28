import { WEBINAR_TEMPLATE_SAMPLE_MARK, webinarTemplateKit, type WebinarTemplateDefinition } from "./types";

/**
 * 範例範本（開發用，不出現在範本庫）：specs/01 的簡化版，示範每個範本都會用到的寫法：
 * 主題、頁面設定（活動名稱、固定報名列）、倒數條、首屏表單、活動資訊列、講者、評價、FAQ、
 * 平板與手機覆寫。實作 01 時可以從這份複製再依 spec 補齊。
 */
const BG = "#ffffff";
const SURFACE = "#f5f7ff";
const INK = "#0b1020";
const BODY = "#2b3245";
const PRIMARY = "#4f46e5";
const ACCENT_TEXT = "#0e7490";
const ACCENT_DECOR = "#06b6d4";

function build(prefix: string) {
  const { node, section, headline, text, button, form } = webinarTemplateKit(prefix);
  const primaryButton = { backgroundColor: PRIMARY, color: "#ffffff", borderRadius: 10 } as const;
  return [
    // 1. 頂部倒數條：綁漏斗的開播時間；開播後自動換成「直播進行中」。
    node("countdown_bar", "countdown", { variant: "bar", source: "webinar_start", label: "距離開播", barColor: ACCENT_DECOR, barTextColor: INK }),
    // 2. 首屏：單欄置中，表單緊接活動資訊列（375×667 看得到第一個欄位）。
    section("hero", [
      text("hero_eyebrow", "免費線上直播｜90 分鐘", "eyebrow", { color: ACCENT_TEXT }),
      headline("hero_title", "每天省下 1 小時，\n從 3 個 AI 工作流程開始", "h1", { fontSize: 52, lineHeight: 1.2 }, { tablet: { style: { fontSize: 42 } }, mobile: { style: { fontSize: 30, lineHeight: 1.3 }, props: { text: "每天省下 1 小時，從 3 個 AI 工作流程開始" } } }),
      text("hero_lead", "不用會寫程式。跟著做完，你會有一套可以直接套用在信件、會議記錄與報表上的 AI 流程。", "lead", { color: BODY }),
      node("hero_facts", "event_facts", { layout: "row", formatLabel: "線上直播", priceLabel: "免費", accentColor: PRIMARY, align: "center" }),
      form("hero_form", {
        title: "保留我的免費席位",
        fields: [
          { name: "name", label: "姓名", placeholder: "王小明", required: true },
          { name: "email", label: "Email", type: "email", placeholder: "name@example.com", required: true, helpText: "直播連結會寄到這個信箱" },
        ],
        submitLabel: "免費報名直播",
        submitStyle: { ...primaryButton, fontSize: 18 },
        note: "報名後寄送直播連結，可隨時取消訂閱。",
        htmlId: "register",
        style: { backgroundColor: SURFACE, padding: 28, borderRadius: 16, color: INK, textAlign: "left", width: 100 },
        mobile: { style: { padding: 20 } },
      }),
    ], { background: BG, color: BODY, maxWidth: 640, gap: 20, align: "center", paddingY: 72, paddingYMobile: 40 }),
    // 3. 你將學到
    section("learn", [
      headline("learn_title", "這 90 分鐘你會帶走", "h2", { color: INK }),
      node("learn_list", "icon_list", { layout: "grid", columns: 3, numbered: true, accentColor: PRIMARY, items: [
        { icon: "message", title: "AI 起草重複信件", text: "一套可以直接套用的提示詞框架。" },
        { icon: "clock", title: "10 分鐘會議重點", text: "從逐字稿到待辦清單的流程。" },
        { icon: "chart", title: "AI 整理週報", text: "一份檢查清單，讓數字不出錯。" },
      ] }, undefined, { color: BODY, textAlign: "left" }),
    ], { background: SURFACE, color: BODY, maxWidth: 1040, align: "center" }),
    // 4. 講者（小型，沒有照片時顯示姓名首字漸層頭像）
    section("speaker", [
      node("speaker_card", "speaker_profiles", { layout: "featured", size: "small", accentColor: PRIMARY, gradientFrom: PRIMARY, gradientTo: ACCENT_DECOR, items: [
        { name: "林予安", role: "AI 工作流程顧問", bio: `協助 120 家中小企業導入 AI 工具（${WEBINAR_TEMPLATE_SAMPLE_MARK}數據）。專長是把複雜的工具變成每天用得到的流程。`, tags: "企業導入,工作坊講師" },
      ] }, undefined, { color: BODY }),
    ], { background: BG, color: BODY, maxWidth: 640, align: "center" }),
    // 5. 評價（格狀、不輪播；標示範本示意）
    section("reviews", [
      headline("reviews_title", "參加過的人怎麼說", "h2", { color: INK }),
      node("reviews_wall", "testimonial_wall", { layout: "grid", columns: 3, autoplay: false, showRating: false, cardColor: "#ffffff", cardTextColor: BODY, accentColor: PRIMARY, items: [
        { name: "學員 A｜行銷企劃", title: WEBINAR_TEMPLATE_SAMPLE_MARK, text: "以前回信要半小時，現在 5 分鐘就有草稿。" },
        { name: "學員 B｜專案經理", title: WEBINAR_TEMPLATE_SAMPLE_MARK, text: "會議一結束待辦就整理好了，團隊追進度輕鬆很多。" },
        { name: "學員 C｜業務主管", title: WEBINAR_TEMPLATE_SAMPLE_MARK, text: "週報不用再熬夜做，數字也比較少出錯。" },
      ] }, undefined, { textAlign: "left" }),
    ], { background: SURFACE, color: BODY, maxWidth: 1040, align: "center" }),
    // 6. FAQ
    section("faq", [
      headline("faq_title", "常見問題", "h2", { color: INK }),
      node("faq_list", "faq", { items: [
        { question: "需要付費工具嗎？", answer: "不用，直播示範的都是免費方案。" },
        { question: "沒空看直播怎麼辦？", answer: "依主辦單位的回放設定，報名後會收到回放資訊。" },
        { question: "需要準備什麼？", answer: "一台可以上網的電腦，以及一個你最想自動化的工作。" },
        { question: "會推銷課程嗎？", answer: "直播尾聲會介紹進階課程，是否參加由你決定。" },
      ] }, undefined, { textAlign: "left", color: BODY }),
    ], { background: BG, color: BODY, maxWidth: 640 }),
    // 7. 頁尾 CTA（捲回報名表）
    section("footer_cta", [
      headline("footer_title", "這 90 分鐘，換你每天多 1 小時", "h2", { color: "#ffffff" }),
      text("footer_date", "{{webinar.startAt}}", undefined, { color: "#e0e7ff" }),
      button("footer_button", "免費報名", "#register", primaryButton),
    ], { background: INK, color: "#e0e7ff", maxWidth: 640, gap: 20, align: "center" }),
  ];
}

export const template: WebinarTemplateDefinition = {
  id: "webinar-example",
  number: 0,
  name: "範例：AI 工具極簡報名頁（開發用）",
  description: "範本工作階段的寫法範例；不出現在範本庫。",
  category: "開發範例",
  purposes: ["webinar"],
  styles: ["minimal"],
  preview: { eyebrow: "Webinar", headline: "AI 工具極簡報名頁", summary: "單欄首屏表單", palette: [BG, PRIMARY, SURFACE], sectionCount: 7 },
  theme: { typography: { headingFont: "sans-tc", bodyFont: "sans-tc", bodySize: 18, bodyLineHeight: 1.75, textColor: BODY, headingColor: INK, linkColor: PRIMARY }, background: { color: BG } },
  settings: { eventTitle: "90 分鐘把 AI 變成你的工作助理", stickyCta: { enabled: true, label: "免費報名", showDate: true, devices: "mobile_tablet", buttonColor: PRIMARY, buttonTextColor: "#ffffff" } },
  build,
  hidden: true,
};
