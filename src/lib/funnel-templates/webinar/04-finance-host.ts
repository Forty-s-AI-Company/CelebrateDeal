import { WEBINAR_TEMPLATE_SAMPLE_MARK, webinarTemplateKit, type WebinarTemplateDefinition } from "./types";

/**
 * 範本 04：理財講者主視覺報名頁（specs/04-finance-host.md）。
 * 米色底＋深藍色塊上的講者主視覺（佔位圖讓人像出框到色塊上方），襯線標題與銅金點綴的雜誌感；
 * 中段講者故事用深藍底反白，頁尾前放合規的投資風險提示與第二次報名表。
 */
const ART = "/funnel-illustrations/webinar/04";
const CREAM = "#fbf8f3";
const BAND = "#f1e9dc";
const WHITE = "#ffffff";
const INK = "#1c2a39";
const BODY = "#3a4656";
const MUTED = "#5f6b7a";
const PRIMARY = "#0f3b5f";
const COPPER = "#a85a1f";
const GOLD = "#c8a24a";
const DARK_BODY = "#c9d2dc";
const LINE = "#e6dccb";

function build(prefix: string) {
  const { node, section, columns2, stack, headline, text, button, form } = webinarTemplateKit(prefix);
  const cta = { backgroundColor: PRIMARY, color: WHITE, borderRadius: 8, fontSize: 18 } as const;
  const title = (id: string, eyebrow: string, value: string, options: { align?: "left" | "center"; light?: boolean; mobileTitle?: string } = {}) =>
    node(id, "section_title", { eyebrow, title: value, level: "h2", decoration: "line", accentColor: options.light ? GOLD : COPPER }, undefined,
      { color: options.light ? WHITE : INK, ...(options.align ? { textAlign: options.align } : {}) }, options.mobileTitle ? { mobile: { props: { title: options.mobileTitle } } } : {});
  const countdown = (id: string, options: Parameters<typeof node>[5]) => node(id, "countdown", { variant: "blocks", source: "webinar_start", label: "距離開講", liveText: "講座進行中，立即進入", replayText: "回放限時開放中", expiredText: "本場講座已結束", align: "left", numberColor: INK, cellColor: BAND, accentColor: COPPER }, undefined, {}, options);
  const pain = (id: string, name: string, body: string) => stack(id, [
    headline(`${id}_title`, name, "h3", { color: INK, fontSize: 21 }, { mobile: { style: { fontSize: 19 } } }),
    text(`${id}_text`, body, undefined, { color: BODY, fontSize: 16 }),
  ], 8, { backgroundColor: WHITE, borderColor: LINE, borderWidth: 1, borderRadius: 6, padding: 26 });
  const takeaway = (id: string, number: string, name: string, body: string) => stack(id, [
    text(`${id}_number`, number, undefined, { color: COPPER, fontSize: 44, lineHeight: 1.1 }),
    headline(`${id}_title`, name, "h3", { color: INK, fontSize: 22, lineHeight: 1.4 }, { mobile: { style: { fontSize: 19 } } }),
    text(`${id}_text`, body, undefined, { color: BODY, fontSize: 16 }),
  ], 10, { backgroundColor: CREAM, borderColor: LINE, borderWidth: 1, borderRadius: 6, padding: 28 }, { mobile: { style: { padding: 22 } } });

  return [
    // 1. 首屏：左講者主視覺、右文案＋倒數＋表單（手機：寬版主視覺 → 標題 → 資訊列 → 表單 → 倒數）。
    section("hero", [
      columns2("hero_split", [
        node("hero_portrait", "image", { src: `${ART}/hero-portrait.svg`, alt: "講者主視覺（請替換為講者去背照）" }, undefined, { imageWidth: 100 }, { tablet: { props: { src: `${ART}/hero-portrait-wide.svg` } }, mobile: { props: { src: `${ART}/hero-portrait-wide.svg` } } }),
      ], [
        text("hero_eyebrow", "免費線上講座｜週三晚上 8 點", "eyebrow", { color: COPPER }),
        headline("hero_title", "薪水一入帳就分好，\n用 3 個帳戶開始你的資產配置", "h1", { color: INK, fontSize: 48, lineHeight: 1.28 }, {
          tablet: { style: { fontSize: 40 } },
          mobile: { style: { fontSize: 28, lineHeight: 1.32 }, props: { text: "用 3 個帳戶開始資產配置" } },
        }),
        text("hero_host", "主講｜陳柏宇・理財教育講師、「柏宇的錢包筆記」創辦人", undefined, { color: BODY, fontSize: 17 }, { mobile: { style: { fontSize: 16 }, props: { text: "主講｜陳柏宇・理財教育講師" } } }),
        node("hero_facts", "event_facts", { layout: "row", formatLabel: "線上講座", priceLabel: "免費", showDuration: false, accentColor: COPPER }, undefined, { color: INK }, { mobile: { style: { fontSize: 18 } } }),
        countdown("hero_countdown", { mobile: { visible: false } }),
        form("hero_form", {
          fields: [
            { name: "name", label: "姓名", placeholder: "王小明", required: true, half: true },
            { name: "email", label: "Email", type: "email", placeholder: "name@example.com", required: true, half: true },
          ],
          submitLabel: "免費預約講座",
          submitStyle: cta,
          note: "講座內容為理財教育，不構成投資建議。",
          htmlId: "register",
          style: { backgroundColor: WHITE, borderColor: LINE, borderWidth: 1, borderRadius: 10, padding: 24, color: INK, shadow: "medium" },
          mobile: { style: { padding: 18 } },
        }),
        countdown("hero_countdown_mobile", { desktop: { visible: false }, tablet: { visible: false }, mobile: { visible: true } }),
      ], { ratio: "5:7", stackOn: "tablet", gap: 56, align: "center" }),
    ], { background: CREAM, color: BODY, maxWidth: 1160, paddingY: 72, paddingYTablet: 56, paddingYMobile: 24 }),

    // 2. 媒體與合作露出（虛構字標）。
    section("press", [
      node("press_logos", "logo_strip", { title: `媒體與合作露出（${WEBINAR_TEMPLATE_SAMPLE_MARK} Logo）`, tone: "grayscale", logoHeight: 28, items: [
        { src: `${ART}/logo-money.svg`, alt: "錢報週刊（示意 Logo）" },
        { src: `${ART}/logo-ledger.svg`, alt: "THE LEDGER（示意 Logo）" },
        { src: `${ART}/logo-wealth.svg`, alt: "理財生活家（示意 Logo）" },
        { src: `${ART}/logo-pocket.svg`, alt: "Pocket Talk（示意 Logo）" },
        { src: `${ART}/logo-daily.svg`, alt: "日日財經（示意 Logo）" },
      ] }, undefined, { color: MUTED }),
    ], { background: BAND, color: BODY, paddingY: 44, paddingYTablet: 40, paddingYMobile: 32, align: "center" }),

    // 3. 你是否也有這些困擾（2×2）。
    section("pains", [
      title("pains_title", "SOUND FAMILIAR?", "你是否也有這些困擾？", { align: "center" }),
      node("pains_grid", "columns_2", { ratio: "1:1", gap: 20 }, [
        pain("pains_save", "每個月都存不到錢", "薪水明明不低，月底帳戶卻總是見底。"),
        pain("pains_emergency", "不知道預備金要多少", "想存緊急預備金，卻不知道目標是多少。"),
        pain("pains_invest", "想投資又怕虧", "看了很多資訊，還是不敢踏出第一步。"),
        pain("pains_accounts", "帳戶太多管不了", "開了好幾個帳戶，錢在哪裡自己都說不清。"),
      ], { align: "stretch" }),
    ], { background: CREAM, color: BODY, maxWidth: 960, gap: 40 }),

    // 4. 這堂課你會帶走（3 欄，銅色大數字）。
    section("takeaways", [
      title("takeaways_title", "WHAT YOU'LL TAKE HOME", "這堂課，你會帶走"),
      node("takeaways_grid", "columns_3", { stackOn: "tablet", gap: 32 }, [
        takeaway("takeaways_sheet", "01", "3 帳戶分配比例試算表", "輸入月薪，自動算出生活、儲蓄與投資帳戶的建議比例。"),
        takeaway("takeaways_buffer", "02", "緊急預備金的計算方式", "依你的家庭狀況，算出最低與安心的預備金金額。"),
        takeaway("takeaways_checklist", "03", "定期定額前的檢查清單", "開始投資前，先確認 7 件事，避免一開始就做錯。"),
      ], { align: "stretch" }),
    ], { background: WHITE, color: BODY, maxWidth: 1160, gap: 40 }),

    // 5. 講者故事（深藍底反白）＋數據。
    section("story", [
      title("story_title", "MY STORY", "從月光族，\n到建立自己的理財系統", { light: true, mobileTitle: "從月光族，到建立自己的理財系統" }),
      node("story_speaker", "speaker_profiles", { layout: "featured", photoShape: "portrait", accentColor: GOLD, items: [
        { photo: `${ART}/hero-portrait.svg`, alt: "講者照片（請替換）", name: "陳柏宇", role: "理財教育講師・「柏宇的錢包筆記」創辦人", bio: "工作第 3 年，我的存款還是零。後來我把薪水拆成 3 個帳戶，不靠意志力，只靠設定好的規則，5 年後存下第一桶金。現在我把這套方法整理成任何上班族都能照著做的步驟。", tags: "理財教育,資產配置,上班族理財" },
      ] }, undefined, { color: WHITE }),
      node("story_stats", "stats", { animate: true, framed: true, accentColor: GOLD, items: [
        { value: "8", suffix: "年", label: "理財教育經驗" },
        { value: "30000", suffix: "+", label: "講座學員（範本示意）" },
        { value: "4.9", suffix: "/5", label: "講座平均評分（範本示意）" },
      ] }, undefined, { color: WHITE }),
    ], { background: INK, color: DARK_BODY, maxWidth: 1000, gap: 48 }),

    // 6. 學員回饋（格狀 3 欄；長評價不截斷）。
    section("reviews", [
      title("reviews_title", "REVIEWS", "聽過的人怎麼說", { align: "center" }),
      node("reviews_wall", "testimonial_wall", { layout: "grid", columns: 3, autoplay: false, showRating: true, accentColor: COPPER, cardColor: WHITE, cardTextColor: BODY, items: [
        { name: "學員 A｜行政人員", rating: 5, title: WEBINAR_TEMPLATE_SAMPLE_MARK, text: "第一次知道緊急預備金要怎麼算，回家馬上開了一個新帳戶。" },
        { name: "學員 B｜工程師", rating: 5, title: WEBINAR_TEMPLATE_SAMPLE_MARK, text: "試算表很好用，薪水一進來就自動分好，不用再想。" },
        { name: "學員 C｜護理師", rating: 5, title: WEBINAR_TEMPLATE_SAMPLE_MARK, text: "講得很白話，沒有推銷任何商品，聽完很安心。" },
        { name: "學員 D｜業務", rating: 4, title: WEBINAR_TEMPLATE_SAMPLE_MARK, text: "以前收入不固定很難存錢，現在用比例分配就簡單多了。" },
        { name: "學員 E｜設計師", rating: 5, title: WEBINAR_TEMPLATE_SAMPLE_MARK, text: "檢查清單讓我發現自己之前買的東西根本不適合我。" },
        { name: "學員 F｜新鮮人", rating: 5, title: WEBINAR_TEMPLATE_SAMPLE_MARK, text: "剛出社會就聽到這堂課，覺得自己少走了好幾年冤枉路。" },
      ] }),
    ], { background: CREAM, color: BODY, maxWidth: 1240, gap: 40 }),

    // 7. 投資風險提示（合規語氣，深色字）。
    section("risk", [
      node("risk_callout", "callout", { tone: "compliance", title: "投資風險提示", text: "投資一定有風險，過去績效不代表未來表現。\n\n本講座僅為一般理財教育，不提供個別投資建議，也不推薦特定金融商品；做任何投資決定前，請評估自身財務狀況與風險承受度。" }, undefined, { color: INK }),
    ], { background: WHITE, color: BODY, maxWidth: 720, paddingY: 64, paddingYMobile: 40 }),

    // 8. 第二次報名表（深藍底，白色卡片）。
    section("register", [
      title("register_title", "JOIN THE CLASS", "現在預約，\n開講前提醒你", { align: "center", light: true, mobileTitle: "現在預約，開講前提醒你" }),
      text("register_date", "{{webinar.startAt}}｜線上講座・免費", "lead", { color: DARK_BODY }),
      form("register_form", {
        title: "免費預約講座",
        fields: [
          { name: "name", label: "姓名", placeholder: "王小明", required: true },
          { name: "email", label: "Email", type: "email", placeholder: "name@example.com", required: true, helpText: "講座連結與試算表會寄到這個信箱" },
        ],
        submitLabel: "免費預約講座",
        submitStyle: { ...cta, backgroundColor: GOLD, color: INK },
        note: "講座內容為理財教育，不構成投資建議。",
        style: { backgroundColor: WHITE, borderRadius: 10, padding: 32, color: INK, textAlign: "left", width: "min(100%, 520px)", margin: "0 auto" },
        mobile: { style: { padding: 20 } },
      }),
    ], { background: INK, color: DARK_BODY, maxWidth: 720, gap: 24, align: "center" }),

    // 9. FAQ
    section("faq", [
      title("faq_title", "FAQ", "常見問題", { align: "center" }),
      node("faq_list", "faq", { items: [
        { question: "講座會推薦特定商品嗎？", answer: "不會。講座只談分配原則與檢查方法，不推薦任何金融商品。" },
        { question: "需要先有存款嗎？", answer: "不需要。這堂課就是從「薪水進來之後怎麼分」開始。" },
        { question: "有回放嗎？", answer: "依主辦單位的回放設定，報名者會在信中收到回放資訊。" },
        { question: "試算表怎麼拿？", answer: "講座結束後，會寄到你報名時填寫的 Email。" },
      ] }, undefined, { color: BODY, textAlign: "left" }),
      button("faq_cta", "免費預約講座", "#register", { ...cta, padding: "16px 40px", width: "fit-content", margin: "0 auto" }),
    ], { background: CREAM, color: BODY, maxWidth: 720, gap: 32 }),
  ];
}

export const template: WebinarTemplateDefinition = {
  id: "webinar-finance-host",
  number: 4,
  name: "理財講者主視覺報名頁",
  description: "講者人像主導的雜誌感報名頁：襯線標題、深藍與銅金點綴、開講倒數、講者故事與投資風險提示。",
  category: "理財講座",
  purposes: ["webinar"],
  styles: ["professional"],
  preview: { eyebrow: "Webinar", headline: "用 3 個帳戶開始你的資產配置", summary: "講者主視覺＋倒數＋合規提示", palette: [CREAM, PRIMARY, GOLD], sectionCount: 9 },
  theme: { typography: { headingFont: "serif-tc", bodyFont: "sans-tc", bodySize: 18, bodyLineHeight: 1.75, textColor: BODY, headingColor: INK, linkColor: PRIMARY }, background: { color: CREAM } },
  settings: { eventTitle: "上班族的第一套資產配置：用 3 個帳戶管好薪水", scrollReveal: "fade", stickyCta: { enabled: true, label: "免費預約講座", showDate: true, devices: "mobile_tablet", buttonColor: PRIMARY, buttonTextColor: WHITE, backgroundColor: CREAM } },
  build,
};
