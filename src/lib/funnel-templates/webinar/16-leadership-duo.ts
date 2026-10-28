import { WEBINAR_TEMPLATE_SAMPLE_MARK, webinarTemplateKit, type WebinarTemplateDefinition } from "./types";

/**
 * 範本 16：領導力雙講者對談報名頁（specs/16-leadership-duo.md）。
 * 雜誌對談風：白底、沙色區塊、酒紅點綴、襯線標題；首屏是兩位講者對稱的半身像與「×」。
 * 講者、Logo 與經歷都是虛構示意；照片是 public/funnel-illustrations/webinar/16/ 的替換佔位圖。
 */
const ART = "/funnel-illustrations/webinar/16";
const BG = "#ffffff";
const SAND = "#f3efe8";
const INK = "#111827";
const BODY = "#374151";
const MUTED = "#6b7280";
const PRIMARY = "#7a1f2b";
const ACCENT = "#8a6a3b";
const HAIRLINE = "#e4ddd1";
/** Darker bronze and grey for small text on sand (accent／muted on sand are just under 4.5:1). */
const ACCENT_ON_SAND = "#76582c";
const MUTED_ON_SAND = "#5b6170";

const SPEAKER_A = { name: "鄧文彥", role: "前外商營運總監" };
const SPEAKER_B = { name: "羅以琳", role: "組織心理顧問" };

