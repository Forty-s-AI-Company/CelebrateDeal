import type { FunnelNode } from "@/lib/funnel-page-document";
import { WEBINAR_TEMPLATE_SAMPLE_MARK, webinarTemplateKit, type WebinarTemplateDefinition } from "./types";

/**
 * 範本 09：職涯價值錨定體驗課報名頁（specs/09-career-value.md）。
 * 台灣課程平台風格：淺藍灰底、白色「課程資訊卡」是視覺重心（原價刪除線 → 本場免費、
 * 倒數與表單），往下是情境清單、3 步驟、收據式的參加禮與講者經歷。
 * 價格與價值都只是展示文字，不接任何商品或結帳（shared-components.md C-11）。
 */
const ART = "/funnel-illustrations/webinar/09";
const BG = "#f4f7fb";
const CARD = "#ffffff";
const INK = "#0d2340";
const BODY = "#33435a";
const PRIMARY = "#0b63ce";
const HIGHLIGHT = "#ffcc33";
const LINE = "#d5dde8";

function build(prefix: string) {
  const { node, section, columns2, stack, headline, text, button, form } = webinarTemplateKit(prefix);
  const blueButton = { backgroundColor: PRIMARY, color: "#ffffff", borderRadius: 10, fontSize: 18 } as const;
  const card = { backgroundColor: CARD, borderColor: LINE, borderWidth: 1, borderRadius: 16, shadow: "medium", padding: 32 } as const;
  const h2 = (id: string, value: string, mobileText?: string) => headline(id, value, "h2", { color: INK, fontSize: 32, lineHeight: 1.3 }, { tablet: { style: { fontSize: 30 } }, mobile: { style: { fontSize: 24 }, ...(mobileText ? { props: { text: mobileText } } : {}) } });
  const badge = (id: string, value: string) => text(id, value, "small", { color: INK, backgroundColor: HIGHLIGHT, borderRadius: 6, padding: "4px 12px", width: "fit-content", fontSize: 15 });
  /** 課程資訊卡：時間、原價刪除線 → 本場免費、倒數與報名表。上下兩張共用，只有 id 與錨點不同。 */
  const infoCard = (id: string, htmlId: string): FunnelNode[] => [
    badge(`${id}_badge`, "本場免費・線上直播"),
    headline(`${id}_title`, "3 步驟找出你的可轉移能力", "h3", { color: INK }),
    node(`${id}_facts`, "event_facts", { layout: "grid", formatLabel: "線上直播", showDuration: true, accentColor: PRIMARY }, undefined, { color: INK }),
    node(`${id}_price`, "value_stack", {
      items: [{ title: "60 分鐘直播體驗課", text: "含直播 Q&A 與 3 份參加禮", value: "NT$1,980" }],
      originalPrice: "NT$1,980", offerLabel: "本場免費", note: "原價為講者自訂參考，本場免費參加。",
      accentColor: PRIMARY, cardColor: "#f8fbff", cardTextColor: INK,
    }, undefined, { textAlign: "left" }),
    node(`${id}_countdown`, "countdown", { variant: "inline", source: "webinar_start", label: "距離開課", numberColor: PRIMARY }, undefined, { color: INK }),
    node(`${id}_deadline`, "deadline_notice", { label: "報名截止", closedText: "本場報名已截止，歡迎留意下一場", accentColor: PRIMARY }, undefined, { color: INK }),
    form(`${id}_form`, {
      fields: [
        { name: "name", label: "姓名", placeholder: "王小明", required: true },
        { name: "email", label: "Email", type: "email", placeholder: "name@example.com", required: true },
        { name: "phone", label: "手機", type: "tel", placeholder: "0912-345-678", helpText: "開課前一天以簡訊提醒（選填）" },
      ],
      submitLabel: "免費報名體驗課",
      submitStyle: blueButton,
      note: "報名即表示同意接收本場體驗課相關通知，可隨時取消訂閱。",
      htmlId,
      style: { color: INK, textAlign: "left" },
    }),
  ];
  return [
    // 1. 公告條（開課倒數）。
    node("announce", "announcement_bar", { text: "60 分鐘線上體驗課・本場免費｜{{webinar.date}}", showCountdown: true, countdownLabel: "距離開課", barColor: INK, barTextColor: "#ffffff" }),
    // 2. 首屏：左標題與講者，右課程資訊卡（手機：標題 → 資訊卡 → 講者）。
    section("hero", [
      columns2("hero_columns", stack("hero_copy", [
          text("hero_eyebrow", "轉職體驗課｜線上直播 60 分鐘", "eyebrow", { color: PRIMARY }),
          headline("hero_title", "投了 50 封履歷沒回音？\n先找出你真正能帶走的能力", "h1", { color: INK, fontSize: 46, lineHeight: 1.25 }, { tablet: { style: { fontSize: 40 } }, mobile: { style: { fontSize: 28, lineHeight: 1.3 }, props: { text: "投了 50 封履歷沒回音？先找出你能帶走的能力" } } }),
          text("hero_lead", "60 分鐘體驗課，用 3 個步驟把過去的經驗，翻譯成新產業看得懂的語言。", "lead", { color: BODY }),
          // 手機的資訊卡在標題下方較遠處：首屏另給一顆捲到表單的按鈕（L-7）。
          button("hero_jump", "免費報名體驗課", "#register", blueButton, { desktop: { visible: false }, tablet: { visible: false }, mobile: { visible: true } }),
          text("hero_points", "✓ 不用先改履歷，帶著工作經驗來就好\n✓ 直播中示範 2 份真實改寫案例（匿名）\n✓ 參加就送可轉移能力盤點表", undefined, { color: INK, lineHeight: 1.9 }),
          text("hero_speaker", "主講｜吳佩珊　職涯教練・前科技業人資主管", "small", { color: BODY }, { mobile: { visible: false } }),
        ], 22, { padding: "8px 0 0" }), stack("hero_card", infoCard("hero_card", "register"), 18, card, { mobile: { style: { padding: 16 } } }), { ratio: "7:5", gap: 56, stackOn: "tablet", align: "center" }),
      text("hero_speaker_mobile", "主講｜吳佩珊　職涯教練・前科技業人資主管", "small", { color: BODY }, { desktop: { visible: false }, tablet: { visible: false }, mobile: { visible: true } }),
    ], { background: BG, color: BODY, maxWidth: 1120, gap: 20, paddingY: 72, paddingYTablet: 56, paddingYMobile: 32 }),
    // 3. 這些情況你中了幾個。
    section("pain", [
      h2("pain_title", "這些情況，你中了幾個？"),
      stack("pain_card", [
        node("pain_list", "icon_list", { layout: "list", numbered: false, accentColor: PRIMARY, items: [
          { icon: "check", title: "想轉職，但不知道自己能做什麼", text: "" },
          { icon: "check", title: "面試時，講不出自己的價值", text: "" },
          { icon: "check", title: "履歷寫得像工作日誌", text: "" },
          { icon: "check", title: "擔心年齡成為轉職的阻礙", text: "" },
          { icon: "check", title: "不確定該不該再花錢進修", text: "" },
        ] }, undefined, { color: INK }),
      ], 0, { ...card, shadow: "soft" }, { mobile: { style: { padding: 22 } } }),
      text("pain_note", "中了 2 個以上，這堂體驗課就是為你準備的。", undefined, { color: PRIMARY, textAlign: "center", fontSize: 18 }),
    ], { background: CARD, color: BODY, maxWidth: 640, gap: 28, align: "center" }),
    // 4. 3 步驟方法。
    section("method", [
      text("method_eyebrow", "直播會教的方法", "eyebrow", { color: PRIMARY, textAlign: "center" }),
      h2("method_title", "3 個步驟，把經驗翻譯成新產業的語言", "3 步驟，把經驗翻譯成新產業的語言"),
      stack("method_panel", [
        node("method_list", "icon_list", { layout: "grid", columns: 3, numbered: true, accentColor: PRIMARY, items: [
          { icon: "compass", title: "盤點", text: "列出你做過的事，找出背後真正的能力，而不是職稱。" },
          { icon: "message", title: "翻譯", text: "把能力換成目標產業的關鍵字與成果描述。" },
          { icon: "check", title: "驗證", text: "用職缺與資訊訪談檢查方向，再決定要不要進修。" },
        ] }, undefined, { color: INK, textAlign: "left" }),
      ], 0, { ...card, shadow: "soft", padding: 40 }, { mobile: { style: { padding: 22 } } }),
    ], { background: BG, color: BODY, maxWidth: 1120, gap: 24, align: "center" }),
    // 5. 參加就送（收據式價值清單，純展示）。
    section("gift", [
      h2("gift_title", "準時參加，就送你這 4 份資料"),
      node("gift_stack", "value_stack", {
        title: "參加就送",
        items: [
          { title: "可轉移能力盤點表", text: "一步一步列出你的經驗與能力。", value: "NT$680" },
          { title: "履歷改寫範例", text: "3 種產業的前後對照（匿名）。", value: "NT$880" },
          { title: "面試自我介紹框架", text: "60 秒講清楚你為什麼適合。", value: "NT$580" },
          { title: "直播限定 Q&A", text: "直播中直接問講師你的狀況。", value: "NT$1,200" },
        ],
        totalLabel: "總價值", totalValue: "NT$3,340", offerLabel: "報名即可免費領取",
        note: "價值為講者自訂參考，非售價承諾。",
        accentColor: PRIMARY, cardColor: CARD, cardTextColor: INK,
      }, undefined, { textAlign: "left" }),
      button("gift_cta", "免費報名，領取 4 份資料", "#register", blueButton),
    ], { background: CARD, color: BODY, maxWidth: 720, gap: 28, align: "center" }),
    // 6. 講者經歷。
    section("speaker", [
      text("speaker_eyebrow", "關於講師", "eyebrow", { color: PRIMARY, textAlign: "center" }),
      h2("speaker_title", "從人資主管的桌子另一側，告訴你企業在看什麼"),
      node("speaker_card", "speaker_profiles", { layout: "featured", photoShape: "portrait", accentColor: PRIMARY, items: [
        { photo: `${ART}/speaker.svg`, alt: "講師吳佩珊的照片（請替換）", name: "吳佩珊", role: "職涯教練・前科技業人資主管", bio: "在科技業負責招募與人才發展十餘年，看過上萬份履歷。現在專注陪伴想轉換跑道的上班族，把過去的經驗整理成下一份工作的籌碼。", tags: "招募面試官,職涯教練" },
      ] }, undefined, { color: INK, textAlign: "left" }),
      node("speaker_stats", "stats", { animate: true, framed: false, accentColor: PRIMARY, items: [
        { value: "10000", suffix: "+", label: `看過的履歷（${WEBINAR_TEMPLATE_SAMPLE_MARK}）` },
        { value: "1500", suffix: "+", label: `陪伴轉職學員（${WEBINAR_TEMPLATE_SAMPLE_MARK}）` },
        { value: "4.9", suffix: "/5", label: `課程滿意度（${WEBINAR_TEMPLATE_SAMPLE_MARK}）` },
      ] }, undefined, { color: INK }),
    ], { background: BG, color: BODY, maxWidth: 1000, gap: 32, align: "center" }),
    // 7. 學員評價（格狀，不輪播）。
    section("reviews", [
      h2("reviews_title", "上過體驗課的人怎麼說"),
      node("reviews_wall", "testimonial_wall", { layout: "carousel", columns: 3, autoplay: false, showRating: true, accentColor: PRIMARY, cardColor: CARD, cardTextColor: INK, items: [
        { name: "學員 A｜行政轉行銷", rating: 5, title: `終於知道履歷該寫什麼（${WEBINAR_TEMPLATE_SAMPLE_MARK}）`, text: "以前只寫做了哪些事，現在會寫帶來什麼結果。改完履歷後開始收到面試邀請。" },
        { name: "學員 B｜工程師轉產品", rating: 5, title: `面試不再卡住（${WEBINAR_TEMPLATE_SAMPLE_MARK}）`, text: "自我介紹框架很好用，被問到為什麼轉職時，終於能講出有說服力的答案。" },
        { name: "學員 C｜餐飲轉客服", rating: 5, title: `不用再焦慮年齡（${WEBINAR_TEMPLATE_SAMPLE_MARK}）`, text: "盤點完才發現自己有很多能帶走的能力，對轉職這件事有信心多了。" },
        { name: "學員 D｜業務轉人資", rating: 5, title: `把經驗翻成對方聽得懂的話（${WEBINAR_TEMPLATE_SAMPLE_MARK}）`, text: "翻譯步驟讓我發現銷售經驗在招募工作也用得上，面試時我用新的說法介紹自己，反應很不一樣。" },
        { name: "學員 E｜設計轉 PM", rating: 4, title: `知道下一步該驗證什麼（${WEBINAR_TEMPLATE_SAMPLE_MARK}）`, text: "資訊訪談的建議很實際，我約了三位現職的人聊，才確定自己是真的想轉，而不是只是想逃離現況。" },
        { name: "學員 F｜教師轉培訓", rating: 5, title: `不再覺得從零開始（${WEBINAR_TEMPLATE_SAMPLE_MARK}）`, text: "盤點表幫我把教學經驗拆成專案管理與溝通能力，整份履歷的重點都變得更清楚。" },
      ] }, undefined, { textAlign: "left" }),
    ], { background: CARD, color: BODY, maxWidth: 1120, gap: 32, align: "center" }),
    // 8. 注意事項。
    section("notice", [
      node("notice_callout", "callout", { tone: "info", title: "報名前請留意", text: "報名人數未達主辦單位設定的開課門檻時，保留延期的權利，並會以 Email 通知。\n\n直播連結會在開課前一天寄出，請確認信箱填寫正確。" }, undefined, { textAlign: "left" }),
    ], { background: BG, color: BODY, maxWidth: 720, paddingY: 56, paddingYMobile: 40 }),
    // 9. 再次報名（資訊卡複製）。
    section("register", [
      h2("register_title", "把這 60 分鐘，留給下一份工作"),
      stack("register_card", infoCard("register_card", "register_bottom"), 18, card, { mobile: { style: { padding: 16 } } }),
    ], { background: BG, color: BODY, maxWidth: 560, gap: 28, align: "center", paddingY: 64 }),
    // 10. FAQ。
    section("faq", [
      h2("faq_title", "常見問題"),
      node("faq_list", "faq", { items: [
        { question: "體驗課後會推銷正式課程嗎？", answer: "會。直播最後約 10 分鐘會介紹正式課程，是否參加由你決定；不報名也能帶走全部參加禮。" },
        { question: "沒辦法準時參加，有回放嗎？", answer: "依主辦單位的回放設定，報名後會收到回放資訊；直播限定 Q&A 只在直播中進行。" },
        { question: "適合應屆畢業生嗎？", answer: "適合。盤點方法同樣適用於社團、實習與打工經驗。" },
        { question: "需要先準備好履歷嗎？", answer: "不用。帶著你目前的工作經驗來就好，直播中會一起盤點。" },
      ] }, undefined, { textAlign: "left", color: INK }),
    ], { background: CARD, color: BODY, maxWidth: 760, gap: 28, align: "center" }),
  ];
}

export const template: WebinarTemplateDefinition = {
  id: "webinar-career-value",
  number: 9,
  name: "職涯價值錨定體驗課報名頁",
  description: "課程平台風格的免費體驗課頁：課程資訊卡（原價→本場免費、倒數、表單）、3 步驟與收據式參加禮。",
  category: "職涯講座",
  purposes: ["webinar", "sales"],
  styles: ["professional"],
  preview: { eyebrow: "Webinar", headline: "職涯價值錨定體驗課報名頁", summary: "白色課程資訊卡＋本場免費", palette: [BG, PRIMARY, HIGHLIGHT], sectionCount: 10 },
  theme: { typography: { headingFont: "sans-tc", bodyFont: "sans-tc", bodySize: 17, bodyLineHeight: 1.75, textColor: BODY, headingColor: INK, linkColor: PRIMARY }, background: { color: BG } },
  settings: {
    eventTitle: "轉職不再亂投履歷：3 步驟找出你的可轉移能力",
    scrollReveal: "fade",
    stickyCta: { enabled: true, label: "本場免費・立即報名", showDate: true, devices: "mobile_tablet", buttonColor: PRIMARY, buttonTextColor: "#ffffff", backgroundColor: CARD },
  },
  build,
};
