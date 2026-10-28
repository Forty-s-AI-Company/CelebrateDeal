import { WEBINAR_TEMPLATE_SAMPLE_MARK, webinarTemplateKit, type WebinarTemplateDefinition } from "./types";

/**
 * 範本 10：語言學習系列講座報名頁（specs/10-language-series.md）。
 * 明亮的手帳／貼紙風：白底與奶油黃交替、2px 深藍描邊卡片（不用陰影）、黃色描邊按鈕，
 * 標題用霞鶩文楷（含假名）。系列共 4 堂，報名綁定本頁漏斗的那一堂（第 1 堂），
 * 其他場次用場次表展示。插圖在 public/funnel-illustrations/webinar/10/。
 */
const ART = "/funnel-illustrations/webinar/10";
const BG = "#ffffff";
const CREAM = "#fff8e7";
const INK = "#1b2b48";
const BODY = "#3b4a63";
const MUTED = "#64708a";
const YELLOW = "#ffb020";
const TEAL = "#1f7a70";

function build(prefix: string) {
  const { node, section, columns2, stack, headline, text, button, form } = webinarTemplateKit(prefix);
  const yellowButton = { backgroundColor: YELLOW, color: INK, borderColor: INK, borderWidth: 2, borderRadius: 100, fontSize: 18, padding: "14px 34px" } as const;
  const outlined = { backgroundColor: BG, borderColor: INK, borderWidth: 2, borderRadius: 20, padding: 28 } as const;
  const h2 = (id: string, value: string) => headline(id, value, "h2", { color: INK, fontSize: 36, lineHeight: 1.3, textAlign: "center" }, { tablet: { style: { fontSize: 32 } }, mobile: { style: { fontSize: 26 } } });
  const tag = (id: string, value: string, color = TEAL) => text(id, value, "small", { color: "#ffffff", backgroundColor: color, borderRadius: 100, padding: "4px 14px", width: "fit-content", fontSize: 15 });
  const lesson = (id: string, icon: string, alt: string, label: string, heading: string, value: string, current = false) => stack(id, [
    node(`${id}_icon`, "image", { src: `${ART}/${icon}.svg`, alt }, undefined, { imageWidth: 40 }, { mobile: { style: { imageWidth: 26 } } }),
    current ? tag(`${id}_tag`, label, TEAL) : text(`${id}_tag`, label, "small", { color: MUTED, fontSize: 15 }),
    headline(`${id}_title`, heading, "h3", { color: INK, fontSize: 20, lineHeight: 1.4 }, { mobile: { style: { fontSize: 18 } } }),
    text(`${id}_text`, value, undefined, { color: BODY, fontSize: 16 }),
  ], 12, { ...outlined, backgroundColor: current ? CREAM : BG, padding: 24 });
  return [
    // 1. 首屏：左文案＋本堂資訊與倒數，右對話泡泡插畫（手機縮小放在標題上方）。
    section("hero", [
      columns2("hero_columns", [
        tag("hero_tag", "免費系列直播｜共 4 堂｜每週一堂"),
        headline("hero_title", "30 天，從五十音到自我介紹，\n開口說出第一句日語", "h1", { color: INK, fontSize: 46, lineHeight: 1.3 }, { tablet: { style: { fontSize: 42 } }, mobile: { style: { fontSize: 30 }, props: { text: "從五十音到自我介紹，30 天開口說出第一句日語" } } }),
        text("hero_lead", "每堂 50 分鐘直播＋一張練習單。本頁報名的是「第 1 堂」，報名後會收到後續場次的通知。", "lead", { color: BODY }),
        button("hero_cta", "免費報名第 1 堂", "#register", yellowButton),
        node("hero_facts", "event_facts", { layout: "row", formatLabel: "線上直播", priceLabel: "免費", showDuration: true, accentColor: TEAL }, undefined, { color: INK }),
        node("hero_countdown", "countdown", { variant: "blocks", source: "webinar_start", label: "距離第 1 堂開播", align: "left", numberColor: INK, cellColor: CREAM }, undefined, { color: INK }),
      ], [
        node("hero_art", "image", { src: `${ART}/hero-bubbles.svg`, alt: "寫著日語問候的對話泡泡插畫" }, undefined, { imageWidth: 100 }, { tablet: { style: { imageWidth: 56, margin: "0 auto" } }, mobile: { style: { imageWidth: 72, margin: "0 auto" } } }),
      ], { ratio: "7:5", gap: 48, mobileOrder: "reverse", stackOn: "tablet", align: "center" }),
    ], { background: BG, color: BODY, maxWidth: 1120, gap: 0, paddingY: 80, paddingYTablet: 64, paddingYMobile: 28 }),
    // 2. 學習路徑（4 堂場次表；日期由商家在每一列設定，狀態自動計算）。
    section("path", [
      text("path_eyebrow", "LEARNING PATH", "eyebrow", { color: TEAL, textAlign: "center" }),
      h2("path_title", "4 堂課的學習路徑"),
      text("path_lead", "一週一堂、循序漸進。本頁報名的是第 1 堂，後續場次會另外寄送通知。", undefined, { color: BODY, textAlign: "center" }),
      stack("path_card", [
        node("path_schedule", "session_schedule", { durationMinutes: 50, accentColor: TEAL, items: [
          { title: "第 1 堂｜五十音不用背", text: "【本頁報名】用聯想記住平假名，當天就能唸出自己的名字。" },
          { title: "第 2 堂｜打招呼與自我介紹", text: "5 句最常用的問候，加上 30 秒自我介紹。" },
          { title: "第 3 堂｜點餐與問路", text: "旅行最常遇到的情境，一次練熟。" },
          { title: "第 4 堂｜用日語聊興趣", text: "把喜歡的動漫、美食與旅行說出口。" },
        ] }, undefined, { color: INK, textAlign: "left" }),
      ], 0, { ...outlined, padding: 20 }, { mobile: { style: { padding: 12 } } }),
    ], { background: CREAM, color: BODY, maxWidth: 960, gap: 20, align: "center" }),
    // 3. 每堂學到什麼（4 張描邊卡片，與場次對應）。
    section("lessons", [
      h2("lessons_title", "每一堂，你會學會什麼"),
      node("lessons_columns", "columns_4", { gap: 20 }, [
        lesson("lesson_1", "lesson-kana", "平假名あ的圖示", "第 1 堂・本頁報名", "五十音不用背", "用圖像聯想記住平假名，練習唸出自己的名字。", true),
        lesson("lesson_2", "lesson-greeting", "揮手打招呼的圖示", "第 2 堂", "打招呼與自我介紹", "おはよう、はじめまして，說出 30 秒自我介紹。"),
        lesson("lesson_3", "lesson-ramen", "拉麵碗的圖示", "第 3 堂", "點餐與問路", "在餐廳點餐、在車站問路，旅行馬上用得到。"),
        lesson("lesson_4", "lesson-heart", "愛心圖示", "第 4 堂", "用日語聊興趣", "聊動漫、美食與旅行，和學伴開口對話。"),
      ]),
    ], { background: BG, color: BODY, maxWidth: 1120, gap: 36, align: "center" }),
    // 4. 學習方式。
    section("method", [
      h2("method_title", "不只聽課，還會開口練"),
      stack("method_panel", [
        node("method_list", "icon_list", { layout: "grid", columns: 3, numbered: false, accentColor: TEAL, items: [
          { icon: "play", title: "直播跟讀", text: "老師帶著唸、帶著練，一句一句跟上。" },
          { icon: "book", title: "每週練習單", text: "直播後寄出練習單，10 分鐘複習重點。" },
          { icon: "users", title: "學員社群互相練習", text: "和學伴一起練對話（社群連結由主辦單位設定）。" },
        ] }, undefined, { color: INK, textAlign: "left" }),
      ], 0, { ...outlined, padding: 36 }, { mobile: { style: { padding: 22 } } }),
    ], { background: CREAM, color: BODY, maxWidth: 1120, gap: 36, align: "center" }),
    // 5. 老師介紹。
    section("teacher", [
      text("teacher_eyebrow", "YOUR TEACHER", "eyebrow", { color: TEAL, textAlign: "center" }),
      h2("teacher_title", "はじめまして，我是真由老師"),
      node("teacher_card", "speaker_profiles", { layout: "featured", photoShape: "portrait", accentColor: TEAL, items: [
        { photo: `${ART}/teacher.svg`, alt: "鈴木真由老師的照片（請替換）", name: "鈴木真由", role: "日語教師・中日雙語", bio: "在台灣教日語超過十年，擅長用生活情境帶零基礎的學生開口。上課節奏輕鬆，最常說的一句話是「說錯沒關係，先說出口」。", tags: "零基礎教學,中日雙語" },
      ] }, undefined, { color: INK, textAlign: "left" }),
    ], { background: BG, color: BODY, maxWidth: 960, gap: 28, align: "center" }),
    // 6. 學員心聲（一排、格狀）。
    section("reviews", [
      h2("reviews_title", "上過系列直播的學員說"),
      node("reviews_wall", "testimonial_wall", { layout: "grid", columns: 3, rows: 1, autoplay: false, showRating: false, accentColor: TEAL, cardColor: BG, cardTextColor: INK, items: [
        { name: "學員 A｜上班族", title: `終於不怕五十音（${WEBINAR_TEMPLATE_SAMPLE_MARK}）`, text: "聯想記憶法很有效，第一堂結束就能看懂車站的平假名。" },
        { name: "學員 B｜大學生", title: `敢開口自我介紹了（${WEBINAR_TEMPLATE_SAMPLE_MARK}）`, text: "老師會一個一個糾正發音，第二堂就能流暢說完自我介紹。" },
        { name: "學員 C｜退休族", title: `旅行點餐好有成就感（${WEBINAR_TEMPLATE_SAMPLE_MARK}）`, text: "去大阪時用學到的句子點了拉麵，店員還誇我日語很好。" },
      ] }, undefined, { textAlign: "left" }),
    ], { background: CREAM, color: BODY, maxWidth: 1120, gap: 32, align: "center" }),
    // 7. 報名表＋截止提示＋行事曆。
    section("register", [
      h2("register_title", "免費報名第 1 堂"),
      text("register_lead", "第 1 堂開播：{{webinar.startAt}}", undefined, { color: BODY, textAlign: "center" }),
      stack("register_card", [
        node("register_deadline", "deadline_notice", { label: "報名截止", closedText: "第 1 堂報名已截止，歡迎留意下一堂", accentColor: TEAL }, undefined, { color: INK }),
        form("register_form", {
          fields: [
            { name: "name", label: "姓名", placeholder: "王小明", required: true },
            { name: "email", label: "Email", type: "email", placeholder: "name@example.com", required: true, helpText: "直播連結、練習單與後續場次通知會寄到這裡" },
          ],
          submitLabel: "免費報名第 1 堂",
          submitStyle: { ...yellowButton, padding: "14px 24px" },
          note: "報名即表示同意接收本系列直播相關通知，可隨時取消訂閱。",
          htmlId: "register",
          style: { color: INK, textAlign: "left" },
        }),
        text("register_calendar_note", "報名後可以把第 1 堂加入行事曆，避免錯過開播：", "small", { color: BODY }),
        node("register_calendar", "add_to_calendar", { googleLabel: "加入 Google 日曆", icsLabel: "下載行事曆檔", pendingText: "開播時間公布後，就能加入行事曆。", accentColor: TEAL }, undefined, { color: INK }),
      ], 18, { ...outlined, padding: 32 }, { mobile: { style: { padding: 16 } } }),
    ], { background: BG, color: BODY, maxWidth: 600, gap: 20, align: "center" }),
    // 8. FAQ。
    section("faq", [
      h2("faq_title", "常見問題"),
      node("faq_list", "faq", { items: [
        { question: "完全零基礎也可以嗎？", answer: "可以。第 1 堂從五十音開始，不需要任何基礎。" },
        { question: "錯過一堂怎麼辦？", answer: "依主辦單位的回放設定，報名者會收到回放資訊；練習單也會照常寄出。" },
        { question: "4 堂課要報名 4 次嗎？", answer: "本頁報名的是第 1 堂。後續場次的通知方式依主辦單位設定，請留意報名確認信。" },
        { question: "需要買課本嗎？", answer: "不用。每堂都會提供練習單，直播中用到的內容都在裡面。" },
      ] }, undefined, { textAlign: "left", color: INK }),
      button("faq_cta", "免費報名第 1 堂", "#register", yellowButton),
    ], { background: CREAM, color: BODY, maxWidth: 760, gap: 28, align: "center" }),
  ];
}

export const template: WebinarTemplateDefinition = {
  id: "webinar-language-series",
  number: 10,
  name: "語言學習系列講座報名頁",
  description: "手帳貼紙風的系列直播頁：對話泡泡首屏、4 堂學習路徑場次表、描邊課程卡與本堂報名表。",
  category: "語言學習講座",
  purposes: ["webinar"],
  styles: ["vivid"],
  preview: { eyebrow: "Series", headline: "語言學習系列講座報名頁", summary: "白底奶油黃＋深藍描邊卡片", palette: [CREAM, YELLOW, INK], sectionCount: 8 },
  theme: { typography: { headingFont: "wenkai-tc", bodyFont: "sans-tc", bodySize: 17, bodyLineHeight: 1.75, textColor: BODY, headingColor: INK, linkColor: TEAL }, background: { color: BG } },
  settings: {
    eventTitle: "30 天開口說日語：4 堂免費直播入門課（第 1 堂）",
    scrollReveal: "rise",
    stickyCta: { enabled: true, label: "免費報名第 1 堂", showDate: true, devices: "mobile_tablet", buttonColor: YELLOW, buttonTextColor: INK, backgroundColor: BG },
  },
  build,
};