function build(prefix: string) {
  const { node, section, columns2, stack, headline, text, button, form } = webinarTemplateKit(prefix);
  const primaryButton = { backgroundColor: PRIMARY, color: "#ffffff", borderRadius: 2, letterSpacing: 2, padding: "16px 40px" } as const;
  const title = (id: string, eyebrow: string, value: string, subtitle = "") => node(id, "section_title", { eyebrow, title: value, subtitle, level: "h2", decoration: "line", accentColor: PRIMARY }, undefined, { color: INK, textAlign: "center" });

  // 3. 兩種觀點：引號、語錄、署名；兩欄之間用細線卡片分隔。
  const viewpoint = (id: string, label: string, quote: string, by: string, background: string) => stack(id, [
    text(`${id}_label`, label, "eyebrow", { color: background === SAND ? ACCENT_ON_SAND : ACCENT }),
    text(`${id}_mark`, "“", undefined, { color: background === SAND ? ACCENT_ON_SAND : ACCENT, fontSize: 88, lineHeight: 0.6, margin: "24px 0 0" }, { mobile: { style: { fontSize: 64, margin: "16px 0 0" } } }),
    text(`${id}_quote`, quote, undefined, { color: INK, fontSize: 24, lineHeight: 1.65 }, { mobile: { style: { fontSize: 19, lineHeight: 1.7 } } }),
    text(`${id}_by`, by, "small", { color: background === SAND ? MUTED_ON_SAND : MUTED, letterSpacing: 1 }),
  ], 16, { padding: "40px 40px 36px", backgroundColor: background, borderColor: HAIRLINE, borderWidth: 1, height: "100%" }, { mobile: { style: { padding: "28px 24px" } } });

  return [
    // 1. 首屏：兩位講者對稱半身像＋「×」，標題、資訊列與 CTA 置中在下方。
    section("hero", [
      node("hero_duo", "speaker_profiles", {
        layout: "duo", photoShape: "portrait", accentColor: PRIMARY,
        items: [
          { photo: `${ART}/speaker-a.svg`, alt: `${SPEAKER_A.name}的照片（替換講者照片，建議同樣構圖）`, name: SPEAKER_A.name, role: SPEAKER_A.role },
          { photo: `${ART}/speaker-b.svg`, alt: `${SPEAKER_B.name}的照片（替換講者照片，建議同樣構圖）`, name: SPEAKER_B.name, role: SPEAKER_B.role },
        ],
      }, undefined, { color: INK }, { mobile: { visible: false } }),
      // 手機：C-02 duo 會上下堆疊，改用並排的雙人照（各 50%、4:5），姓名職稱放在照片下方。
      node("hero_duo_mobile", "image", { src: `${ART}/duo-mobile.svg`, alt: `${SPEAKER_A.name}與${SPEAKER_B.name}的照片（替換為兩位講者同樣構圖的照片）` }, undefined, { imageWidth: 100 }, { desktop: { visible: false }, mobile: { visible: true } }),
      text("hero_names_mobile", `${SPEAKER_A.name}｜${SPEAKER_A.role}
× ${SPEAKER_B.name}｜${SPEAKER_B.role}`, "small", { color: BODY, fontSize: 15 }, { desktop: { visible: false }, mobile: { visible: true } }),
      text("hero_eyebrow", "線上對談｜90 分鐘｜免費", "eyebrow", { color: PRIMARY, letterSpacing: 4, margin: "16px 0 0" }, { mobile: { style: { margin: "4px 0 0" } } }),
      headline("hero_title", "新手主管的第一年，\n該放手還是親自下場？", "h1", { fontSize: 48, lineHeight: 1.3, color: INK }, { tablet: { style: { fontSize: 40 } }, mobile: { style: { fontSize: 28, lineHeight: 1.35 }, props: { text: "新手主管的第一年，該放手還是親自下場？" } } }),
      text("hero_lead", "一位帶過三百人團隊的營運主管，一位陪伴主管轉型的心理顧問，用 90 分鐘把你最卡的三個問題聊透。", "lead", { color: BODY, width: "min(640px, 100%)", margin: "0 auto" }, { mobile: { visible: false } }),
      node("hero_facts", "event_facts", { layout: "row", formatLabel: "線上直播對談", priceLabel: "免費", accentColor: PRIMARY, align: "center" }, undefined, { color: INK, textAlign: "left" }, { mobile: { style: { fontSize: 18 } } }),
      button("hero_cta", "免費報名對談", "#register", { ...primaryButton, fontSize: 18 }),
    ], { background: BG, color: BODY, maxWidth: 800, gap: 24, align: "center", paddingY: 72, paddingYTablet: 56, paddingYMobile: 28 }),
    // 2. 對談的 3 個題目
    section("topics", [
      title("topics_title", "THREE QUESTIONS", "這場對談，只聊三件事", "每個題目 20 分鐘，兩位講者各自說出真實做法，也說出彼此不同意的地方。"),
      // 3 欄編號題目：用 C-03 steps（襯線大編號）；icon_list 的 3 欄格線在桌機會掉成 2 欄（見 notes/batch-4.md）。
      node("topics_list", "agenda_timeline", { layout: "steps", accentColor: PRIMARY, items: [
        { title: "從專業者變成管理者，最難放下的是什麼", text: "當你還是團隊裡最會做事的人，什麼時候該把工作交出去？" },
        { title: "一對一會談怎麼開才不尷尬", text: "第一次和部屬坐下來，問什麼、聽什麼、會後怎麼追蹤。" },
        { title: "當團隊績效和士氣衝突時", text: "目標壓下來、成員已經很累，主管要先顧哪一邊？" },
      ] }, undefined, { color: INK, textAlign: "left" }),
    ], { background: SAND, color: BODY, maxWidth: 1080, gap: 48, align: "center" }),
    // 3. 兩種觀點（對照）
    section("views", [
      title("views_title", "TWO PERSPECTIVES", "同一個問題，兩種答案"),
      // columns_2 的子節點直接用設計過的 content_box（content_box 不可再巢狀 content_box）。
      node("views_columns", "columns_2", { ratio: "1:1", gap: 0 }, [
        viewpoint("views_a", "觀點 A｜先建立制度", "新手主管最常犯的錯，是用加班補團隊的洞。先把交辦、回報和檢查的節奏定下來，人才有餘裕成長。", `— ${SPEAKER_A.name}，${SPEAKER_A.role}`, SAND),
        viewpoint("views_b", "觀點 B｜先建立關係", "制度能讓事情動起來，信任才能讓人願意多走一步。先花一個月認識每個人想要什麼，再談分工也不遲。", `— ${SPEAKER_B.name}，${SPEAKER_B.role}`, BG),
      ], { align: "stretch" }),
    ], { background: BG, color: BODY, maxWidth: 1080, gap: 48, align: "center" }),
    // 4. 對談流程
    section("flow", [
      title("flow_title", "RUN OF SHOW", "90 分鐘怎麼進行", "時間為開場後經過的時間，實際開播時間見上方活動資訊。"),
      node("flow_agenda", "agenda_timeline", { layout: "vertical", accentColor: PRIMARY, items: [
        { time: "00:00", title: "開場：兩位講者的第一年", text: "各用 5 分鐘說一個自己當新手主管時的失誤。", speaker: `${SPEAKER_A.name}、${SPEAKER_B.name}`, tag: "開場" },
        { time: "00:10", title: "題目一：最難放下的是什麼", text: "交辦的時機、交辦後怎麼不插手。", speaker: `主談：${SPEAKER_A.name}`, tag: "對談" },
        { time: "00:30", title: "題目二：一對一會談", text: "從開場白到會後追蹤，示範一場真實的對話。", speaker: `主談：${SPEAKER_B.name}`, tag: "對談" },
        { time: "00:50", title: "題目三：績效與士氣", text: "兩種觀點正面交鋒，各自說出底線在哪裡。", speaker: `${SPEAKER_A.name} × ${SPEAKER_B.name}`, tag: "對談" },
        { time: "01:10", title: "觀眾提問", text: "從報名時收到的問題中挑選回答，也開放直播留言。", speaker: "全體", tag: "Q&A" },
      ] }, undefined, { color: INK, textAlign: "left" }),
    ], { background: SAND, color: BODY, maxWidth: 800, gap: 48, align: "center" }),
    // 5. 講者完整介紹
    section("speakers", [
      title("speakers_title", "THE SPEAKERS", "今晚的兩位講者"),
      columns2("speakers_columns", [
        node("speakers_a", "speaker_profiles", { layout: "featured", size: "small", photoShape: "circle", accentColor: PRIMARY, items: [
          { photo: `${ART}/speaker-a.svg`, alt: `${SPEAKER_A.name}的照片（請替換）`, name: SPEAKER_A.name, role: SPEAKER_A.role, tags: "營運管理,跨國團隊,接班規劃", bio: "曾在外商負責亞太區營運，帶領超過三百人的團隊（範本示意經歷）。現在協助中小企業建立主管培訓制度，相信好的流程能讓人少吃苦。" },
        ] }, undefined, { color: INK }),
      ], [
        node("speakers_b", "speaker_profiles", { layout: "featured", size: "small", photoShape: "circle", accentColor: PRIMARY, items: [
          { photo: `${ART}/speaker-b.svg`, alt: `${SPEAKER_B.name}的照片（請替換）`, name: SPEAKER_B.name, role: SPEAKER_B.role, tags: "組織心理,主管教練,團隊溝通", bio: "諮商心理背景，長期陪伴新任主管度過轉型期（範本示意經歷）。專長是把團隊裡說不出口的情緒，變成可以討論的議題。" },
        ] }, undefined, { color: INK }),
      ], { ratio: "1:1", gap: 48 }),
    ], { background: BG, color: BODY, maxWidth: 1000, gap: 48, align: "center" }),
    // 6. 曾任職／合作單位
    section("logos", [
      node("logos_strip", "logo_strip", { title: `曾任職與合作的單位（${WEBINAR_TEMPLATE_SAMPLE_MARK}）`, tone: "grayscale", logoHeight: 34, items: [
        { src: `${ART}/logo-meridian.svg`, alt: "MERIDIAN CONSULTING（示意 Logo）" },
        { src: `${ART}/logo-oakline.svg`, alt: "Oakline（示意 Logo）" },
        { src: `${ART}/logo-hexa.svg`, alt: "HEXA·LAB（示意 Logo）" },
        { src: `${ART}/logo-northgate.svg`, alt: "北門管理學會（示意 Logo）" },
        { src: `${ART}/logo-velora.svg`, alt: "Velora GROUP（示意 Logo）" },
      ] }, undefined, { color: MUTED }),
    ], { background: BG, color: MUTED, maxWidth: 1080, paddingY: 48, paddingYTablet: 40, paddingYMobile: 40 }),
    // 7. 報名表＋「想問講者的問題」選填欄
    section("register", [
      title("register_title", "RESERVE YOUR SEAT", "留一個位置給自己", "報名後寄送直播連結。你的問題會在對談前交給兩位講者。"),
      form("register_form", {
        fields: [
          { name: "name", label: "姓名", placeholder: "王小明", required: true },
          { name: "email", label: "Email", type: "email", placeholder: "name@example.com", required: true, helpText: "直播連結會寄到這個信箱" },
          { name: "question", label: "你最想問講者的問題", placeholder: "例如：部屬比我資深，要怎麼交辦？", helpText: "選填，會在對談前交給講者" },
        ],
        submitLabel: "免費報名對談",
        submitStyle: { ...primaryButton, fontSize: 18 },
        note: "免費參加・可隨時取消訂閱",
        htmlId: "register",
        style: { backgroundColor: BG, padding: 40, borderColor: HAIRLINE, borderWidth: 1, color: INK, textAlign: "left", width: 100 },
        mobile: { style: { padding: 16 } },
      }),
    ], { background: SAND, color: BODY, maxWidth: 560, gap: 36, align: "center" }),
    // 8. FAQ
    section("faq", [
      title("faq_title", "FAQ", "常見問題"),
      node("faq_list", "faq", { items: [
        { question: "可以匿名提問嗎？", answer: "可以。報名表的問題欄位是選填，講者回答時不會念出提問者姓名；直播中也可以用暱稱留言。" },
        { question: "有回放嗎？", answer: "依主辦單位的回放設定，報名者會收到回放連結與開放期限。" },
        { question: "我已經當了好幾年主管，也適合參加嗎？", answer: "適合。對談會談到帶領資深部屬與主管之間的溝通，很多資深主管會用這場對談重新檢視自己的做法。" },
        { question: "會提供簡報嗎？", answer: "對談以討論為主，結束後會寄送兩位講者整理的重點筆記。" },
      ] }, undefined, { textAlign: "left", color: BODY }),
    ], { background: BG, color: BODY, maxWidth: 760, gap: 40, align: "center" }),
  ];
}

export const template: WebinarTemplateDefinition = {
  id: "webinar-leadership-duo",
  number: 16,
  name: "領導力雙講者對談",
  description: "雜誌對談風的雙講者報名頁：首屏兩位講者對稱半身像，兩種觀點並列、對談流程標示講者，報名表收集想問的問題。",
  category: "對談講座",
  purposes: ["webinar"],
  styles: ["professional"],
  preview: { eyebrow: "Webinar", headline: "新手主管的第一年，該放手還是親自下場？", summary: "雙講者對稱首屏＋觀點對照", palette: [BG, PRIMARY, SAND], sectionCount: 8 },
  theme: { typography: { headingFont: "serif-tc", bodyFont: "sans-tc", bodySize: 17, bodyLineHeight: 1.8, textColor: BODY, headingColor: INK, linkColor: PRIMARY }, background: { color: BG } },
  settings: {
    eventTitle: "新手主管的第一年：該放手，還是該親自下場？",
    scrollReveal: "fade",
    stickyCta: { enabled: true, label: "免費報名對談", showDate: true, devices: "mobile_tablet", buttonColor: PRIMARY, buttonTextColor: "#ffffff" },
  },
  build,
};
