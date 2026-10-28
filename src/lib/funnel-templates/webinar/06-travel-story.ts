import type { FunnelNode } from "@/lib/funnel-page-document";
import { WEBINAR_TEMPLATE_SAMPLE_MARK, webinarTemplateKit, type WebinarTemplateDefinition } from "./types";

/**
 * 範本 06：旅遊長篇故事銷講頁（specs/06-travel-story.md）。
 * 旅行手帳的語氣：米白與沙色交替的長頁、宋體標題、夕陽紅按鈕與海洋藍點綴，
 * 段落之間用手繪路線分隔；全頁至少 4 個 CTA，最後收在深藍頁尾。
 * 插圖是 public/funnel-illustrations/webinar/06/ 的自製 SVG，講者照為替換佔位圖。
 */
const ART = "/funnel-illustrations/webinar/06";
const BG = "#fdfaf4";
const SAND = "#f1e6d2";
const INK = "#1f2d3d";
const BODY = "#44515f";
const PRIMARY = "#c8443a";
const ACCENT = "#1f6f8b";
const FOOTER_BODY = "#d9d2c5";

/** 平板與手機文字會疊到插畫上：改成全區均勻的高不透明遮罩（qa-standards §3.3）。 */
function withBackdropOverrides(hero: FunnelNode): FunnelNode {
  const flat = { overlayFade: "none", overlayOpacity: 90 };
  return { ...hero, overrides: { ...hero.overrides, tablet: { ...hero.overrides.tablet, props: flat }, mobile: { ...hero.overrides.mobile, props: flat } } };
}

