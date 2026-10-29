import { WEBINAR_TEMPLATE_SAMPLE_MARK, webinarTemplateKit, type WebinarTemplateDefinition } from "./types";

/**
 * 範本 02：SaaS 產品 Demo 雙欄報名頁（specs/02-saas-split.md）。
 * 深藍首屏左文右表單卡，視覺記憶點是自製的產品儀表板插圖（放在瀏覽器外框裡）與綠色 CTA。
 * 平板與手機改成上下堆疊，3 個勾選重點移到表單下方，讓表單留在首屏附近。
 */
const ART = "/funnel-illustrations/webinar/02";
const NAVY = "#0f1b3d";
const HERO_INK = "#ffffff";
const HERO_BODY = "#c7d2fe";
const PRIMARY = "#22c55e";
const PRIMARY_TEXT = "#052e16";
const ACCENT = "#60a5fa";
const BG = "#f8fafc";
const WHITE = "#ffffff";
const INK = "#0f172a";
const BODY = "#334155";
const LINK = "#1d4ed8";

function build(prefix: string) {
  const { node, section, columns2, stack, headline, text, button, form } = webinarTemplateKit(prefix);
  const cta = { backgroundColor: PRIMARY, color: PRIMARY_TEXT, borderRadius: 10, fontSize: 18 } as const;
  const h2 = (id: string, value: string, color = INK) => headline(id, value, "h2", { color, fontSize: 34, lineHeight: 1.3 }, { tablet: { style: { fontSize: 30 } }, mobile: { style: { fontSize: 24, lineHeight: 1.35 } } });
  const checks = (id: string, color: string, options: Parameters<typeof node>[5]) => node(id, "icon_list", { layout: "list", numbered: false, accentColor: ACCENT, items: [
    { icon: "play", title: "現場示範，不播投影片", text: "" },
    { icon: "check", title: "30 天試用方案說明", text: "" },
    { icon: "message", title: "直播限定的導入諮詢名額", text: "" },
  ] }, undefined, { color }, options);

  return [
    // 1. 首屏：左文案、右表單卡（平板以下上下堆疊）。
    section("hero", [
      columns2("hero_split", [
        text("hero_brand", "◆ 數流 Flowboard", "small", { color: HERO_INK, fontSize: 16, letterSpacing: 1 }, { tablet: { style: { textAlign: "center" } } }),
        text("hero_eyebrow", "免費產品 Demo 直播｜45 分鐘＋Q&A", "eyebrow", { color: "#86efac" }, { tablet: { style: { textAlign: "center" } } }),
        headline("hero_title", "不必再開 5 個報表，\n一頁看懂庫存、訂單與現金流", "h1", { color: HERO_INK, fontSize: 48, lineHeight: 1.22 }, {
          tablet: { style: { fontSize: 40, textAlign: "center" } },
          mobile: { style: { fontSize: 30, lineHeight: 1.3, textAlign: "left" }, props: { text: "一頁看懂庫存、訂單與現金流" } },
        }),
        text("hero_lead", "用一家虛構的電商公司，從匯入資料到設定警示，完整示範一次。", "lead", { color: HERO_BODY }, { tablet: { visible: false }, mobile: { visible: false } }),
        checks("hero_checks", HERO_INK, { tablet: { visible: false }, mobile: { visible: false } }),
        node("hero_facts", "event_facts", { layout: "row", formatLabel: "線上直播", showDuration: false, accentColor: ACCENT }, undefined, { color: HERO_INK }, { tablet: { style: { width: "min(100%, 560px)", margin: "0 auto" } }, mobile: { style: { width: "100%", margin: 0 } } }),
      ], [
        form("hero_form", {
          title: "預約 Demo 席位",
          fields: [
            { name: "email", label: "工作 Email", type: "email", placeholder: "you@company.com", required: true },
            { name: "name", label: "姓名", placeholder: "王小明", required: true },
          ],
          submitLabel: "預約 Demo 席位",
          submitStyle: cta,
          note: "直播連結與回放會寄到你的信箱，可隨時取消訂閱。",
          htmlId: "register",
          style: { backgroundColor: WHITE, color: INK, padding: 32, borderRadius: 16, shadow: "strong", textAlign: "left" },
          tablet: { style: { width: "min(100%, 560px)", margin: "0 auto" } },
          mobile: { style: { padding: 20, width: "100%" } },
        }),
        checks("hero_checks_after", HERO_INK, { desktop: { visible: false }, tablet: { visible: true, style: { width: "min(100%, 560px)", margin: "0 auto" } }, mobile: { visible: true, style: { width: "100%", margin: 0 } } }),
      ], { ratio: "7:5", stackOn: "tablet", gap: 56, align: "center" }),
    ], { background: NAVY, color: HERO_BODY, maxWidth: 1160, paddingY: 88, paddingYTablet: 64, paddingYMobile: 36, props: { backgroundImage: `${ART}/hero-grid.svg`, backgroundPosition: "right" } }),

    // 2. 客戶 Logo（虛構字標，標示示意）。
    section("logos", [
      node("logos_strip", "logo_strip", { title: `超過 1,200 個團隊用數流看營運（${WEBINAR_TEMPLATE_SAMPLE_MARK} Logo）`, tone: "grayscale", logoHeight: 30, items: [
        { src: `${ART}/logo-nordic.svg`, alt: "NORDIC CART（示意 Logo）" },
        { src: `${ART}/logo-yuzu.svg`, alt: "柚子選物（示意 Logo）" },
        { src: `${ART}/logo-harbor.svg`, alt: "Harbor&Co（示意 Logo）" },
        { src: `${ART}/logo-pixel.svg`, alt: "PIXEL MART（示意 Logo）" },
        { src: `${ART}/logo-qingtian.svg`, alt: "青田商行（示意 Logo）" },
        { src: `${ART}/logo-loop.svg`, alt: "loop supply（示意 Logo）" },
      ] }, undefined, { color: BODY }),
    ], { background: WHITE, color: BODY, paddingY: 48, paddingYTablet: 44, paddingYMobile: 36, align: "center" }),

    // 3. Demo 會看到什麼：產品畫面＋3 點。
    section("demo", [
      columns2("demo_split", [
        node("demo_frame", "media_frame", { frame: "browser", src: `${ART}/dashboard.svg`, alt: "數流 Flowboard 營運總覽畫面示意", url: "flowboard.example", aspect: "16:10" }),
      ], [
        text("demo_eyebrow", "LIVE DEMO", "eyebrow", { color: LINK }),
        h2("demo_title", "45 分鐘，你會親眼看到"),
        node("demo_points", "icon_list", { layout: "list", numbered: true, accentColor: LINK, items: [
          { icon: "rocket", title: "串接訂單與倉儲資料", text: "匯入電商後台與倉儲表單，5 分鐘建好第一個儀表板。" },
          { icon: "shield", title: "設定低庫存與現金流警示", text: "門檻一到自動通知，不必每天手動對帳。" },
          { icon: "chart", title: "自動寄出每週營運摘要", text: "週一早上，主管信箱就有一頁看完的營運重點。" },
        ] }, undefined, { color: BODY }),
      ], { ratio: "7:5", stackOn: "tablet", gap: 56, align: "center" }),
    ], { background: BG, color: BODY, maxWidth: 1160, paddingY: 88 }),

    // 4. 議程（3 段，共 45 分鐘）。
    section("agenda", [
      stack("agenda_heading", [text("agenda_eyebrow", "AGENDA", "eyebrow", { color: LINK }), h2("agenda_title", "直播流程")], 10, { textAlign: "center" }),
      node("agenda_list", "icon_list", { layout: "grid", columns: 3, numbered: true, accentColor: LINK, items: [
        { icon: "clock", title: "00–10 分｜問題與情境", text: "為什麼報表越做越多，決策卻越來越慢？" },
        { icon: "play", title: "10–35 分｜產品實機示範", text: "從匯入資料、建立儀表板到設定警示，完整操作一次。" },
        { icon: "message", title: "35–45 分｜方案與 Q&A", text: "試用方案說明，現場回答你的導入問題。" },
      ] }, undefined, { color: BODY, textAlign: "left" }),
    ], { background: WHITE, color: BODY, maxWidth: 1160, paddingY: 88, gap: 40 }),

    // 5. 講者（2 人格狀）。
    section("speakers", [
      stack("speakers_heading", [text("speakers_eyebrow", "SPEAKERS", "eyebrow", { color: LINK }), h2("speakers_title", "由產品團隊親自示範")], 10, { textAlign: "center" }),
      node("speakers_grid", "speaker_profiles", { layout: "grid", columns: 2, photoShape: "square", accentColor: LINK, items: [
        { photo: `${ART}/speaker-a.svg`, alt: "講者照片（請替換）", name: "周明哲", role: "數流 Flowboard 產品長", bio: "帶領團隊打造營運儀表板，曾協助上百家電商把報表時間減半（範本示意）。", tags: "產品策略,電商營運" },
        { photo: `${ART}/speaker-b.svg`, alt: "講者照片（請替換）", name: "江怡君", role: "客戶成功經理", bio: "負責新客戶導入，最常被問的問題是：「我們的資料這麼亂，也能用嗎？」答案是可以。", tags: "導入顧問,資料整理" },
      ] }, undefined, { color: BODY }),
    ], { background: BG, color: BODY, maxWidth: 800, paddingY: 88, gap: 40 }),

    // 6. 數據成果（深藍帶，數字跳動）。
    section("results", [
      text("results_eyebrow", `客戶成果（${WEBINAR_TEMPLATE_SAMPLE_MARK}數據）`, "eyebrow", { color: "#86efac", textAlign: "center" }),
      node("results_stats", "stats", { animate: true, accentColor: PRIMARY, items: [
        { value: "7", suffix: "天", label: "平均導入時間" },
        { value: "62", suffix: "%", label: "報表製作時間減少" },
        { value: "1,200", suffix: "+", label: "使用中的團隊" },
      ] }, undefined, { color: HERO_INK }),
    ], { background: NAVY, color: HERO_BODY, maxWidth: 960, paddingY: 80, paddingYMobile: 56, gap: 32 }),

    // 7. FAQ（桌機左右各 3 題）。
    section("faq", [
      h2("faq_title", "常見問題"),
      columns2("faq_split", [
        node("faq_left", "faq", { items: [
          { question: "需要先註冊帳號嗎？", answer: "不用，報名直播即可觀看；想試用時再建立帳號。" },
          { question: "直播會錄影嗎？", answer: "會，依主辦單位的回放設定，報名者會收到回放連結。" },
          { question: "適合多大的團隊？", answer: "從 3 人小店到上百人的品牌都有客戶，示範會說明不同規模的做法。" },
        ] }, undefined, { color: BODY, textAlign: "left" }),
      ], [
        node("faq_right", "faq", { items: [
          { question: "可以帶同事一起看嗎？", answer: "可以，歡迎轉傳報名連結，每人用自己的 Email 報名即可收到通知。" },
          { question: "資料安全怎麼處理？", answer: "直播會說明權限、加密與備份做法，也可以會後索取資安文件。" },
          { question: "費用怎麼計算？", answer: "直播最後會說明方案；本場直播本身完全免費。" },
        ] }, undefined, { color: BODY, textAlign: "left" }),
      ], { ratio: "1:1", gap: 24 }),
    ], { background: WHITE, color: BODY, maxWidth: 1160, paddingY: 88, gap: 32, align: "center" }),

    // 8. 頁尾 CTA（深藍底）。
    section("footer_cta", [
      h2("footer_title", "45 分鐘後，\n你的週會只需要打開一頁", HERO_INK),
      text("footer_date", "{{webinar.startAt}}｜線上直播", undefined, { color: HERO_BODY }),
      button("footer_button", "預約 Demo 席位", "#register", { ...cta, padding: "16px 40px" }),
    ], { background: NAVY, color: HERO_BODY, maxWidth: 720, paddingY: 96, paddingYMobile: 64, gap: 20, align: "center", props: { backgroundImage: `${ART}/hero-grid.svg`, backgroundPosition: "center" } }),
  ];
}

export const template: WebinarTemplateDefinition = {
  id: "webinar-saas-split",
  number: 2,
  name: "SaaS 產品 Demo 雙欄報名頁",
  description: "深藍首屏左文右表單卡，附產品儀表板插圖、議程、雙講者與數據，適合 B2B 軟體與產品發表。",
  category: "產品 Demo",
  purposes: ["webinar", "sales"],
  styles: ["professional"],
  preview: { eyebrow: "Webinar", headline: "一頁看懂庫存、訂單與現金流", summary: "雙欄首屏表單卡＋產品畫面", palette: [NAVY, PRIMARY, BG], sectionCount: 8 },
  theme: { typography: { headingFont: "sans-tc", bodyFont: "sans-tc", bodySize: 17, bodyLineHeight: 1.75, textColor: BODY, headingColor: INK, linkColor: LINK }, background: { color: BG } },
  settings: { eventTitle: "看懂你的營運數據：數流 Flowboard 45 分鐘 Demo", scrollReveal: "fade", stickyCta: { enabled: true, label: "預約 Demo 席位", showDate: true, devices: "mobile_tablet", buttonColor: PRIMARY, buttonTextColor: PRIMARY_TEXT, backgroundColor: NAVY } },
  build,
};

