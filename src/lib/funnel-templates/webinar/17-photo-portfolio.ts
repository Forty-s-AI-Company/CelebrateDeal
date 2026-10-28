import { WEBINAR_TEMPLATE_SAMPLE_MARK, webinarTemplateKit, type WebinarTemplateDefinition } from "./types";

/**
 * 範本 17：攝影作品集證明報名頁（specs/17-photo-portfolio.md）。
 * 深色畫廊：黑底、全幅作品首屏、作品之間細縫，報名區反轉成暖白形成焦點。
 * 範本不附真實照片：所有作品都是 public/funnel-illustrations/webinar/17/ 的光影佔位圖，
 * 講者與評價為虛構示意，商家套用後替換成自己的作品。
 */
const ART = "/funnel-illustrations/webinar/17";
const BG = "#111111";
const SURFACE = "#1b1a19";
const INK = "#f5f5f4";
const BODY = "#d6d3d1";
const MUTED = "#a8a29e";
const ACCENT = "#e8c39e";
const LIGHT_BG = "#f5f5f4";
const LIGHT_INK = "#1c1917";
const LIGHT_BODY = "#44403c";
/** Warm brown for small accent text on the light section (the peach accent only works on black). */
const LIGHT_ACCENT = "#7c5230";

function build(prefix: string) {
  const { node, section, columns2, headline, text, button, form } = webinarTemplateKit(prefix);
  const lightButton = { backgroundColor: INK, color: BG, borderRadius: 300, letterSpacing: 1, padding: "16px 36px" } as const;
  const darkButton = { backgroundColor: BG, color: INK, borderRadius: 300, letterSpacing: 1 } as const;
  const title = (id: string, eyebrow: string, value: string, options: { subtitle?: string; light?: boolean; align?: "left" | "center" } = {}) => node(id, "section_title", {
    eyebrow, title: value, subtitle: options.subtitle ?? "", level: "h2", decoration: "none", eyebrowItalic: true, accentColor: options.light ? LIGHT_ACCENT : ACCENT,
  }, undefined, { color: options.light ? LIGHT_INK : INK, ...(options.align ? { textAlign: options.align } : {}) });
  const before = (id: string, label: string, src: string, alt: string, caption: string, highlight: boolean) => [
    text(`${id}_label`, label, "eyebrow", { color: highlight ? ACCENT : MUTED, letterSpacing: 4 }),
    node(`${id}_image`, "image", { src, alt }, undefined, { imageWidth: 100, borderRadius: 4 }),
    text(`${id}_caption`, caption, "small", { color: MUTED }),
  ];

  return [
    // 1. 首屏：全幅作品（桌機 16:9、手機 4:5 直幅），深色漸層遮罩，文字放左下。
    node("hero", "section", { backgroundImage: `${ART}/hero-wide.svg`, backgroundPosition: "center", overlayColor: BG, overlayOpacity: 88, overlayFade: "top" }, [
      node("hero_row", "row", { maxWidth: 1280, gap: 24 }, [
        text("hero_eyebrow", "Portrait · Natural Light", "eyebrow", { color: ACCENT, letterSpacing: 4 }),
        headline("hero_title", "不用相機，\n也能拍出讓人想多看一眼的人像", "h1", { fontSize: 56, lineHeight: 1.25, color: INK, width: "min(880px, 100%)", letterSpacing: 1 }, { tablet: { style: { fontSize: 44 } }, mobile: { style: { fontSize: 30, lineHeight: 1.35, letterSpacing: 0 }, props: { text: "不用相機，\n也能拍出\n讓人想多看一眼的人像" } } }),
        text("hero_lead", "90 分鐘線上講座，跟人像攝影師學會找光、構圖與引導表情。只要一支手機。", "lead", { color: BODY, width: "min(600px, 100%)" }, { mobile: { visible: false } }),
        node("hero_facts", "event_facts", { layout: "row", formatLabel: "手機即可", priceLabel: "免費", showDuration: false, accentColor: ACCENT }, undefined, { color: INK, width: "min(760px, 100%)" }),
        button("hero_cta", "免費報名講座", "#register", { ...lightButton, fontSize: 18 }),
      ]),
    ], { padding: "380px 32px 96px", backgroundColor: BG, color: BODY, textAlign: "left" }, {
      tablet: { style: { padding: "300px 28px 72px" } },
      mobile: { style: { padding: "236px 20px 40px" }, props: { backgroundImage: `${ART}/hero-tall.svg`, backgroundPosition: "top", overlayOpacity: 90 } },
    }),
    // 2. 一句話理念
    section("statement", [
      text("statement_quote", "好的人像不是擺姿勢，\n而是等光、等表情、等那一秒。", undefined, { color: INK, fontSize: 32, lineHeight: 1.6, letterSpacing: 2 }, { tablet: { style: { fontSize: 28 } }, mobile: { style: { fontSize: 22, letterSpacing: 1 }, props: { text: "好的人像不是擺姿勢，而是等光、等表情、等那一秒。" } } }),
      text("statement_by", "— 簡亦凡，人像攝影師", "small", { color: MUTED, letterSpacing: 2 }),
    ], { background: BG, color: BODY, maxWidth: 760, gap: 24, align: "center", paddingY: 120, paddingYTablet: 96, paddingYMobile: 72 }),
    // 3. 作品集（拼貼、保留原比例、可放大）
    section("works", [
      title("works_title", "Selected Works", "這些畫面，都從一扇窗開始", { subtitle: "點開任一張看大圖。範本內是光影佔位圖，請替換成你的作品。" }),
      node("works_gallery", "image_gallery", { layout: "masonry", columns: 3, items: [
        { src: `${ART}/work-01.svg`, alt: "作品佔位：窗邊午後的側光人像", caption: "窗邊・午後三點" },
        { src: `${ART}/work-02.svg`, alt: "作品佔位：逆光下的直幅人像", caption: "逆光・傍晚" },
        { src: `${ART}/work-03.svg`, alt: "作品佔位：陰天柔光的方形人像", caption: "陰天・柔光" },
        { src: `${ART}/work-04.svg`, alt: "作品佔位：咖啡店窗光的直幅人像", caption: "咖啡店・窗光" },
        { src: `${ART}/work-05.svg`, alt: "作品佔位：黃金時刻的戶外人像", caption: "黃金時刻" },
        { src: `${ART}/work-06.svg`, alt: "作品佔位：藍調時刻的城市人像", caption: "藍調時刻" },
        { src: `${ART}/work-07.svg`, alt: "作品佔位：黃昏海邊的方形人像", caption: "黃昏・海邊" },
        { src: `${ART}/work-08.svg`, alt: "作品佔位：樹蔭下的直幅人像", caption: "樹蔭・散射光" },
        { src: `${ART}/work-09.svg`, alt: "作品佔位：室內單燈的人像", caption: "室內・單一光源" },
      ] }, undefined, { color: MUTED }),
    ], { background: BG, color: BODY, maxWidth: 1280, gap: 40, paddingY: 72, paddingYTablet: 64, paddingYMobile: 48 }),
    // 4. 你將學到（每點配一張範例小圖）
    section("learn", [
      title("learn_title", "What You'll Learn", "90 分鐘帶走四個習慣"),
      node("learn_cards", "image_cards", { columns: 4, aspect: "4:3", corners: false, accentColor: ACCENT, items: [
        { src: `${ART}/learn-light.svg`, alt: "範例照片佔位：窗邊的光", title: "找到窗邊的好光", text: "判斷光的方向和軟硬，讓臉上的明暗自然有層次。" },
        { src: `${ART}/learn-frame.svg`, alt: "範例照片佔位：構圖", title: "三分法以外的構圖", text: "留白、框中框與視線方向，讓畫面有故事。" },
        { src: `${ART}/learn-pose.svg`, alt: "範例照片佔位：放鬆的被攝者", title: "讓被攝者放鬆的引導句", text: "不說「笑一個」，用三句話換到真實的表情。" },
        { src: `${ART}/learn-edit.svg`, alt: "範例照片佔位：手機修圖", title: "手機修圖的三個滑桿", text: "曝光、色溫、陰影，三分鐘修出一致的色調。" },
      ] }, undefined, { color: INK }),
    ], { background: SURFACE, color: BODY, maxWidth: 1280, gap: 48 }),
    // 5. 學員作品前後對照（構圖，不涉及外貌修飾）
    section("compare", [
      title("compare_title", "Before / After", "換個站位，畫面就不一樣", { subtitle: "示範只調整站位、角度與水平線，沒有修飾人物外貌。" }),
      columns2("compare_columns",
        before("compare_before", "調整前", `${ART}/before.svg`, "構圖調整前示意：主體置中、水平線歪斜", "主體擠在正中間，背景水平線歪斜。", false),
        before("compare_after", "調整後", `${ART}/after.svg`, "構圖調整後示意：主體落在三分線、水平線拉正", "主體移到三分線，迎著窗光留出視線空間。", true),
        { ratio: "1:1", gap: 24 }),
    ], { background: BG, color: BODY, maxWidth: 1120, gap: 40 }),
    // 6. 講者
    section("speaker", [
      node("speaker_card", "speaker_profiles", { layout: "featured", photoShape: "portrait", accentColor: ACCENT, items: [
        { photo: `${ART}/speaker.svg`, alt: "簡亦凡的照片（請替換為講者照片）", name: "簡亦凡", role: "人像攝影師", tags: "人像,自然光,手機攝影", bio: "拍人像十二年，習慣只帶一顆定焦鏡和一支手機（範本示意經歷）。相信每個人都有被好好拍下來的時刻，只是需要有人等一下光。" },
      ] }, undefined, { color: INK }),
    ], { background: SURFACE, color: BODY, maxWidth: 1040 }),
    // 7. 學員評價
    section("reviews", [
      title("reviews_title", "Voices", "學員怎麼說", { align: "center" }),
      node("reviews_wall", "testimonial_wall", { layout: "grid", columns: 3, autoplay: false, showRating: false, cardColor: "#1f1e1d", cardTextColor: BODY, accentColor: ACCENT, items: [
        { name: "學員 A｜行銷企劃", title: WEBINAR_TEMPLATE_SAMPLE_MARK, text: "原來窗邊站的位置差半步，臉上的光就完全不同。現在幫家人拍照都會先找窗戶。" },
        { name: "學員 B｜新手爸爸", title: WEBINAR_TEMPLATE_SAMPLE_MARK, text: "引導句真的有用，小孩不再對著鏡頭僵笑，拍到好多自然的表情。" },
        { name: "學員 C｜花店老闆", title: WEBINAR_TEMPLATE_SAMPLE_MARK, text: "三個滑桿就把店裡的照片色調統一了，客人說社群看起來更有質感。" },
      ] }, undefined, { textAlign: "left" }),
    ], { background: BG, color: BODY, maxWidth: 1180, gap: 40, align: "center" }),
    // 8. 報名表（淺色區塊反轉）
    section("register", [
      title("register_title", "Reserve a Seat", "下一張好照片，從這裡開始", { light: true, align: "center", subtitle: "免費線上講座，報名後寄送直播連結。" }),
      node("register_facts", "event_facts", { layout: "row", formatLabel: "線上直播", priceLabel: "免費", showDuration: false, accentColor: LIGHT_ACCENT, align: "center", showTimezone: false }, undefined, { color: LIGHT_INK }),
      form("register_form", {
        fields: [
          { name: "name", label: "姓名", placeholder: "王小明", required: true },
          { name: "email", label: "Email", type: "email", placeholder: "name@example.com", required: true, helpText: "直播連結會寄到這個信箱" },
        ],
        submitLabel: "免費報名講座",
        submitStyle: { ...darkButton, fontSize: 18 },
        note: "講座免費・不會寄送與講座無關的推銷信",
        htmlId: "register",
        style: { backgroundColor: "#ffffff", padding: 40, borderRadius: 16, color: LIGHT_INK, textAlign: "left", width: 100, shadow: "soft" },
        mobile: { style: { padding: 16 } },
      }),
    ], { background: LIGHT_BG, color: LIGHT_BODY, maxWidth: 520, gap: 28, align: "center", paddingY: 112, paddingYMobile: 64 }),
    // 9. FAQ
    section("faq", [
      title("faq_title", "Questions", "常見問題", { align: "center" }),
      node("faq_list", "faq", { items: [
        { question: "用哪支手機都可以嗎？", answer: "可以。講座示範的光線與構圖觀念不限機型，近三年內的手機效果都很好。" },
        { question: "需要修圖 App 嗎？", answer: "手機內建的編輯功能就夠用；講座也會提到幾個免費 App 的對應滑桿。" },
        { question: "可以拍小孩和寵物嗎？", answer: "可以。引導句的段落會特別說明怎麼拍不願意配合的小孩與毛孩。" },
        { question: "有作品點評嗎？", answer: "直播尾聲會挑選幾位觀眾事先上傳的照片做構圖點評，是否開放依主辦單位安排。" },
      ] }, undefined, { textAlign: "left", color: BODY }),
    ], { background: BG, color: BODY, maxWidth: 760, gap: 40, align: "center" }),
  ];
}

export const template: WebinarTemplateDefinition = {
  id: "webinar-photo-portfolio",
  number: 17,
  name: "攝影作品集講座",
  description: "深色畫廊風的作品證明報名頁：全幅作品首屏、可放大的作品拼貼、構圖前後對照，報名區反轉成暖白聚焦。",
  category: "攝影與創作",
  purposes: ["webinar"],
  styles: ["luxe"],
  preview: { eyebrow: "Webinar", headline: "不用相機，也能拍出讓人想多看一眼的人像", summary: "全幅作品首屏＋作品集拼貼", palette: [BG, ACCENT, LIGHT_BG], sectionCount: 9 },
  theme: { typography: { headingFont: "sans-tc", bodyFont: "sans-tc", bodySize: 17, bodyLineHeight: 1.8, textColor: BODY, headingColor: INK, linkColor: ACCENT }, background: { color: BG } },
  settings: {
    eventTitle: "用手機拍出有溫度的人像：自然光構圖線上講座",
    scrollReveal: "fade",
    stickyCta: { enabled: true, label: "免費報名講座", showDate: true, devices: "mobile_tablet", buttonColor: INK, buttonTextColor: BG, backgroundColor: BG },
  },
  build,
};
