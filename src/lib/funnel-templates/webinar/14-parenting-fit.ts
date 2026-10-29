import { WEBINAR_TEMPLATE_SAMPLE_MARK, webinarTemplateKit, type WebinarTemplateDefinition } from "./types";

/**
 * specs/14：親子教養對象篩選報名頁。首屏先寫明「適合 3–6 歲孩子的家長」，再用適合／不適合、
 * 情境手風琴與 8 題 FAQ 處理「這適合我嗎」。米白底配黃、薄荷、珊瑚色塊與波浪分隔；
 * 標題用霞鶩文楷，像寫給家長的便條。不使用倒數。
 */
const ART = "/funnel-illustrations/webinar/14";
const BG = "#fefcf6";
const CARD = "#ffffff";
const INK = "#24324a";
const BODY = "#44516a";
const MUTED = "#66728a";
const PRIMARY = "#2f6fdb";
const ACCENT = "#c2410c";
const YELLOW = "#ffe08a";
const YELLOW_SOFT = "#fff6d6";
const MINT = "#bde5d4";
const MINT_SOFT = "#eaf6f0";

function build(prefix: string) {
  const { node, section, columns2, stack, headline, text, button, form } = webinarTemplateKit(prefix);
  const pillButton = { backgroundColor: PRIMARY, color: "#ffffff", borderRadius: 100, padding: "16px 36px", fontSize: 18 } as const;
  const h2 = (id: string, value: string, extra = {}) => headline(id, value, "h2", { color: INK, fontSize: 34, lineHeight: 1.35, ...extra }, { mobile: { style: { fontSize: 26 } } });
  const eyebrow = (id: string, value: string) => text(id, value, "eyebrow", { color: ACCENT, letterSpacing: 2 });
  const wave = (id: string, fill: string, behind: string, flip = false) =>
    node(id, "shape_divider", { shape: "wave", position: "top", height: 64, flip }, undefined, { color: fill, backgroundColor: behind }, { mobile: { props: { height: 32 } } });

  return [
    // 1. 公告條。
    node("announcement", "announcement_bar", { text: "孩子睡了再看也可以：報名就能收到回放", barColor: YELLOW, barTextColor: INK }),

    // 2. 首屏：年齡標籤、H1、lead、CTA、活動資訊列；右側插畫（手機在下）。
    section("hero", [
      columns2("hero_columns", [
        text("hero_tag", "適合 3–6 歲孩子的家長", "small", { backgroundColor: YELLOW, color: INK, borderRadius: 100, padding: "8px 18px", width: "fit-content", letterSpacing: 1 }),
        headline("hero_title", "孩子情緒爆發時，\n這 5 句話比「不要哭」更有用", "h1", { color: INK, fontSize: 44, lineHeight: 1.35 }, {
          tablet: { style: { fontSize: 36 } },
          mobile: { style: { fontSize: 28, lineHeight: 1.4 }, props: { text: "孩子情緒爆發時，這 5 句話比「不要哭」更有用" } },
        }),
        text("hero_lead", "60 分鐘線上講座，用真實情境示範怎麼接住孩子的情緒，也照顧好自己。", "lead", { color: BODY }),
        button("hero_cta", "免費報名講座", "#register", pillButton, { mobile: { style: { width: 100 } } }),
        node("hero_facts", "event_facts", { layout: "row", formatLabel: "線上講座＋回放", priceLabel: "免費", showDuration: true, accentColor: PRIMARY }, undefined, { color: BODY }),
      ], [
        node("hero_image", "image", { src: `${ART}/hero-eye-level.svg`, alt: "大人蹲下來和孩子平視、輕輕牽著手的插畫" }, undefined, { imageWidth: 100, borderRadius: 32 }),
      ], { ratio: "7:5", gap: 56, stackOn: "tablet", align: "center" }),
    ], { background: BG, color: BODY, maxWidth: 1080, paddingY: 80, paddingYTablet: 64, paddingYMobile: 40 }),
    wave("divider_fit", MINT_SOFT, BG),

    // 3. 適合／不適合（各有 ✓／✕ 圖示與欄標題，不只靠顏色）。
    section("fit", [
      eyebrow("fit_eyebrow", "報名前先確認"),
      h2("fit_title", "這堂課適合你嗎？"),
      node("fit_compare", "fit_compare", {
        fitTitle: "適合你，如果……",
        fitItems: ["孩子 3–6 歲", "常在公共場所遇到孩子大哭", "想少吼一點，多一點方法", "希望夫妻用一致的說法"],
        notFitTitle: "這堂課不適合",
        notFitItems: ["尋求診斷或治療", "孩子已有明確發展議題、需要個別評估（請找專業單位）", "只想要一次就見效的方法"],
        fitColor: "#1f7a5a", notFitColor: ACCENT, cardColor: CARD,
      }, undefined, { color: BODY, textAlign: "left" }),
    ], { background: MINT_SOFT, color: BODY, maxWidth: 1000, gap: 24, align: "center", paddingY: 80, paddingYMobile: 56 }),
    wave("divider_scenes", BG, MINT_SOFT, true),

    // 4. 常見情境（手風琴）。
    section("scenes", [
      eyebrow("scenes_eyebrow", "你家也發生過嗎"),
      h2("scenes_title", "講座會一起拆解的 3 個情境"),
      node("scenes_list", "faq", { items: [
        { question: "在賣場大哭，怎麼勸都停不下來", answer: "先移到人少的角落，蹲下來說出孩子的感受，等情緒過了再談規則。講座會示範完整的說法與順序。" },
        { question: "睡前不肯刷牙，每天都要拉鋸", answer: "把「要不要」換成「選哪一個」，讓孩子有一點控制感。講座會分享 3 種讓孩子願意配合的選擇題。" },
        { question: "被搶玩具，生氣到動手推人", answer: "先擋下動作，再接住情緒：「你可以生氣，但不能推人。」講座會練習怎麼說得溫和又堅定。" },
      ] }, undefined, { textAlign: "left", color: BODY }),
    ], { background: BG, color: BODY, maxWidth: 720, gap: 24, align: "center", paddingY: 80, paddingYMobile: 56 }),

    // 5. 5 句話（你將學到；標題用文楷像便條）。
    section("phrases", [
      eyebrow("phrases_eyebrow", "你將學到"),
      h2("phrases_title", "接住孩子情緒的 5 句話"),
      stack("phrases_card", [
        node("phrases_list", "icon_list", { layout: "list", numbered: true, accentColor: PRIMARY, items: [
          { icon: "heart", title: "「我看到你很生氣。」", text: "先說出孩子的感受，讓他知道你懂。適合情緒剛爆發的時候。" },
          { icon: "shield", title: "「你可以生氣，但不能打人。」", text: "接納情緒、守住界線，兩件事可以同時做到。" },
          { icon: "leaf", title: "「我們一起深呼吸。」", text: "大人先穩下來，孩子才有機會跟著慢下來。" },
          { icon: "users", title: "「你想要先抱抱，還是先休息？」", text: "給孩子選擇，把主導權還一點給他。" },
          { icon: "star", title: "「剛剛很不容易，你做到了。」", text: "情緒過去後，肯定孩子努力平靜下來的過程。" },
        ] }, undefined, { color: INK, textAlign: "left" }),
      ], 0, { backgroundColor: YELLOW_SOFT, borderRadius: 24, padding: "40px 48px" }, { mobile: { style: { padding: "28px 20px" } } }),
    ], { background: BG, color: BODY, maxWidth: 760, gap: 24, align: "center", paddingY: 48, paddingYMobile: 32 }),

    // 6. 講者。
    section("speaker", [
      eyebrow("speaker_eyebrow", "講者"),
      node("speaker_card", "speaker_profiles", { layout: "featured", photoShape: "portrait", accentColor: PRIMARY, gradientFrom: PRIMARY, gradientTo: MINT, items: [
        { photo: `${ART}/speaker.svg`, alt: "講者何佳穎的照片（請替換）", name: "何佳穎", role: "兒童發展早療治療師", bio: "在醫院與幼兒園陪伴上千個家庭。最常對家長說的一句話是：你不用當完美的爸媽，只要在孩子需要時穩穩地在。", tags: "早期療育,幼兒情緒,親職講座" },
      ] }, undefined, { color: BODY, textAlign: "left" }),
    ], { background: BG, color: BODY, maxWidth: 1000, gap: 24, paddingY: 80, paddingYMobile: 56 }),
    wave("divider_reviews", YELLOW_SOFT, BG),

    // 7. 家長回饋。
    section("reviews", [
      eyebrow("reviews_eyebrow", "家長回饋"),
      h2("reviews_title", "聽完那天晚上，家裡安靜了一點"),
      node("reviews_wall", "testimonial_wall", { layout: "carousel", showRating: false, cardColor: CARD, cardTextColor: BODY, accentColor: PRIMARY, items: [
        { name: "家長 A｜孩子 4 歲", title: `終於不用在賣場罰站（${WEBINAR_TEMPLATE_SAMPLE_MARK}）`, text: "第一句話真的有用。我蹲下來說「我看到你很生氣」，他哭到一半就停下來看我。" },
        { name: "家長 B｜孩子 3 歲", title: `爸爸也一起看了（${WEBINAR_TEMPLATE_SAMPLE_MARK}）`, text: "以前我們兩個說法不一樣，現在講好用同一套句子，孩子比較不會鑽漏洞。" },
        { name: "家長 C｜孩子 6 歲", title: `看回放也很完整（${WEBINAR_TEMPLATE_SAMPLE_MARK}）`, text: "孩子睡了才有空，回放剛好。講義的情境卡我貼在冰箱上。" },
      ] }, undefined, { textAlign: "left" }),
    ], { background: YELLOW_SOFT, color: BODY, maxWidth: 1080, gap: 24, align: "center", paddingY: 80, paddingYMobile: 56 }),
    wave("divider_signup", BG, YELLOW_SOFT, true),

    // 8. 報名表。
    section("signup", [
      eyebrow("signup_eyebrow", "免費報名"),
      h2("signup_title", "今晚，先學會第一句話"),
      text("signup_date", "{{webinar.startAt}}｜線上講座 60 分鐘，提供回放", undefined, { color: BODY }),
      form("signup_form", {
        fields: [
          { name: "name", label: "姓名", placeholder: "怎麼稱呼你", required: true },
          { name: "email", label: "Email", type: "email", placeholder: "name@example.com", required: true, helpText: "講座連結、回放與講義會寄到這個信箱" },
        ],
        submitLabel: "免費報名講座",
        submitStyle: { backgroundColor: PRIMARY, color: "#ffffff", borderRadius: 100, fontSize: 18 },
        note: "不需開鏡頭。可隨時取消訂閱。",
        htmlId: "register",
        style: { backgroundColor: CARD, padding: 36, borderRadius: 24, color: INK, textAlign: "left", width: 100, borderColor: MINT, borderWidth: 2 },
        mobile: { style: { padding: 16 } },
      }),
    ], { background: BG, color: BODY, maxWidth: 560, gap: 20, align: "center", paddingY: 80, paddingYMobile: 56 }),

    // 9. FAQ（8 題，2 欄；平板與手機改單欄）。
    section("faq", [
      h2("faq_title", "報名前，家長最常問的 8 個問題", { textAlign: "center" }),
      node("faq_columns", "columns_2", { ratio: "1:1", gap: 24, stackOn: "tablet" }, [
        node("faq_list_1", "faq", { items: [
          { question: "孩子 7 歲還適合嗎？", answer: "大部分說法仍然適用，但示範情境以 3–6 歲為主。7 歲以上可以參考，再依孩子的狀況調整。" },
          { question: "爸爸可以一起看嗎？", answer: "非常歡迎。一個帳號可以一起觀看，也很建議夫妻一起聽，比較容易用一致的說法。" },
          { question: "回放看多久？", answer: "依主辦單位的回放設定，報名後會在信中附上觀看期限。" },
          { question: "會被要求開鏡頭嗎？", answer: "不會。全程可以關閉鏡頭與麥克風，想發問再用聊天室就好。" },
        ] }, undefined, { textAlign: "left", color: BODY }),
        node("faq_list_2", "faq", { items: [
          { question: "有講義嗎？", answer: "有。報名後會收到 5 句話的情境卡講義，可以印出來貼在家裡。" },
          { question: "講師的專業背景？", answer: "講師為兒童發展早療治療師，長期在醫院與幼兒園服務。證照資訊請商家依實際資料填寫。" },
          { question: "之後有付費課嗎？", answer: "講座最後會介紹進階的親子工作坊，是否參加由你決定。" },
          { question: "隱私怎麼保護？", answer: "報名資料只用於寄送講座資訊，不會公開你的姓名，也不會要求分享孩子的照片。" },
        ] }, undefined, { textAlign: "left", color: BODY }),
      ]),
    ], { background: BG, color: BODY, maxWidth: 1080, gap: 32, paddingY: 48, paddingYMobile: 40 }),

    // 10. 聲明。
    section("notice", [
      node("notice_callout", "callout", { tone: "compliance", title: "講座聲明", text: "本講座為一般教養知識分享，不能取代醫療或個別評估。孩子有發展上的疑慮，請諮詢兒科醫師或早療評估單位。" }, undefined, { color: BODY }),
      text("notice_note", "照片與插圖為示意，不使用真實兒童照片。", "small", { color: MUTED, textAlign: "center" }),
    ], { background: BG, color: BODY, maxWidth: 760, gap: 16, paddingY: 32, paddingYMobile: 24 }),
  ];
}

export const template: WebinarTemplateDefinition = {
  id: "webinar-parenting-fit",
  number: 14,
  name: "親子教養對象篩選報名頁",
  description: "首屏寫明適合的孩子年齡，用適合／不適合、情境手風琴與 8 題 FAQ 化解疑慮；溫暖色塊與波浪分隔，適合親子與兒童教育講座。",
  category: "親子教養講座",
  purposes: ["webinar"],
  styles: ["warm"],
  preview: { eyebrow: "Webinar", headline: "比「不要哭」更有用的 5 句話", summary: "年齡標籤＋適合／不適合＋情境 FAQ", palette: [BG, PRIMARY, YELLOW], sectionCount: 14 },
  theme: { typography: { headingFont: "wenkai-tc", bodyFont: "sans-tc", bodySize: 17, bodyLineHeight: 1.8, textColor: BODY, headingColor: INK, linkColor: PRIMARY }, background: { color: BG } },
  settings: { eventTitle: "3–6 歲孩子情緒爆發時，爸媽可以說的 5 句話", scrollReveal: "rise", stickyCta: { enabled: true, label: "免費報名講座", showDate: true, devices: "mobile_tablet", buttonColor: PRIMARY, buttonTextColor: "#ffffff" } },
  build,
};
