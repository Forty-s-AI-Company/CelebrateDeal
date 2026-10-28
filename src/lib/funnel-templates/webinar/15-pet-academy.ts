import { WEBINAR_TEMPLATE_SAMPLE_MARK, webinarTemplateKit, type WebinarTemplateDefinition } from "./types";

/**
 * specs/15：寵物學院機構認證報名頁。以機構可信度為主：導覽列、合作單位 Logo、學院數據、
 * 說明會流程、認證步驟、三位師資與學員故事；白底與淺綠灰交替、1px 細框＋8px 圓角。
 * 「認證」預設寫明為學院自辦，商家可自行修改，不暗示是政府證照。
 */
const ART = "/funnel-illustrations/webinar/15";
const BG = "#ffffff";
const SURFACE = "#f2f7f4";
const INK = "#183a2e";
const BODY = "#3d5a50";
const MUTED = "#5a7067";
const PRIMARY = "#1f7a5a";
const ACCENT = "#a3561a";
const LINE = "#d5e3db";

function build(prefix: string) {
  const { node, section, columns2, headline, text, button, form } = webinarTemplateKit(prefix);
  const cta = { backgroundColor: PRIMARY, color: "#ffffff", borderRadius: 8, padding: "16px 32px", fontSize: 18 } as const;
  const h2 = (id: string, value: string, extra = {}) => headline(id, value, "h2", { color: INK, fontSize: 34, lineHeight: 1.3, ...extra }, { mobile: { style: { fontSize: 24 } } });
  const eyebrow = (id: string, value: string) => text(id, value, "eyebrow", { color: ACCENT, letterSpacing: 2 });

  return [
    // 1. 導覽列（手機收進漢堡選單）。
    node("nav", "nav_bar", {
      brand: "", logoSrc: `${ART}/logo.svg`, logoHeight: 40, homeHref: "#top", sticky: false, accentColor: PRIMARY, ctaLabel: "預約說明會", ctaHref: "#register",
      items: [
        { label: "課程架構", href: "#program" },
        { label: "師資陣容", href: "#faculty" },
        { label: "學員故事", href: "#stories" },
        { label: "常見問題", href: "#faq" },
      ],
    }, undefined, { backgroundColor: BG, color: INK }),

    // 2. 首屏。
    section("hero", [
      columns2("hero_columns", [
        eyebrow("hero_eyebrow", "認證課程線上說明會｜免費"),
        headline("hero_title", "把對毛孩的愛，變成一份專業", "h1", { color: INK, fontSize: 46, lineHeight: 1.3 }, {
          tablet: { style: { fontSize: 38 } },
          mobile: { style: { fontSize: 28 } },
        }),
        text("hero_subtitle", "寵物行為訓練師認證課程", "lead", { color: PRIMARY }),
        text("hero_lead", "60 分鐘說明會，完整介紹課程內容、實習方式、認證標準與就業方向，現場開放提問。", undefined, { color: BODY }),
        button("hero_cta", "預約說明會", "#register", cta, { mobile: { style: { width: 100 } } }),
        node("hero_facts", "event_facts", { layout: "row", formatLabel: "線上說明會", priceLabel: "免費", showDuration: true, accentColor: PRIMARY }, undefined, { color: BODY, fontSize: 18 }),
      ], [
        node("hero_image", "image", { src: `${ART}/hero-trainer.svg`, alt: "訓練師蹲下與狗狗擊掌互動的插畫" }, undefined, { imageWidth: 100, borderRadius: 8 }),
      ], { ratio: "1:1", gap: 56, stackOn: "tablet", align: "center" }),
    ], { background: BG, color: BODY, maxWidth: 1160, gap: 24, paddingY: 72, paddingYTablet: 56, paddingYMobile: 32, htmlId: "top" }),

    // 3. 合作單位 Logo。
    section("partners", [
      node("partners_logos", "logo_strip", { title: `合作單位與實習場域（${WEBINAR_TEMPLATE_SAMPLE_MARK} Logo）`, tone: "grayscale", logoHeight: 40, items: [
        { src: `${ART}/partner-1.svg`, alt: "北岸動物醫院（示意 Logo）" },
        { src: `${ART}/partner-2.svg`, alt: "安心收容協會（示意 Logo）" },
        { src: `${ART}/partner-3.svg`, alt: "毛毛美容學苑（示意 Logo）" },
        { src: `${ART}/partner-4.svg`, alt: "城市寵物用品（示意 Logo）" },
        { src: `${ART}/partner-5.svg`, alt: "汪喵友善旅宿（示意 Logo）" },
        { src: `${ART}/partner-6.svg`, alt: "動物行為研究室（示意 Logo）" },
      ] }, undefined, { color: MUTED }),
    ], { background: SURFACE, color: BODY, maxWidth: 1160, paddingY: 40, paddingYMobile: 32 }),

    // 4. 學院數據。
    section("stats", [
      node("stats_numbers", "stats", { animate: true, accentColor: PRIMARY, items: [
        { value: "860", suffix: "+", label: "結業學員" },
        { value: "42", suffix: "家", label: "合作單位" },
        { value: "120", suffix: "小時", label: "實習時數" },
        { value: "4.8", suffix: "/5", label: "學員滿意度" },
      ] }, undefined, { color: INK }, { tablet: { style: { width: "600px", margin: "0 auto" } } }), // 平板 4 項排成 2×2（見 notes B3-11）
      text("stats_note", `數據為${WEBINAR_TEMPLATE_SAMPLE_MARK}，發布前請替換為學院實際資料。`, "small", { color: MUTED, textAlign: "center" }),
    ], { background: BG, color: BODY, maxWidth: 1160, gap: 16, paddingY: 72, paddingYMobile: 48 }),

    // 5. 說明會流程。
    section("agenda", [
      eyebrow("agenda_eyebrow", "說明會流程"),
      h2("agenda_title", "60 分鐘，一次了解要不要報名"),
      node("agenda_cards", "agenda_timeline", { layout: "vertical", accentColor: PRIMARY, cardColor: BG, items: [
        { time: "15 分鐘", title: "產業現況", text: "寵物行為訓練的需求、工作型態與收入結構。" },
        { time: "15 分鐘", title: "課程架構", text: "理論、實作與實習怎麼安排，每週需要多少時間。" },
        { time: "15 分鐘", title: "認證與實習", text: "考核方式、實習場域，以及結業後拿到什麼。" },
        { time: "15 分鐘", title: "Q&A", text: "現場回答費用、分期與背景相關問題。" },
      ] }, undefined, { color: BODY, textAlign: "left" }),
    ], { background: SURFACE, color: BODY, maxWidth: 1160, gap: 24, align: "center" }),

    // 6. 課程架構與認證流程。
    section("program", [
      eyebrow("program_eyebrow", "課程架構"),
      h2("program_title", "從理論到認證的 4 個階段"),
      node("program_steps", "agenda_timeline", { layout: "steps", accentColor: PRIMARY, cardColor: SURFACE, items: [
        { title: "線上理論", text: "動物學習理論、肢體語言與福利原則。" },
        { title: "實體實作", text: "小班練習，每位學員都有指導員回饋。" },
        { title: "實習", text: "到合作單位實習，累積真實個案經驗。" },
        { title: "考核認證", text: "筆試、實作與個案報告，通過後頒發學院認證。" },
      ] }, undefined, { color: INK, textAlign: "left", width: 100 }),
      text("program_note", "本課程認證為學院自辦認證，非政府核發之證照；商家請依實際情況修改說明。", "small", { color: MUTED }),
    ], { background: BG, color: BODY, maxWidth: 1160, gap: 24, htmlId: "program" }),

    // 7. 師資陣容。
    section("faculty", [
      eyebrow("faculty_eyebrow", "師資陣容"),
      h2("faculty_title", "由訓練、醫療與教學背景的老師共同授課"),
      node("faculty_grid", "speaker_profiles", { layout: "grid", columns: 3, photoShape: "square", accentColor: PRIMARY, gradientFrom: PRIMARY, gradientTo: ACCENT, items: [
        { photo: `${ART}/faculty-1.svg`, alt: "楊志明老師的照片（請替換）", name: "楊志明", role: "首席訓練師", bio: "十五年犬隻行為訓練經驗，專長焦慮與攻擊行為修正。", tags: "行為修正,工作犬" },
        { photo: `${ART}/faculty-2.svg`, alt: "林郁婷老師的照片（請替換）", name: "林郁婷", role: "獸醫行為諮詢", bio: "從醫療角度看行為問題，教你分辨何時該先就醫。", tags: "獸醫,行為醫學" },
        { photo: `${ART}/faculty-3.svg`, alt: "陳品妤老師的照片（請替換）", name: "陳品妤", role: "課程主任", bio: "負責課程設計與實習媒合，陪學員走完每個階段。", tags: "課程設計,職涯輔導" },
      ] }, undefined, { color: BODY, textAlign: "left" }),
    ], { background: SURFACE, color: BODY, maxWidth: 1160, gap: 24, htmlId: "faculty" }),

    // 8. 適合／不適合。
    section("fit", [
      h2("fit_title", "這個課程適合誰？", { textAlign: "center" }),
      node("fit_compare", "fit_compare", {
        fitTitle: "適合你，如果……",
        fitItems: ["想轉職到寵物產業", "在寵物店工作，想要系統化進修", "是收容所志工，想更懂動物行為"],
        notFitTitle: "可能不適合",
        notFitItems: ["只想訓練自家寵物（學院另有飼主課程）", "希望短時間內拿到政府證照"],
        fitColor: PRIMARY, notFitColor: ACCENT, cardColor: BG,
      }, undefined, { color: BODY, textAlign: "left" }),
    ], { background: BG, color: BODY, maxWidth: 1000, gap: 24 }),

    // 9. 結業學員故事。
    section("stories", [
      eyebrow("stories_eyebrow", "結業學員故事"),
      h2("stories_title", "他們從這裡，開始新的工作"),
      node("stories_cards", "content_cards", { columns: 3, accentColor: ACCENT, cardColor: BG, cardTextColor: INK, items: [
        { src: `${ART}/story-dog.svg`, alt: "狗狗剪影插圖", category: `轉職｜${WEBINAR_TEMPLATE_SAMPLE_MARK}`, title: "從工程師到到府訓練師", text: "學員 A 結業後開始接到府訓練，一年後成為全職訓練師。", href: "#register", linkLabel: "預約說明會" },
        { src: `${ART}/story-cat.svg`, alt: "貓咪剪影插圖", category: `進修｜${WEBINAR_TEMPLATE_SAMPLE_MARK}`, title: "寵物店店長的第二專長", text: "學員 B 把行為知識帶進門市，客人回訪率明顯提高。", href: "#register", linkLabel: "預約說明會" },
        { src: `${ART}/story-rabbit.svg`, alt: "兔子剪影插圖", category: `志工｜${WEBINAR_TEMPLATE_SAMPLE_MARK}`, title: "讓收容動物更容易被認養", text: "學員 C 協助收容所做社會化訓練，帶領志工團隊。", href: "#register", linkLabel: "預約說明會" },
      ] }, undefined, { color: BODY, textAlign: "left" }),
    ], { background: SURFACE, color: BODY, maxWidth: 1160, gap: 24, htmlId: "stories" }),

    // 10. 報名：左說明會資訊卡、右表單。
    section("signup", [
      columns2("signup_columns", [
        eyebrow("signup_eyebrow", "預約說明會"),
        headline("signup_title", "聽完說明會，\n再決定要不要報名", "h2", { color: INK, fontSize: 34, lineHeight: 1.3 }, { mobile: { style: { fontSize: 24 }, props: { text: "聽完說明會，再決定要不要報名" } } }),
        node("signup_facts", "event_facts", { layout: "card", title: "說明會資訊", formatLabel: "線上說明會", priceLabel: "免費", showDuration: true, showTimezone: true, accentColor: PRIMARY, cardColor: SURFACE, cardTextColor: INK }, undefined, { color: BODY, fontSize: 18 }),
        text("signup_note", "說明會不推銷，現場提問都會回答。", "small", { color: MUTED }),
      ], [
        form("signup_form", {
          title: "填寫資料，收到說明會連結",
          fields: [
            { name: "name", label: "姓名", placeholder: "王小明", required: true },
            { name: "email", label: "Email", type: "email", placeholder: "name@example.com", required: true, helpText: "說明會連結會寄到這個信箱" },
            { name: "phone", label: "手機", type: "tel", placeholder: "0912-345-678", helpText: "選填，方便課程顧問回覆問題" },
          ],
          submitLabel: "預約說明會",
          submitStyle: { backgroundColor: PRIMARY, color: "#ffffff", borderRadius: 8, fontSize: 18 },
          note: "報名後寄送說明會連結，可隨時取消訂閱。",
          htmlId: "register",
          style: { backgroundColor: BG, padding: 32, borderRadius: 8, borderColor: LINE, borderWidth: 1, color: INK, textAlign: "left", width: 100, shadow: "medium" },
          mobile: { style: { padding: 16 } },
        }),
      ], { ratio: "5:7", gap: 48, stackOn: "tablet" }),
    ], { background: BG, color: BODY, maxWidth: 1160 }),

    // 11. FAQ。
    section("faq", [
      h2("faq_title", "常見問題", { textAlign: "center" }),
      node("faq_list", "faq", { items: [
        { question: "需要相關背景嗎？", answer: "不需要。課程從基礎理論開始，有養寵物經驗會更好上手，但不是必要條件。" },
        { question: "認證是誰發的？", answer: "由毛孩行為學院自辦考核並頒發認證，不是政府核發的證照。請商家依實際情況修改這段說明。" },
        { question: "費用與分期？", answer: "說明會會完整說明費用與分期方式，報名前不需要先付費。" },
        { question: "實習地點？", answer: "學院會依你的居住地區媒合合作單位，實際地點以說明會公布為準。" },
        { question: "結業後的就業協助？", answer: "提供履歷健檢與合作單位職缺資訊，但不保證就業。" },
      ] }, undefined, { textAlign: "left", color: BODY }),
      button("faq_cta", "預約說明會", "#register", cta, { mobile: { style: { width: 100 } } }),
    ], { background: SURFACE, color: BODY, maxWidth: 760, gap: 24, align: "center", htmlId: "faq" }),
  ];
}

export const template: WebinarTemplateDefinition = {
  id: "webinar-pet-academy",
  number: 15,
  name: "寵物學院認證說明會報名頁",
  description: "以機構可信度為主的招生說明會：導覽列、合作單位 Logo、學院數據、說明會流程、認證步驟、師資與學員故事；適合學院、協會與證照課程。",
  category: "認證課程說明會",
  purposes: ["webinar"],
  styles: ["professional"],
  preview: { eyebrow: "Info session", headline: "寵物行為訓練師認證課程", summary: "導覽列＋Logo 牆＋師資＋認證流程", palette: [BG, PRIMARY, SURFACE], sectionCount: 11 },
  theme: { typography: { headingFont: "sans-tc", bodyFont: "sans-tc", bodySize: 17, bodyLineHeight: 1.8, textColor: BODY, headingColor: INK, linkColor: PRIMARY }, background: { color: BG } },
  settings: { eventTitle: "成為寵物行為訓練師：認證課程線上說明會", scrollReveal: "fade", stickyCta: { enabled: true, label: "預約說明會", showDate: true, devices: "mobile_tablet", buttonColor: PRIMARY, buttonTextColor: "#ffffff" } },
  build,
};
