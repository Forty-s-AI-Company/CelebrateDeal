import { WEBINAR_TEMPLATE_SAMPLE_MARK, webinarTemplateKit, type WebinarTemplateDefinition } from "./types";

/**
 * 範本 05：房地產倒數主導報名頁（specs/05-realestate-countdown.md）。
 * 深綠底＋淡金色城市天際線，正中央的金色大倒數是視覺焦點，表單緊接其後；
 * 白底內容區講三個判斷、附資料來源欄位的市場數據、講座流程與講者，最後回到深綠底的第二個倒數收尾。
 */
const ART = "/funnel-illustrations/webinar/05";
const BAND = "#0f2a22";
const BAND_CELL = "#173d31";
const BAND_INK = "#f2f5f3";
const BAND_BODY = "#c9d6cf";
const BAND_MUTED = "#9fb3a9";
const PRIMARY = "#f2b84b";
const ACCENT = "#7fd1a8";
const WHITE = "#ffffff";
const SOFT = "#f3f7f4";
const LINE = "#dbe6df";
const INK = "#13201b";
const BODY = "#3b4a43";
const ACCENT_LIGHT = "#2f7d5b";

function build(prefix: string) {
  const { node, section, stack, headline, text, button, form } = webinarTemplateKit(prefix);
  const cta = { backgroundColor: PRIMARY, color: INK, borderRadius: 10, fontSize: 18 } as const;
  const heading = (id: string, eyebrow: string, value: string) => stack(`${id}_heading`, [
    text(`${id}_eyebrow`, eyebrow, "eyebrow", { color: ACCENT_LIGHT }),
    headline(`${id}_title`, value, "h2", { color: INK, fontSize: 34, lineHeight: 1.3 }, { mobile: { style: { fontSize: 24, lineHeight: 1.35 } } }),
  ], 10, { textAlign: "center" });
  const step = (id: string, label: string, name: string, body: string) => stack(id, [
    text(`${id}_time`, label, "eyebrow", { color: ACCENT_LIGHT, letterSpacing: 1, fontSize: 14 }),
    headline(`${id}_title`, name, "h3", { color: INK, fontSize: 21 }, { mobile: { style: { fontSize: 19 } } }),
    text(`${id}_text`, body, undefined, { color: BODY, fontSize: 16 }),
  ], 8, { backgroundColor: WHITE, borderColor: LINE, borderWidth: 1, borderRadius: 14, padding: 24 });

  return [
    // 1. 首屏：標題 → 大倒數 → 活動資訊與截止提示 → 表單（單欄置中）。
    section("hero", [
      text("hero_eyebrow", "免費線上說明會｜限本場", "eyebrow", { color: ACCENT }),
      headline("hero_title", "買房前先算清楚：\n預算、貸款與地段的 3 個判斷", "h1", { color: BAND_INK, fontSize: 48, lineHeight: 1.25 }, {
        tablet: { style: { fontSize: 40 } },
        mobile: { style: { fontSize: 30, lineHeight: 1.3 }, props: { text: "看房前必做的 3 個判斷" } },
      }),
      text("hero_lead", "90 分鐘，帶你用一張表算出自己真正買得起的總價。", "lead", { color: BAND_BODY }),
      node("hero_countdown", "countdown", { variant: "blocks", source: "webinar_start", label: "距離開播", liveText: "直播進行中，立即進入", replayText: "回放限時開放中", expiredText: "本場說明會已結束", align: "center", numberColor: PRIMARY, cellColor: BAND_CELL, accentColor: ACCENT }, undefined, { color: BAND_INK }),
      node("hero_facts", "event_facts", { layout: "row", formatLabel: "線上說明會", priceLabel: "免費", showDuration: false, accentColor: ACCENT, align: "center" }, undefined, { color: BAND_INK }),
      node("hero_deadline", "deadline_notice", { label: "報名截止", closedText: "本場報名已截止，留下 Email 可收到下一場通知。", accentColor: PRIMARY }, undefined, { color: BAND_INK }),
      form("hero_form", {
        title: "保留說明會席位",
        fields: [
          { name: "name", label: "姓名", placeholder: "王小明", required: true, half: true },
          { name: "email", label: "Email", type: "email", placeholder: "name@example.com", required: true, half: true },
          { name: "phone", label: "手機（選填）", type: "tel", placeholder: "0912-345-678" },
        ],
        submitLabel: "保留說明會席位",
        submitStyle: cta,
        note: "報名後寄送直播連結與預算試算表，可隨時取消訂閱。",
        htmlId: "register",
        style: { backgroundColor: WHITE, color: INK, padding: 32, borderRadius: 16, shadow: "strong", textAlign: "left", width: "min(100%, 600px)", margin: "8px auto 0" },
        mobile: { style: { padding: 20 } },
      }),
    ], { background: BAND, color: BAND_BODY, maxWidth: 760, gap: 22, align: "center", paddingY: 80, paddingYMobile: 36, props: { backgroundImage: `${ART}/skyline.svg`, backgroundPosition: "bottom" } }),

    // 2. 三個判斷（核心內容）。
    section("judgements", [
      heading("judgements", "THE 3 CHECKS", "看房之前，先做這 3 個判斷"),
      stack("judgements_panel", [
        node("judgements_list", "icon_list", { layout: "grid", columns: 3, numbered: true, accentColor: ACCENT_LIGHT, items: [
          { icon: "target", title: "先算月付上限，再看總價", text: "用收入與生活支出，倒推出你每個月付得起的房貸金額。" },
          { icon: "shield", title: "貸款成數與寬限期的取捨", text: "成數越高、寬限期越長，未來的壓力會落在哪一年？" },
          { icon: "compass", title: "用生活機能評分表看地段", text: "交通、學區、採買與醫療，用分數比較，而不是靠感覺。" },
        ] }, undefined, { color: BODY, textAlign: "left" }),
      ], 0, { backgroundColor: WHITE, borderColor: LINE, borderWidth: 1, borderRadius: 14, padding: 36, shadow: "soft" }, { mobile: { style: { padding: 22 } } }),
    ], { background: SOFT, color: BODY, maxWidth: 1120, gap: 44 }),

    // 3. 市場數據（範本示意，每一項都附資料來源欄位）。
    section("market", [
      heading("market", "MARKET FACTS", "首購前，你該知道的 3 個數字"),
      node("market_stats", "stats", { animate: true, accentColor: ACCENT_LIGHT, items: [
        { value: "30", suffix: "年", label: "首購族常見貸款年期\n資料來源：請填入（範本示意）" },
        { value: "33", suffix: "%", label: "房貸負擔率參考值\n資料來源：請填入（範本示意）" },
        { value: "12", suffix: "次", label: "成交前平均看房次數\n資料來源：請填入（範本示意）" },
      ] }, undefined, { color: BODY }),
      text("market_note", `以上數據為${WEBINAR_TEMPLATE_SAMPLE_MARK}，發布前請替換為可查證的公開資料並註明來源。`, "small", { color: BODY, textAlign: "center" }),
    ], { background: WHITE, color: BODY, maxWidth: 1000, gap: 40 }),

    // 4. 講座流程（4 段）。
    section("agenda", [
      heading("agenda", "AGENDA", "90 分鐘講座流程"),
      node("agenda_steps", "columns_4", { gap: 20 }, [
        step("agenda_budget", "STEP 1｜0–25 分", "預算試算", "現場帶你填一次預算表，算出月付上限與可負擔總價。"),
        step("agenda_loan", "STEP 2｜25–50 分", "貸款比較", "比較不同成數、年期與寬限期，看懂總利息差多少。"),
        step("agenda_area", "STEP 3｜50–75 分", "地段評分", "用生活機能評分表，比較兩個候選區域。"),
        step("agenda_qa", "STEP 4｜75–90 分", "Q&A", "現場回答你的看房與貸款問題。"),
      ], { align: "stretch" }),
    ], { background: SOFT, color: BODY, maxWidth: 1120, gap: 40 }),

    // 5. 講者
    section("speaker", [
      heading("speaker", "YOUR HOST", "帶你算清楚的人"),
      node("speaker_card", "speaker_profiles", { layout: "featured", photoShape: "portrait", accentColor: ACCENT_LIGHT, items: [
        { photo: `${ART}/speaker.svg`, alt: "講者照片（請替換）", name: "王子豪", role: "不動產經紀人・「好宅研究室」主持人", bio: `陪 500 組首購族看過房（${WEBINAR_TEMPLATE_SAMPLE_MARK}數據）。經紀人證書字號：（請填入）。相信買房最重要的不是搶到物件，而是先知道自己買得起什麼。`, tags: "首購規劃,房貸試算,地段分析" },
      ] }, undefined, { color: BODY }),
    ], { background: WHITE, color: BODY, maxWidth: 1000, gap: 40 }),

    // 6. 第二個倒數＋CTA（深綠底收尾）。
    section("closing", [
      headline("closing_title", "開播前，把你的席位留下來", "h2", { color: BAND_INK, fontSize: 34, lineHeight: 1.3 }, { mobile: { style: { fontSize: 24 } } }),
      node("closing_countdown", "countdown", { variant: "inline", source: "webinar_start", label: "距離開播還有", liveText: "直播進行中，立即進入", replayText: "回放限時開放中", expiredText: "本場說明會已結束", align: "center", numberColor: PRIMARY, accentColor: ACCENT }, undefined, { color: BAND_INK }),
      text("closing_date", "{{webinar.startAt}}｜線上說明會・免費", undefined, { color: BAND_BODY }),
      button("closing_button", "保留說明會席位", "#register", { ...cta, padding: "16px 40px" }),
      text("closing_note", "不推銷建案，只教你判斷。", "small", { color: BAND_MUTED }),
    ], { background: BAND, color: BAND_BODY, maxWidth: 760, gap: 20, align: "center", paddingY: 96, paddingYMobile: 64, props: { backgroundImage: `${ART}/skyline.svg`, backgroundPosition: "bottom" } }),

    // 7. FAQ
    section("faq", [
      heading("faq", "FAQ", "常見問題"),
      node("faq_list", "faq", { items: [
        { question: "說明會會推銷建案嗎？", answer: "不會。內容只談判斷方法，不介紹任何特定建案或物件。" },
        { question: "需要準備什麼資料？", answer: "大約的月收入、每月固定支出與目前存款即可，現場會帶你填。" },
        { question: "有回放嗎？", answer: "依主辦單位的回放設定，報名者會在信中收到回放資訊。" },
        { question: "試算表怎麼拿？", answer: "報名成功信會附上下載連結，說明會中也會再提供一次。" },
      ] }, undefined, { color: BODY, textAlign: "left" }),
    ], { background: WHITE, color: BODY, maxWidth: 720, gap: 32 }),
  ];
}

export const template: WebinarTemplateDefinition = {
  id: "webinar-realestate-countdown",
  number: 5,
  name: "房地產倒數主導報名頁",
  description: "深綠底與城市天際線、金色大倒數置中的說明會報名頁，附截止提示、市場數據與第二個倒數。",
  category: "房地產說明會",
  purposes: ["webinar"],
  styles: ["professional"],
  preview: { eyebrow: "Webinar", headline: "買房前先算清楚的 3 個判斷", summary: "大倒數首屏＋表單", palette: [BAND, PRIMARY, WHITE], sectionCount: 7 },
  theme: { typography: { headingFont: "sans-tc", bodyFont: "sans-tc", bodySize: 17, bodyLineHeight: 1.75, textColor: BODY, headingColor: INK, linkColor: ACCENT_LIGHT }, background: { color: WHITE } },
  settings: { eventTitle: "首購族看房前必修：預算、貸款與地段的 3 個判斷", scrollReveal: "fade", stickyCta: { enabled: true, label: "保留席位", showDate: true, devices: "mobile_tablet", buttonColor: PRIMARY, buttonTextColor: INK, backgroundColor: BAND } },
  build,
};
