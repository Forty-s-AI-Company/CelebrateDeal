import { CONVERSION_TEMPLATE_SAMPLE_MARK, conversionOfferCard, conversionTemplateKit, type ConversionTemplateDefinition } from "../conversion/types";

/**
 * 銷售 08：服務方案銷售頁（specs/sales-08-service-photo.md）。
 * 白底、墨黑與沙色的極簡攝影工作室頁，標題用思源宋體；首屏是一張大幅作品，
 * 往下用作品集（拼貼、保留原比例）、方案內容、五步拍攝流程與評價建立信任，
 * 最後報價卡與合作須知並排，FAQ 收尾。作品圖為原創插畫示意（public/funnel-illustrations/sales/08/），
 * 工作室與攝影師為虛構。
 */
const ART = "/funnel-illustrations/sales/08";
const BG = "#ffffff";
const INK = "#151515";
const BODY = "#444444";
const PRIMARY = "#151515";
const SAND = "#efe9e1";
const ACCENT = "#7d5d3f";
const LINE = "#e4ddd3";
const MUTED_ON_DARK = "#d9d2c8";

function build(prefix: string) {
  const { node, section, columns2, stack, headline, text, button } = conversionTemplateKit(prefix);
  const cta = { backgroundColor: PRIMARY, color: BG, borderRadius: 2, fontSize: 17, letterSpacing: 2, padding: "18px 40px", width: "fit-content" } as const;
  const h2 = (id: string, value: string, mobileText?: string) => headline(id, value, "h2", { color: INK, fontSize: 40, lineHeight: 1.35 }, { tablet: { style: { fontSize: 34 } }, mobile: { style: { fontSize: 27, lineHeight: 1.4 }, ...(mobileText ? { props: { text: mobileText } } : {}) } });
  const eyebrow = (id: string, value: string) => text(id, value, "eyebrow", { color: ACCENT, letterSpacing: 4 });
  const heading = (id: string, label: string, title: string, mobileText?: string) => stack(`${id}_heading`, [eyebrow(`${id}_eyebrow`, label), h2(`${id}_title`, title, mobileText)], 12, { textAlign: "center" });

  return [
    // 1. 首屏：左文案，右大幅作品（平板以下：文案 → 作品）。
    section("hero", [
      columns2("hero_split", [
        text("hero_brand", "光室 STUDIO HIKARI", "small", { color: INK, letterSpacing: 6, fontSize: 14 }),
        eyebrow("hero_eyebrow", "家庭寫真・到府拍攝方案"),
        headline("hero_title", "在家裡最自在的角落，\n留下你們現在的樣子", "h1", { color: INK, fontSize: 52, lineHeight: 1.35 }, {
          tablet: { style: { fontSize: 42 } },
          mobile: { style: { fontSize: 30, lineHeight: 1.4 }, props: { text: "在家裡最自在的角落，留下你們現在的樣子" } },
        }),
        text("hero_lead", "不用去攝影棚，也不用擺姿勢。我們帶著燈具到你家，拍孩子在沙發上打滾、狗狗湊過來的那一刻。", "lead", { color: BODY }),
        button("hero_cta", "查看拍攝方案", "#offer", cta, { mobile: { style: { width: "100%" } } }),
        text("hero_note", "2 小時到府拍攝｜精修 30 張｜線上相簿交付", "small", { color: BODY, letterSpacing: 1 }),
      ], [
        node("hero_photo", "image", { src: `${ART}/hero-family.svg`, alt: "作品示意：午後窗光下，一家三口和狗坐在客廳沙發上" }, undefined, { imageWidth: 100 }),
      ], { ratio: "1:1", stackOn: "tablet", gap: 72, align: "center" }),
    ], { background: BG, color: BODY, maxWidth: 1200, paddingY: 96, paddingYTablet: 56, paddingYMobile: 32 }),

    // 2. 作品集（拼貼，保留原比例）。
    section("works", [
      heading("works", "PORTFOLIO", "在家裡拍，才有的表情"),
      text("works_note", `以下為${CONVERSION_TEMPLATE_SAMPLE_MARK}作品插畫，請替換成你的作品照片。`, "small", { color: BODY, textAlign: "center" }),
      node("works_gallery", "image_gallery", { layout: "masonry", columns: 3, items: [
        { src: `${ART}/work-01.svg`, alt: "作品示意：孩子在床上抱著枕頭大笑", caption: "臥室・早晨" },
        { src: `${ART}/work-02.svg`, alt: "作品示意：一家人在廚房一起做早餐", caption: "廚房・週末早餐" },
        { src: `${ART}/work-03.svg`, alt: "作品示意：爸爸把孩子舉高，背景是落地窗", caption: "客廳・落地窗" },
        { src: `${ART}/work-04.svg`, alt: "作品示意：媽媽和寶寶在窗邊的側光特寫", caption: "窗邊・側光" },
        { src: `${ART}/work-05.svg`, alt: "作品示意：全家和狗在客廳地毯上玩", caption: "地毯・午後" },
        { src: `${ART}/work-06.svg`, alt: "作品示意：兄妹趴在沙發背上看著窗外", caption: "沙發・傍晚" },
      ] }, undefined, { color: BODY, textAlign: "left" }),
    ], { background: SAND, color: BODY, maxWidth: 1200, gap: 28 }),

    // 3. 方案內容。
    section("plan", [
      columns2("plan_split", [
        eyebrow("plan_eyebrow", "WHAT'S INCLUDED"),
        h2("plan_title", "一個方案，\n從拍攝到相簿都包含", "一個方案，從拍攝到相簿都包含"),
        text("plan_text", "我們只做一種方案，讓你不用比較加價項目。需要的話，實體相本可以在挑片後再決定。", undefined, { color: BODY }),
      ], [
        node("plan_list", "icon_list", { layout: "grid", columns: 2, numbered: false, accentColor: ACCENT, items: [
          { icon: "clock", title: "2 小時到府拍攝", text: "雙北到府，其他地區另計交通。" },
          { icon: "users", title: "全家人與寵物", text: "同住家人與毛孩都可以入鏡，不另收費。" },
          { icon: "star", title: "精修 30 張", text: "膚色與光線細修，保留真實的樣子。" },
          { icon: "book", title: "全部原檔挑選", text: "線上相簿挑片，未選的也能加購。" },
          { icon: "message", title: "拍攝前溝通", text: "問卷＋15 分鐘視訊，先聊你們家的習慣。" },
          { icon: "heart", title: "實體相本（加購）", text: "布面精裝，挑片後再決定也可以。" },
        ] }, undefined, { color: INK, textAlign: "left" }),
      ], { ratio: "5:7", stackOn: "tablet", gap: 64, align: "start" }),
    ], { background: BG, color: BODY, maxWidth: 1160, paddingY: 112 }),

    // 4. 拍攝流程。
    section("process", [
      heading("process", "PROCESS", "從預約到收到相簿"),
      node("process_steps", "agenda_timeline", { layout: "steps", accentColor: ACCENT, items: [
        { time: "預約當天", title: "預約與付款", text: "完成付款後，我們會寄信確認拍攝檔期。" },
        { time: "拍攝前", title: "填寫拍攝問卷", text: "家裡的光線、成員與想留下的畫面。" },
        { time: "拍攝當天", title: "到府拍攝", text: "2 小時，不趕時間，孩子累了就休息。" },
        { time: "拍攝後", title: "挑片與精修", text: "線上相簿挑選 30 張，進入精修。" },
      ] }, undefined, { color: INK, textAlign: "left" }),
      text("process_delivery", "精修完成後以線上相簿交付，可下載高解析檔案。交付時間依工作室實際排程為準。", "small", { color: BODY, textAlign: "center" }),
    ], { background: SAND, color: BODY, maxWidth: 1120, gap: 40 }),

    // 5. 評價（範本示意）。
    section("reviews", [
      heading("reviews", "KIND WORDS", "拍完之後，他們說"),
      node("reviews_wall", "testimonial_wall", { layout: "grid", columns: 3, autoplay: false, showRating: false, cardColor: BG, cardTextColor: BODY, accentColor: ACCENT, items: [
        { name: "林家｜三口之家", title: CONVERSION_TEMPLATE_SAMPLE_MARK, text: "孩子完全沒發現自己在被拍，照片裡都是他平常的樣子。" },
        { name: "陳家｜兩個孩子和一隻貓", title: CONVERSION_TEMPLATE_SAMPLE_MARK, text: "原本擔心家裡太亂，攝影師說角落整理一下就好，成品真的很有生活感。" },
        { name: "王家｜新手爸媽", title: CONVERSION_TEMPLATE_SAMPLE_MARK, text: "寶寶睡著時也拍了好多張，每一張都想印出來。" },
      ] }, undefined, { textAlign: "left" }),
    ], { background: BG, color: BODY, maxWidth: 1120, gap: 44, align: "center" }),

    // 6. 報價卡＋合作須知。
    section("book", [
      heading("book", "BOOKING", "預約你們家的拍攝"),
      columns2("book_split", [
        conversionOfferCard(prefix, "offer", {
          title: "家庭寫真・到府拍攝方案",
          lines: ["2 小時到府拍攝・精修 30 張", "全部原檔線上挑選・線上相簿交付"],
          note: "售價與付款方式以結帳頁為準。付款完成後，我們會在 2 個工作天內寄信確認拍攝檔期。",
          style: { backgroundColor: BG, color: INK, borderColor: INK, borderWidth: 1, borderRadius: 4, padding: 40, shadow: "none" },
          mobile: { style: { padding: 22 } },
          titleColor: INK,
          noteColor: BODY,
          htmlId: "offer",
        }),
      ], [
        node("book_terms", "callout", { tone: "compliance", title: "合作須知（請依實際政策修改）", text: "拍攝日 7 天前可免費改期一次；7 天內改期或取消，依工作室的取消政策辦理。\n\n遇到颱風、地震等不可抗力或攝影師身體不適，可免費改期或全額退款。\n\n作品著作權屬工作室，你可以自由用於個人用途；工作室公開作品前會先徵求你的同意。以上為範本示意。" }, undefined, { color: INK, textAlign: "left" }),
      ], { ratio: "1:1", stackOn: "tablet", gap: 40, align: "center" }),
    ], { background: SAND, color: BODY, maxWidth: 1120, gap: 44, paddingY: 104 }),

    // 7. FAQ。
    section("faq", [
      heading("faq", "FAQ", "常見問題"),
      node("faq_list", "faq", { items: [
        { question: "家裡很小、很亂也可以拍嗎？", answer: "可以。我們會先透過問卷了解光線，拍攝當天只需要整理一兩個角落，生活感反而是照片最好看的地方。" },
        { question: "孩子怕生怎麼辦？", answer: "前 20 分鐘我們通常只陪孩子玩，不急著拍；熟了之後的表情最自然。" },
        { question: "可以拍寵物嗎？", answer: "可以，毛孩也是家人。拍攝前請在問卷中告訴我們牠的個性。" },
        { question: "雙北以外可以到府嗎？", answer: "可以，交通與住宿費用依地區另計，請在預約前來信詢問。範本示意，請依實際服務範圍修改。" },
        { question: "可以開發票嗎？", answer: "可以，結帳時選擇個人或公司發票，電子發票會寄到你的 Email。" },
      ] }, undefined, { color: BODY, textAlign: "left" }),
    ], { background: BG, color: BODY, maxWidth: 760, gap: 40, paddingY: 104 }),

    // 8. 頁尾（墨黑帶）。
    section("footer", [
      text("footer_brand", "光室 STUDIO HIKARI", undefined, { color: BG, letterSpacing: 6, fontSize: 16 }),
      text("footer_text", "© 光室（虛構工作室）｜家庭寫真・到府拍攝｜回覆確認信即可聯絡我們", "small", { color: MUTED_ON_DARK }),
    ], { background: INK, color: MUTED_ON_DARK, maxWidth: 960, paddingY: 56, paddingYTablet: 48, paddingYMobile: 36, gap: 10, align: "center" }),
  ];
}

