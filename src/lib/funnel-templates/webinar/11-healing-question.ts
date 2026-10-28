import { WEBINAR_TEMPLATE_SAMPLE_MARK, webinarTemplateKit, type WebinarTemplateDefinition } from "./types";

/**
 * specs/11：心理療癒痛點問句報名頁。大型問句開場、慢節奏單欄閱讀、鼠尾草綠與淡紫的有機形狀，
 * 不用倒數與急迫文案；求助資訊（1925 安心專線）放在「不適合」欄與報名表正下方。
 */
const ART = "/funnel-illustrations/webinar/11";
const BG = "#f6f3ee";
const CARD = "#ffffff";
const LAVENDER = "#e9e4f2";
const INK = "#2d3a3a";
const BODY = "#4a5757";
const MUTED = "#5f6b6b";
const PRIMARY = "#3f6b5c";
const ACCENT = "#8a5a40";

function build(prefix: string) {
  const { node, section, columns2, stack, headline, text, button, form } = webinarTemplateKit(prefix);
  const pillButton = { backgroundColor: PRIMARY, color: "#ffffff", borderRadius: 100, padding: "18px 40px", fontSize: 18 } as const;
  const h2 = (id: string, value: string, extra = {}) => headline(id, value, "h2", { color: INK, fontSize: 32, lineHeight: 1.4, ...extra }, { mobile: { style: { fontSize: 24 } } });
  const eyebrow = (id: string, value: string) => text(id, value, "eyebrow", { color: ACCENT, letterSpacing: 3 });

  return [
    // 1. 首屏：大型問句、溫和的 lead、活動資訊列與主 CTA；有機形狀背景。
    section("hero", [
      text("hero_eyebrow", "免費線上講座｜60 分鐘｜不需開鏡頭", "eyebrow", { color: ACCENT, letterSpacing: 3 }),
      headline("hero_title", "躺上床，腦袋卻開始\n重播今天的每一句話？", "h1", { color: INK, fontSize: 46, lineHeight: 1.35 }, {
        tablet: { style: { fontSize: 40 } },
        mobile: { style: { fontSize: 28, lineHeight: 1.4 }, props: { text: "躺上床，腦袋卻開始重播今天的每一句話？" } },
      }),
      text("hero_lead", "過度思考不是性格缺陷。這場 60 分鐘的線上講座，我們一起練習 5 個可以在睡前做的安定方法。", "lead", { color: BODY, lineHeight: 1.9 }),
      button("hero_cta", "預約一個安靜的晚上", "#register", pillButton, { mobile: { style: { width: 100, padding: "16px 24px" } } }),
      node("hero_facts", "event_facts", { layout: "row", formatLabel: "線上直播", priceLabel: "免費", showDuration: true, accentColor: PRIMARY, align: "center" }, undefined, { color: BODY }),
    ], {
      background: BG, color: BODY, maxWidth: 720, gap: 28, align: "center", paddingY: 128, paddingYTablet: 96, paddingYMobile: 56,
      props: { backgroundImage: `${ART}/hero-blobs.svg`, backgroundPosition: "center" },
    }),

    // 2. 「你是不是也這樣」問句清單。
    section("signs", [
      eyebrow("signs_eyebrow", "你是不是也這樣"),
      h2("signs_title", "這些念頭，常常在安靜的時候出現"),
      stack("signs_card", [node("signs_list", "icon_list", { layout: "list", accentColor: PRIMARY, items: [
        { icon: "message", title: "傳出訊息後，一直想對方會怎麼想？", text: "" },
        { icon: "check", title: "做決定前，要反覆確認很多次？", text: "" },
        { icon: "clock", title: "明明很累，躺下卻睡不著？", text: "" },
        { icon: "mountain", title: "一點小事，就想到最壞的結果？", text: "" },
        { icon: "heart", title: "好不容易休息，卻覺得有罪惡感？", text: "" },
      ] }, undefined, { color: INK, textAlign: "left" })], 0, { backgroundColor: CARD, borderRadius: 24, padding: "40px 48px", shadow: "soft" }, { mobile: { style: { padding: "28px 20px" } } }),
      text("signs_note", "如果你點頭了好幾次，這場講座就是為你準備的。", undefined, { color: ACCENT, textAlign: "center" }),
    ], { background: LAVENDER, color: BODY, maxWidth: 640, gap: 24, align: "center", paddingY: 112, paddingYMobile: 64 }),

    // 3. 轉折：這不是你的錯（插圖＋短文；手機插圖在上）。
    section("turn", [
      columns2("turn_columns", [
        node("turn_image", "image", { src: `${ART}/night-thoughts.svg`, alt: "夜晚的月亮、雲朵與慢慢鬆開的思緒線條" }, undefined, { imageWidth: 100, borderRadius: 24 }),
      ], [
        eyebrow("turn_eyebrow", "這不是你的錯"),
        h2("turn_title", "大腦只是太努力保護你"),
        text("turn_text_1", "當大腦察覺「可能有危險」，就會反覆檢查、預演最壞的情況。這是保護機制，不是你不夠堅強。", undefined, { color: BODY, lineHeight: 1.9 }),
        text("turn_text_2", "所以越告訴自己「不要想」，念頭反而越清楚。比起硬壓下去，更有用的是給大腦一個安全的訊號，讓身體先慢下來。", undefined, { color: BODY, lineHeight: 1.9 }),
      ], { ratio: "1:1", gap: 64, align: "center" }),
    ], { background: BG, color: BODY, maxWidth: 1080, paddingY: 112, paddingYMobile: 64 }),

    // 4. 5 個安定練習（numbered、單欄卡片）。
    section("practices", [
      eyebrow("practices_eyebrow", "你將學到"),
      h2("practices_title", "5 個睡前就能做的安定練習"),
      node("practices_list", "agenda_timeline", { layout: "vertical", accentColor: PRIMARY, cardColor: CARD, items: [
        { time: "練習 1", title: "4-6 呼吸", text: "吸氣 4 秒、吐氣 6 秒，用拉長的吐氣告訴身體：現在是安全的。" },
        { time: "練習 2", title: "想法便條", text: "把腦中轉個不停的事寫下來，交給紙張保管，明天再處理。" },
        { time: "練習 3", title: "身體掃描", text: "從腳尖到頭頂，一處一處留意感覺，把注意力從念頭帶回身體。" },
        { time: "練習 4", title: "擔心時段", text: "白天留 15 分鐘專門擔心，晚上念頭出現時，提醒自己「明天再想」。" },
        { time: "練習 5", title: "睡前三件好事", text: "回想今天三件小小的好事，讓一天停在比較溫柔的地方。" },
      ] }, undefined, { color: BODY, textAlign: "left" }),
    ], { background: LAVENDER, color: BODY, maxWidth: 720, gap: 24, align: "center", paddingY: 112, paddingYMobile: 64 }),

    // 5. 適合／不適合（不適合欄導向求助資訊）。
    section("fit", [
      eyebrow("fit_eyebrow", "報名前看一下"),
      h2("fit_title", "這場講座適合你嗎？"),
      node("fit_compare", "fit_compare", {
        fitTitle: "適合你，如果……",
        fitItems: ["常在睡前想個不停，想找一些可以自己練習的方法", "想用溫和、不勉強的方式照顧情緒", "想先了解過度思考是怎麼一回事"],
        notFitTitle: "這場講座不適合",
        notFitItems: ["正處於危機或有傷害自己的念頭：請立即撥打 1925 安心專線（24 小時）或 110／119", "需要診斷或個別治療：請尋求身心科或心理師協助"],
        fitColor: PRIMARY, notFitColor: ACCENT, cardColor: CARD,
      }, undefined, { color: BODY, textAlign: "left" }),
    ], { background: BG, color: BODY, maxWidth: 1000, gap: 24, align: "center", paddingY: 112, paddingYMobile: 64 }),

    // 6. 講者。
    section("speaker", [
      eyebrow("speaker_eyebrow", "帶領練習的人"),
      node("speaker_card", "speaker_profiles", { layout: "featured", photoShape: "circle", accentColor: PRIMARY, gradientFrom: PRIMARY, gradientTo: "#9fb5a8", items: [
        { photo: `${ART}/speaker.svg`, alt: "講者李心妤的照片（請替換）", name: "李心妤", role: "諮商心理師｜諮心字第 000000 號（範本佔位）", bio: "長期陪伴失眠與焦慮困擾的上班族。相信改變不需要用力，只需要每天一點點溫柔的練習。", tags: "正念減壓,睡眠衛教,情緒調節" },
      ] }, undefined, { color: BODY, textAlign: "left" }, { mobile: { props: { size: "small" } } }),
    ], { background: CARD, color: BODY, maxWidth: 960, gap: 24, align: "center", paddingY: 112, paddingYMobile: 64 }),

    // 7. 參與者回饋（輪播、手動切換）。
    section("reviews", [
      eyebrow("reviews_eyebrow", "參加過的人說"),
      h2("reviews_title", "原來不是只有我這樣"),
      node("reviews_wall", "testimonial_wall", { layout: "carousel", showRating: false, cardColor: CARD, cardTextColor: BODY, accentColor: PRIMARY, items: [
        { name: "參與者 A｜行政人員", title: `寫下來，就比較睡得著（${WEBINAR_TEMPLATE_SAMPLE_MARK}）`, text: "想法便條很簡單，但寫完真的比較睡得著。第一次覺得不用跟自己的腦袋吵架。" },
        { name: "參與者 B｜研究生", title: `不用開鏡頭，很安心（${WEBINAR_TEMPLATE_SAMPLE_MARK}）`, text: "不用開鏡頭讓我很安心。老師講話很慢很溫柔，聽完整個人放鬆很多。" },
        { name: "參與者 C｜新手媽媽", title: `終於能跟念頭說晚安（${WEBINAR_TEMPLATE_SAMPLE_MARK}）`, text: "擔心時段對我幫助最大，晚上終於可以跟念頭說「明天再說」。" },
        { name: "參與者 D｜工程師", title: `三分鐘就有感覺（${WEBINAR_TEMPLATE_SAMPLE_MARK}）`, text: "4-6 呼吸現在變成我每天睡前的習慣，大概三分鐘就有感覺。" },
        { name: "參與者 E｜國中老師", title: `身體掃描很踏實（${WEBINAR_TEMPLATE_SAMPLE_MARK}）`, text: "以前一躺下就開始排明天的行程，這次學到把注意力放回腳尖，真的慢慢靜下來。" },
        { name: "參與者 F｜自由工作者", title: `不用逼自己不去想（${WEBINAR_TEMPLATE_SAMPLE_MARK}）`, text: "最安心的是老師說「不要想」本來就很難，讓我不再責怪自己。" },
      ] }, undefined, { textAlign: "left" }),
    ], { background: LAVENDER, color: BODY, maxWidth: 1040, gap: 24, align: "center", paddingY: 112, paddingYMobile: 64 }),

    // 8. 報名表（有機形狀背景）。
    section("signup", [
      stack("signup_intro", [
        eyebrow("signup_eyebrow", "留一個晚上給自己"),
        h2("signup_title", "預約一個安靜的晚上"),
        text("signup_date", "{{webinar.startAt}}｜線上直播 60 分鐘", undefined, { color: BODY }),
      ], 12, { textAlign: "center" }),
      form("signup_form", {
        fields: [
          { name: "name", label: "姓名", placeholder: "怎麼稱呼你", required: true },
          { name: "email", label: "Email", type: "email", placeholder: "name@example.com", required: true, helpText: "直播連結與練習單會寄到這個信箱" },
        ],
        submitLabel: "免費報名",
        submitStyle: { backgroundColor: PRIMARY, color: "#ffffff", borderRadius: 100, fontSize: 18 },
        note: "不需開鏡頭、不會被點名。可隨時取消訂閱。",
        htmlId: "register",
        style: { backgroundColor: CARD, padding: 40, borderRadius: 24, color: INK, textAlign: "left", width: 100, shadow: "soft" },
        mobile: { style: { padding: 20 } },
      }),
    ], {
      background: BG, color: BODY, maxWidth: 520, gap: 28, paddingY: 112, paddingYMobile: 64,
      props: { backgroundImage: `${ART}/hero-blobs.svg`, backgroundPosition: "center" },
    }),

    // 9. 求助資訊與聲明（報名表正下方）。
    section("help", [
      node("help_callout", "callout", { tone: "compliance", title: "如果你現在很不好受", text: "本講座為心理健康教育，不能取代個別諮商或醫療。\n\n若你正處於危機或有傷害自己的念頭，請立即撥打 1925 安心專線（24 小時免付費），或撥打 110／119。" }, undefined, { color: BODY }),
    ], { background: BG, color: BODY, maxWidth: 720, paddingY: 0, paddingYTablet: 0, paddingYMobile: 0 }),

    // 10. FAQ。
    section("faq", [
      h2("faq_title", "常見問題", { textAlign: "center" }),
      node("faq_list", "faq", { items: [
        { question: "需要開鏡頭嗎？", answer: "不需要。你可以關掉鏡頭與麥克風，安心地跟著練習。" },
        { question: "會被點名分享嗎？", answer: "不會。想分享的人可以在聊天室留言，完全自由。" },
        { question: "有回放嗎？", answer: "依主辦單位的回放設定，報名後會收到回放資訊。" },
        { question: "之後有個別諮商嗎？", answer: "講座結束會說明個別諮商的預約方式，是否預約由你決定，不會有推銷。" },
      ] }, undefined, { textAlign: "left", color: BODY }),
      text("faq_note", "講座內容僅供心理健康教育參考。", "small", { color: MUTED, textAlign: "center" }),
    ], { background: BG, color: BODY, maxWidth: 720, gap: 24, paddingY: 112, paddingYMobile: 64 }),
  ];
}

export const template: WebinarTemplateDefinition = {
  id: "webinar-healing-question",
  number: 11,
  name: "心理療癒問句報名頁",
  description: "以溫和的痛點問句開場，慢節奏單欄閱讀，附求助資訊與聲明；適合心理健康、正念與睡眠講座。",
  category: "心理療癒講座",
  purposes: ["webinar"],
  styles: ["natural"],
  preview: { eyebrow: "Webinar", headline: "躺上床，腦袋卻停不下來？", summary: "問句開場＋有機形狀＋求助資訊", palette: [BG, PRIMARY, LAVENDER], sectionCount: 10 },
  theme: { typography: { headingFont: "serif-tc", bodyFont: "sans-tc", bodySize: 18, bodyLineHeight: 1.9, textColor: BODY, headingColor: INK, linkColor: PRIMARY }, background: { color: BG } },
  settings: { eventTitle: "給過度思考者的 5 個安定練習", scrollReveal: "fade", stickyCta: { enabled: true, label: "免費報名", showDate: true, devices: "mobile_tablet", buttonColor: PRIMARY, buttonTextColor: "#ffffff", backgroundColor: CARD } },
  build,
};