function build(prefix: string) {
  const { node, section, columns2, stack, headline, text, button, form } = webinarTemplateKit(prefix);
  const cta = { backgroundColor: PRIMARY, color: "#ffffff", borderRadius: 100, fontSize: 18, padding: "16px 36px" } as const;
  const h2 = (id: string, value: string, mobileText?: string) => headline(id, value, "h2", { color: INK, fontSize: 36, lineHeight: 1.3 }, { tablet: { style: { fontSize: 32 } }, mobile: { style: { fontSize: 26 }, ...(mobileText !== undefined ? { props: { text: mobileText } } : {}) } });
  const route = (id: string) => node(id, "image", { src: `${ART}/route-divider.svg`, alt: "" }, undefined, { imageWidth: 46 }, { mobile: { style: { imageWidth: 72 } } });
  const story = (id: string, value: string) => text(id, value, undefined, { color: BODY, fontSize: 18, lineHeight: 1.85, textAlign: "left" }, { mobile: { style: { fontSize: 17, lineHeight: 1.8 } } });
  return [
    // 1. 公告條：開播倒數綁漏斗排程。
    node("announce", "announcement_bar", { text: "免費直播｜{{webinar.startAt}}｜講者親自攤開第一年的真實收支", showCountdown: true, countdownLabel: "距離開播", barColor: INK, barTextColor: BG }),
    // 2. 導覽列：只有品牌與報名鈕（不固定，避免和固定報名列重複）。
    node("nav", "nav_bar", { brand: "帶著筆電去旅行", homeHref: "#top", sticky: false, accentColor: PRIMARY, ctaLabel: "立即報名", ctaHref: "#register", items: [], socials: [] }, undefined, { backgroundColor: BG, color: INK }),
    // 3. 首屏：全幅旅途插畫＋米色遮罩，文字靠左；平板與手機改成均勻遮罩，插畫只當底紋。
    withBackdropOverrides(section("hero", [
      stack("hero_copy", [
        text("hero_eyebrow", "免費線上直播｜90 分鐘｜真實故事分享", "eyebrow", { color: ACCENT }),
        headline("hero_title", "我花了一年，才學會怎麼\n一邊旅行一邊養活自己", "h1", { color: INK, fontSize: 52, lineHeight: 1.25 }, { tablet: { style: { fontSize: 44 } }, mobile: { style: { fontSize: 28, lineHeight: 1.3 }, props: { text: "一邊旅行一邊養活自己，我整整花了一年才學會" } } }),
        text("hero_lead", "這場直播，我會把第一年踩過的坑、接到第一個案子的方法，和現在每個月的收支，全部攤開來講。", "lead", { color: BODY }),
        button("hero_cta", "免費報名直播", "#register", cta),
        node("hero_facts", "event_facts", { layout: "row", formatLabel: "線上直播", priceLabel: "免費", showDuration: true, accentColor: PRIMARY }, undefined, { color: INK }),
      ], 24, { width: 58 }, { tablet: { style: { width: 78 } }, mobile: { style: { width: 100 } } }),
    ], {
      background: BG, color: BODY, maxWidth: 1180, paddingY: 112, paddingYTablet: 88, paddingYMobile: 44, htmlId: "top",
      props: { backgroundImage: `${ART}/hero-journey.svg`, backgroundPosition: "right", overlayColor: BG, overlayOpacity: 92, overlayFade: "right" },
    })),
    // 4. 故事第一段：通勤日常 → 第一次請長假。
    section("story", [
      route("story_route"),
      text("story_eyebrow", "故事從一節車廂開始", "eyebrow", { color: ACCENT, textAlign: "center" }),
      h2("story_title", "那幾年，我每天花 2 小時\n在通勤的車廂裡", "那幾年，我每天花 2 小時在通勤的車廂裡"),
      columns2("story_columns", [
        story("story_p1", "早上七點出門，晚上八點回到家。我在車廂裡滑過無數張別人的旅行照片，告訴自己：等存夠錢、等手上的專案結束、等時機成熟，就換我出發。"),
        story("story_p2", "結果一等就是五年。直到某次請了兩週長假，在海邊的民宿用筆電回完一封客戶的信，我突然發現：我做的事情，其實不一定要坐在那張辦公桌前才能完成。"),
        story("story_p3", "那趟旅程沒有讓我立刻辭職，卻讓我開始認真計算：如果要靠自己的技能一邊旅行一邊生活，到底需要準備什麼？"),
      ], [
        node("story_image", "image", { src: `${ART}/commute.svg`, alt: "擁擠通勤車廂的插畫" }, undefined, { imageWidth: 100, borderRadius: 20 }),
      ], { ratio: "7:5", gap: 56, align: "center" }),
    ], { background: BG, color: BODY, maxWidth: 1080, gap: 28, align: "center", paddingYMobile: 48 }),
    // 5. 中段 CTA：海邊工作的轉捩點。
    section("turn", [
      columns2("turn_columns", [
        node("turn_image", "image", { src: `${ART}/seaside-cafe.svg`, alt: "海邊咖啡店與筆電的插畫" }, undefined, { imageWidth: 100 }),
      ], stack("turn_columns_right", [
        text("turn_eyebrow", "轉捩點", "eyebrow", { color: ACCENT }),
        headline("turn_quote", "「原來工作可以跟著我走，\n而不是我跟著工作走。」", "h3", { color: INK, fontSize: 28, lineHeight: 1.45 }, { mobile: { style: { fontSize: 22 }, props: { text: "「原來工作可以跟著我走，而不是我跟著工作走。」" } } }),
        story("turn_text", "這個念頭，讓我花了一整年把技能、客戶與收入重新整理。直播裡，我會把這一年的每個關鍵決定拆開來給你看。"),
        button("turn_cta", "我想聽完整故事", "#register", cta),
        text("turn_note", "免費參加，可以隨時取消報名", "small", { color: BODY }),
      ], 18, {}, { mobile: { style: { textAlign: "center" } } }), { ratio: "1:1", gap: 56, align: "center" }),
    ], { background: SAND, color: BODY, maxWidth: 1080, paddingYMobile: 48 }),
    // 6. 5 個轉折（議程）。
    section("agenda", [
      route("agenda_route"),
      h2("agenda_title", "這 90 分鐘，我會講 5 個轉折"),
      text("agenda_lead", "每一個轉折，都是我花錢、花時間才換來的答案。", "lead", { color: BODY, textAlign: "center" }),
      node("agenda_list", "agenda_timeline", { layout: "vertical", accentColor: PRIMARY, items: [
        { time: "轉折 1", title: "把技能變成可以販售的服務", text: "從「我會做什麼」到「客戶願意付錢買什麼」，用一張表重新定義你的服務。" },
        { time: "轉折 2", title: "第一個海外客戶怎麼來", text: "沒有人脈也能開始：作品集、平台與轉介紹的實際順序。" },
        { time: "轉折 3", title: "時差下的工作節奏", text: "跨時區開會、回信與交件，我現在固定使用的一週排程。" },
        { time: "轉折 4", title: "收入不穩時的預備金", text: "出發前要存多少？每個月怎麼分配？我的三個帳戶做法。" },
        { time: "轉折 5", title: "簽證與保險的基本功課", text: "出國工作前一定要確認的清單，以及我曾經忽略的細節。" },
      ] }, undefined, { color: INK, textAlign: "left" }),
    ], { background: BG, color: BODY, maxWidth: 760, gap: 24, align: "center" }),
    // 7. 適合／不適合。
    section("fit", [
      h2("fit_title", "這場直播適合你嗎？"),
      node("fit_compare", "fit_compare", {
        fitTitle: "適合你，如果你…",
        fitItems: ["有一項可以遠距完成的技能", "願意花半年慢慢準備", "想先試試看，再決定要不要辭職"],
        notFitTitle: "先不要報名，如果你…",
        notFitItems: ["想要下個月就立刻辭職", "期待不用工作的被動收入", "還沒有任何一項專業技能"],
        fitColor: ACCENT, notFitColor: PRIMARY, cardColor: BG,
      }, undefined, { color: INK, textAlign: "left" }),
    ], { background: SAND, color: BODY, maxWidth: 960, gap: 36, align: "center" }),
    // 8. 講者完整故事＋數據。
    section("speaker", [
      text("speaker_eyebrow", "關於講者", "eyebrow", { color: ACCENT, textAlign: "center" }),
      h2("speaker_title", "嗨，我是以晴"),
      node("speaker_card", "speaker_profiles", { layout: "featured", photoShape: "portrait", accentColor: PRIMARY, items: [
        { photo: `${ART}/speaker.svg`, alt: "講者張以晴的照片（請替換）", name: "張以晴", role: "遠距接案者・旅行寫作者・「帶著筆電去旅行」創辦人", bio: "前廣告公司企劃，花了一年從上班族轉為遠距接案。現在一邊替海外品牌寫文案，一邊在不同城市生活，也陪伴想轉型的人規劃第一年。", tags: "遠距接案 6 年,旅居城市 40+" },
      ] }, undefined, { color: INK, textAlign: "left" }),
      node("speaker_stats", "stats", { animate: true, framed: false, accentColor: PRIMARY, items: [
        { value: "40", suffix: "+", label: `旅居過的城市（${WEBINAR_TEMPLATE_SAMPLE_MARK}）` },
        { value: "6", suffix: "年", label: `遠距接案經驗（${WEBINAR_TEMPLATE_SAMPLE_MARK}）` },
        { value: "1200", suffix: "+", label: `直播參加人次（${WEBINAR_TEMPLATE_SAMPLE_MARK}）` },
      ] }, undefined, { color: INK }),
    ], { background: BG, color: BODY, maxWidth: 1000, gap: 40, align: "center" }),
    // 9. 學員評價（格狀，不輪播）。
    section("reviews", [
      h2("reviews_title", "聽完直播的人，後來怎麼了"),
      node("reviews_wall", "testimonial_wall", { layout: "carousel", columns: 3, autoplay: false, showRating: false, accentColor: PRIMARY, cardColor: BG, cardTextColor: INK, items: [
        { name: "學員 A｜前行銷企劃", title: `第一次報價不再心虛（${WEBINAR_TEMPLATE_SAMPLE_MARK}）`, text: "照著報價表重新算了一次，才發現以前把自己賣得太便宜。現在接案前都會先想清楚範圍。" },
        { name: "學員 B｜UI 設計師", title: `先存預備金再出發（${WEBINAR_TEMPLATE_SAMPLE_MARK}）`, text: "原本打算下個月就辭職，聽完決定先存半年預備金，也先接兩個副業案子試水溫。" },
        { name: "學員 C｜英文家教", title: `排程終於不打架（${WEBINAR_TEMPLATE_SAMPLE_MARK}）`, text: "跨時區上課的排程方法很實用，我現在每週固定兩天完全不排課，用來旅行和休息。" },
        { name: "學員 D｜自由撰稿人", title: `把興趣變成穩定案源（${WEBINAR_TEMPLATE_SAMPLE_MARK}）`, text: "原來作品集不用很多，挑三件最像理想客戶的作品就夠了。我兩週後就收到第一封詢價。" },
        { name: "學員 E｜行政人員", title: `不再覺得出國工作很遙遠（${WEBINAR_TEMPLATE_SAMPLE_MARK}）`, text: "簽證與保險的清單讓我知道要從哪裡開始查，焦慮少了很多，也跟家人有了具體的討論內容。" },
        { name: "學員 F｜平面設計師", title: `收入不穩也能安心（${WEBINAR_TEMPLATE_SAMPLE_MARK}）`, text: "三個帳戶的做法讓我淡季也不慌。現在每個月固定先把預備金撥出去，再決定要接多少案子。" },
      ] }, undefined, { textAlign: "left" }),
    ], { background: SAND, color: BODY, maxWidth: 1160, gap: 36, align: "center" }),
    // 10. 參加禮（純展示，不影響金額）。
    section("gift", [
      h2("gift_title", "準時參加，送你 3 份參加禮"),
      node("gift_stack", "value_stack", {
        items: [
          { title: "接案報價表", text: "填入工時與成本，自動算出合理報價。", value: "NT$800" },
          { title: "遠距工作者行前清單", text: "簽證、保險、網路與預備金，一頁看完。", value: "NT$500" },
          { title: "直播限定 Q&A 回放", text: "直播後開放一段時間，可以回頭複習。", value: "NT$600" },
        ],
        totalLabel: "參加禮總價值", totalValue: "NT$1,900", offerLabel: "報名即可免費領取", note: "價值為講者自訂參考，非售價承諾。",
        accentColor: PRIMARY, cardColor: "#ffffff", cardTextColor: INK,
      }, undefined, { textAlign: "left" }),
      button("gift_cta", "免費報名，領取參加禮", "#register", cta),
    ], { background: BG, color: BODY, maxWidth: 640, gap: 28, align: "center" }),
    // 11. 報名表（錨點）。
    section("register", [
      route("register_route"),
      h2("register_title", "保留你的直播座位"),
      text("register_date", "直播時間：{{webinar.startAt}}", undefined, { color: INK, textAlign: "center", fontSize: 18 }),
      form("register_form", {
        title: "免費報名直播",
        fields: [
          { name: "name", label: "姓名", placeholder: "王小明", required: true },
          { name: "email", label: "Email", type: "email", placeholder: "name@example.com", required: true, helpText: "直播連結與參加禮會寄到這個信箱" },
        ],
        submitLabel: "免費報名直播",
        submitStyle: { ...cta, padding: "16px 24px" },
        note: "報名即表示同意接收本場直播相關通知，可隨時取消訂閱。",
        htmlId: "register",
        style: { backgroundColor: "#ffffff", color: INK, padding: 36, borderRadius: 20, borderColor: "#e4d6bd", borderWidth: 1, shadow: "medium", textAlign: "left", width: 100 },
        mobile: { style: { padding: 16 } },
      }),
    ], { background: SAND, color: BODY, maxWidth: 560, gap: 24, align: "center" }),
    // 12. FAQ（8 題）。
    section("faq", [
      h2("faq_title", "常見問題"),
      node("faq_list", "faq", { items: [
        { question: "需要英文很好嗎？", answer: "不需要。直播會分享不同語言程度的接案方式，英文是加分，不是門檻。" },
        { question: "一定要辭職嗎？", answer: "不一定。很多人是先在下班時間接案，確認收入穩定後才做決定。" },
        { question: "直播最後會推銷課程嗎？", answer: "會。直播尾聲會用幾分鐘介紹進階陪跑課程，是否參加完全由你決定，不參加也能帶走全部內容。" },
        { question: "沒辦法準時參加，有回放嗎？", answer: "依主辦單位的回放設定，報名後會收到回放資訊；直播限定 Q&A 只開放一段時間。" },
        { question: "我還是學生，適合參加嗎？", answer: "適合。你可以把它當成規劃未來工作方式的參考，提早開始累積作品。" },
        { question: "家人反對怎麼辦？", answer: "直播會分享我當時怎麼用預備金與時間表和家人溝通，讓他們放心。" },
        { question: "遠距接案的收入大概多少？", answer: "因技能與投入時間而異。我會分享自己的真實收支結構，但不代表你也會有相同結果。" },
        { question: "還有其他問題，怎麼聯絡？", answer: "報名確認信中有聯絡方式，也可以在直播的提問時間直接問我。" },
      ] }, undefined, { textAlign: "left", color: INK }),
    ], { background: BG, color: BODY, maxWidth: 760, gap: 32, align: "center" }),
    // 13. 最後 CTA（深藍頁尾）。
    section("footer_cta", [
      headline("footer_title", "下一段旅程，從這 90 分鐘開始", "h2", { color: BG, fontSize: 40, lineHeight: 1.3 }, { tablet: { style: { fontSize: 34 } }, mobile: { style: { fontSize: 26 }, props: { text: "下一段旅程，從這裡開始" } } }),
      text("footer_date", "{{webinar.startAt}}・線上直播・免費參加", undefined, { color: FOOTER_BODY }),
      button("footer_button", "免費報名直播", "#register", cta),
    ], { background: INK, color: FOOTER_BODY, maxWidth: 680, gap: 22, align: "center", paddingY: 104 }),
  ];
}

export const template: WebinarTemplateDefinition = {
  id: "webinar-travel-story",
  number: 6,
  name: "旅遊長篇故事銷講頁",
  description: "用第一人稱故事建立信任的長篇銷講頁：手繪路線分隔、5 個轉折、參加禮與多段 CTA。",
  category: "生活轉型講座",
  purposes: ["webinar", "sales"],
  styles: ["warm"],
  preview: { eyebrow: "Webinar", headline: "旅遊長篇故事銷講頁", summary: "米白沙色交替的故事長頁", palette: [BG, PRIMARY, SAND], sectionCount: 13 },
  theme: { typography: { headingFont: "serif-tc", bodyFont: "sans-tc", bodySize: 18, bodyLineHeight: 1.85, textColor: BODY, headingColor: INK, linkColor: ACCENT }, background: { color: BG } },
  settings: {
    eventTitle: "邊旅行邊工作的第一年：從上班族到遠距接案的 5 個轉折",
    scrollReveal: "fade",
    stickyCta: { enabled: true, label: "免費報名直播", showDate: true, devices: "all", buttonColor: PRIMARY, buttonTextColor: "#ffffff", backgroundColor: BG },
  },
  build,
};