export const template: ConversionTemplateDefinition = {
  id: "sales-service-photo",
  kind: "sales",
  number: 8,
  name: "服務方案銷售頁",
  description: "白底墨黑與沙色的極簡攝影服務頁：大幅作品首屏、拼貼作品集、單一方案內容、四步流程，報價卡與合作須知並排。",
  category: "服務方案",
  purposes: ["sales"],
  styles: ["minimal"],
  preview: { eyebrow: "銷售頁", headline: "在家裡最自在的角落", summary: "大幅作品首屏＋作品集拼貼", palette: [BG, SAND, INK], sectionCount: 8 },
  theme: { typography: { headingFont: "serif-tc", bodyFont: "sans-tc", bodySize: 17, bodyLineHeight: 1.85, textColor: BODY, headingColor: INK, linkColor: PRIMARY }, background: { color: BG } },
  settings: { scrollReveal: "fade", stickyCta: { enabled: true, label: "查看拍攝方案", target: "offer", showDate: false, devices: "mobile_tablet", buttonColor: PRIMARY, buttonTextColor: BG, backgroundColor: BG } },
  build,
  thankYou: {
    name: "家庭寫真・訂單感謝頁",
    description: "說明付款確認信、拍攝問卷與確認日期三個步驟。",
    tokens: { background: BG, surface: SAND, ink: INK, body: BODY, accent: PRIMARY, onAccent: BG, line: LINE, footerBackground: INK, footerText: MUTED_ON_DARK, radius: 2 },
    eyebrow: "預約已送出",
    title: "接下來，\n我們一起挑個好天氣",
    intro: "付款完成後，確認信會寄到你填寫的 Email。我們會在 2 個工作天內與你聯絡，確認拍攝日期。",
    card: { title: "預約拍攝日期", text: "家庭寫真・到府拍攝方案。確認信裡有拍攝問卷與可預約的日期，填好後我們就會保留你的檔期。", buttonLabel: "看接下來的步驟", buttonHref: "#ty-steps" },
    steps: [
      { icon: "message", title: "收確認信", text: "付款完成後寄出，信裡有問卷連結與工作室聯絡方式。" },
      { icon: "book", title: "填寫拍攝問卷", text: "家裡的光線、成員與想留下的畫面，大約 5 分鐘。" },
      { icon: "clock", title: "確認日期", text: "我們回覆可拍攝的時段，雙方確認後就完成預約。" },
    ],
    faq: [
      { question: "發票什麼時候會收到？", answer: "付款完成後開立電子發票，寄到結帳時填寫的 Email。" },
      { question: "想改期或退款怎麼辦？", answer: "請回覆確認信，我們會依合作須知處理。範本示意，請依實際政策修改。" },
      { question: "要怎麼聯絡攝影師？", answer: "直接回覆確認信即可，拍攝前也會有一次 15 分鐘的視訊溝通。" },
    ],
    footer: "© 光室（虛構工作室）｜家庭寫真・到府拍攝",
  },
};
