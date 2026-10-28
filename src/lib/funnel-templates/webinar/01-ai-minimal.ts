import { WEBINAR_TEMPLATE_SAMPLE_MARK, webinarTemplateKit, type WebinarTemplateDefinition } from "./types";

/**
 * 範本 01：AI 工具極簡報名頁（specs/01-ai-minimal.md）。
 * 單欄置中、表單緊接標題；視覺記憶點是 hero 上半部的點陣格線與靛藍／青色光暈，
 * 以及頁尾同一套光暈的深色收尾。不放導覽列與照片，講者用姓名首字漸層頭像。
 */
const ART = "/funnel-illustrations/webinar/01";
const BG = "#ffffff";
const SURFACE = "#f5f7ff";
const LINE = "#e2e6f5";
const INK = "#0b1020";
const BODY = "#2b3245";
const PRIMARY = "#4f46e5";
const ACCENT_TEXT = "#0e7490";
const ACCENT_DECOR = "#06b6d4";
const DARK_BODY = "#c7cde0";

function build(prefix: string) {
  const { node, section, stack, headline, text, button, form } = webinarTemplateKit(prefix);
  const primaryButton = { backgroundColor: PRIMARY, color: "#ffffff", borderRadius: 12, shadow: "medium" } as const;
  const card = { backgroundColor: BG, borderColor: LINE, borderWidth: 1, borderRadius: 20, padding: 32 } as const;

  const learnCard = (id: string, number: string, title: string, body: string) => stack(id, [
    text(`${id}_number`, number, "eyebrow", { color: PRIMARY, fontSize: 30, letterSpacing: 1, lineHeight: 1.2 }),
    headline(`${id}_title`, title, "h3", { color: INK, fontSize: 20, lineHeight: 1.45 }, { mobile: { style: { fontSize: 18 } } }),
    text(`${id}_text`, body, undefined, { color: BODY, fontSize: 16, lineHeight: 1.75 }),
  ], 12, card, { mobile: { style: { padding: 24 } } });

  return [
    // 1. 頂部倒數條：綁開播時間；開播後顯示「直播進行中」，回放期顯示回放文字。
    node("countdown_bar", "countdown", { variant: "bar", source: "webinar_start", label: "距離開播", liveText: "直播進行中，現在就進入", replayText: "回放限時開放中", expiredText: "本場直播已結束", barColor: ACCENT_DECOR, barTextColor: INK }),

    // 2. 首屏：字標、眉標、標題、引言、活動資訊列、報名表（表單緊接資訊列）。
    section("hero", [
      text("hero_brand", "效率實驗室　EFFICIENCY LAB", "small", { color: INK, letterSpacing: 3, fontSize: 14 }, { mobile: { style: { letterSpacing: 1 } } }),
      text("hero_eyebrow", "免費線上直播｜90 分鐘", "eyebrow", { color: ACCENT_TEXT, backgroundColor: "#e6f6fa", borderRadius: 400, padding: "6px 14px", width: "fit-content", margin: "0 auto" }),
      headline("hero_title", "每天省下 1 小時，\n從 3 個 AI 工作流程開始", "h1", { color: INK, fontSize: 52, lineHeight: 1.2, letterSpacing: -0.5 }, {
        tablet: { style: { fontSize: 44 } },
        mobile: { style: { fontSize: 30, lineHeight: 1.3, letterSpacing: 0 }, props: { text: "3 個 AI 工作流程，每天幫你省下 1 小時" } },
      }),
      text("hero_lead", "不用會寫程式。跟著做完，你會有一套直接套用在信件、會議記錄與報表上的 AI 流程。", "lead", { color: BODY, width: "min(100%, 600px)", margin: "0 auto" }, { mobile: { style: { fontSize: 17 } } }),
      node("hero_facts", "event_facts", { layout: "row", formatLabel: "線上直播", priceLabel: "免費", showDate: true, showTime: true, showDuration: false, accentColor: PRIMARY, align: "center" }, undefined, { color: INK, width: "100%" }),
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
        style: { backgroundColor: BG, borderColor: LINE, borderWidth: 1, borderRadius: 20, padding: 32, shadow: "strong", color: INK, textAlign: "left", width: "min(100%, 480px)", margin: "8px auto 0" },
        mobile: { style: { padding: 16, borderRadius: 16 } },
      }),
    ], { background: BG, color: BODY, maxWidth: 640, gap: 22, align: "center", paddingY: 72, paddingYMobile: 36, props: { backgroundImage: `${ART}/grid-dots.svg`, backgroundPosition: "top" } }),

    // 3. 你將學到：3 張編號卡片（平板也上下堆疊，避免 2＋1 的孤欄）。
    section("learn", [
      stack("learn_heading", [
        text("learn_eyebrow", "WHAT YOU'LL BUILD", "eyebrow", { color: ACCENT_TEXT }),
        headline("learn_title", "這 90 分鐘，你會帶走 3 個流程", "h2", { color: INK, fontSize: 34, lineHeight: 1.3 }, { mobile: { style: { fontSize: 24, lineHeight: 1.35 } } }),
      ], 10, { textAlign: "center" }),
      node("learn_grid", "columns_3", { stackOn: "tablet", gap: 24 }, [
        learnCard("learn_one", "01", "AI 起草重複信件", "一套提示詞框架：把客服回覆、報價追蹤與會議邀約交給 AI 先寫初稿。"),
        learnCard("learn_two", "02", "10 分鐘會議重點", "從逐字稿到重點摘要與待辦清單，會議一結束就能寄出。"),
        learnCard("learn_three", "03", "AI 整理週報", "用一份檢查清單讓 AI 彙整數字與進度，你只要確認與補充。"),
      ], { align: "stretch" }),
    ], { background: SURFACE, color: BODY, maxWidth: 1080, gap: 48 }),

    // 4. 講者（小型，沒有照片時顯示姓名首字漸層頭像）。
    section("speaker", [
      text("speaker_eyebrow", "YOUR HOST", "eyebrow", { color: ACCENT_TEXT }),
      node("speaker_card", "speaker_profiles", { layout: "featured", size: "small", accentColor: PRIMARY, gradientFrom: PRIMARY, gradientTo: ACCENT_DECOR, items: [
        { name: "林予安", role: "AI 工作流程顧問・效率實驗室主理人", bio: `協助 120 家中小企業導入 AI 工具（${WEBINAR_TEMPLATE_SAMPLE_MARK}數據）。擅長把複雜的工具拆成每天用得到的小流程，讓團隊不用學程式也能上手。`, tags: "企業導入,工作坊講師,生產力教練" },
      ] }, undefined, { color: BODY }),
    ], { background: BG, color: BODY, maxWidth: 640, gap: 16, align: "center" }),

    // 5. 評價（格狀、不輪播；標示範本示意）。
    section("reviews", [
      headline("reviews_title", "參加過的人怎麼說", "h2", { color: INK, fontSize: 34 }, { mobile: { style: { fontSize: 24 } } }),
      node("reviews_wall", "testimonial_wall", { layout: "grid", columns: 3, autoplay: false, showRating: false, cardColor: BG, cardTextColor: BODY, accentColor: PRIMARY, items: [
        { name: "學員 A｜行銷企劃", title: WEBINAR_TEMPLATE_SAMPLE_MARK, text: "以前回一封客訴信要半小時，現在 5 分鐘就有一份可以直接修改的草稿。" },
        { name: "學員 B｜專案經理", title: WEBINAR_TEMPLATE_SAMPLE_MARK, text: "會議一結束待辦就整理好了，團隊追進度輕鬆很多。" },
        { name: "學員 C｜業務主管", title: WEBINAR_TEMPLATE_SAMPLE_MARK, text: "週報不用再熬夜做，數字也比較少出錯，主管問起來更有底氣。" },
      ] }, undefined, { textAlign: "left" }),
    ], { background: SURFACE, color: BODY, maxWidth: 1080, gap: 40, align: "center" }),

    // 6. FAQ
    section("faq", [
      headline("faq_title", "常見問題", "h2", { color: INK, fontSize: 34, textAlign: "center" }, { mobile: { style: { fontSize: 24 } } }),
      node("faq_list", "faq", { items: [
        { question: "需要付費的 AI 工具嗎？", answer: "不用。直播示範的都是免費方案，付費版只會在需要時補充說明差異。" },
        { question: "沒空看直播怎麼辦？", answer: "依主辦單位的回放設定，報名後會在信中收到回放資訊。" },
        { question: "需要準備什麼？", answer: "一台可以上網的電腦，以及一件你最想交給 AI 處理的重複工作。" },
        { question: "會推銷課程嗎？", answer: "直播尾聲會花幾分鐘介紹進階課程，是否參加完全由你決定，前面的內容都能直接帶走。" },
      ] }, undefined, { textAlign: "left", color: BODY }),
    ], { background: BG, color: BODY, maxWidth: 640, gap: 32 }),

    // 7. 頁尾 CTA（深色光暈，捲回報名表）。
    section("footer_cta", [
      text("footer_eyebrow", "免費線上直播", "eyebrow", { color: "#67e8f9" }),
      headline("footer_title", "這 90 分鐘，\n換你每天多 1 小時", "h2", { color: "#ffffff", fontSize: 38, lineHeight: 1.3 }, { mobile: { style: { fontSize: 26 }, props: { text: "這 90 分鐘，換你每天多 1 小時" } } }),
      text("footer_date", "{{webinar.startAt}}", undefined, { color: DARK_BODY }),
      button("footer_button", "免費報名", "#register", { ...primaryButton, fontSize: 18, padding: "16px 40px" }),
      text("footer_note", "效率實驗室（範本示意品牌）", "small", { color: "#9aa3bd" }),
    ], { background: INK, color: DARK_BODY, maxWidth: 640, gap: 20, align: "center", paddingY: 104, paddingYMobile: 64, props: { backgroundImage: `${ART}/glow-dark.svg`, backgroundPosition: "bottom" } }),
  ];
}

export const template: WebinarTemplateDefinition = {
  id: "webinar-ai-minimal",
  number: 1,
  name: "AI 工具極簡報名頁",
  description: "單欄置中、表單緊接標題的極簡報名頁，點陣格線與靛藍光暈，適合熟客流量的免費直播。",
  category: "AI 工具講座",
  purposes: ["webinar"],
  styles: ["minimal"],
  preview: { eyebrow: "Webinar", headline: "每天省下 1 小時，從 3 個 AI 工作流程開始", summary: "單欄首屏表單＋倒數條", palette: [BG, PRIMARY, ACCENT_DECOR], sectionCount: 7 },
  theme: { typography: { headingFont: "sans-tc", bodyFont: "sans-tc", bodySize: 18, bodyLineHeight: 1.75, textColor: BODY, headingColor: INK, linkColor: PRIMARY }, background: { color: BG } },
  settings: { eventTitle: "90 分鐘把 AI 變成你的工作助理", stickyCta: { enabled: true, label: "免費報名", showDate: true, devices: "mobile_tablet", buttonColor: PRIMARY, buttonTextColor: "#ffffff" } },
  build,
};
