import { conversionTemplateKit, type ConversionTemplateDefinition } from "../conversion/types";

/**
 * 名單 05：免費 Email 課程名單頁（specs/leads-05-email-course-photo.md）。
 * 亮黃首屏（只放深色字）＋黑色按鈕、桃紅點綴：首屏左承諾、7 天標籤與表單，右手機拍攝插圖；
 * 往下是左標題右時間軸的 7 天課表、第 1 課試讀卡、前後對照、講師與 FAQ，最後亮黃收尾再放一次表單。
 * 講師與對照圖都是虛構示意，商家套用後換成自己的課程與作品。
 */
const ART = "/funnel-illustrations/leads/05";
const SUN = "#ffd84d";
const INK = "#1a1a1a";
const BODY = "#333333";
const BG = "#ffffff";
const BAND = "#fff6d6";
const PINK = "#c42a5f";
const LINE = "#efe3b3";
const FOOTER_TEXT = "#ededed";

function build(prefix: string) {
  const { node, section, columns2, stack, headline, text, button, form } = conversionTemplateKit(prefix);
  const cta = { backgroundColor: INK, color: SUN, borderRadius: 12, fontSize: 18, letterSpacing: 1 } as const;
  const fields = [
    { name: "name", label: "姓名", placeholder: "怎麼稱呼你", required: false },
    { name: "email", label: "Email", type: "email" as const, placeholder: "name@example.com", required: true, helpText: "每天早上 8 點寄出一課" },
  ];
  const note = "7 封課程信寄完後，每週一封拍照小技巧，可隨時退訂。";
  const formCard = { backgroundColor: BG, borderColor: INK, borderWidth: 2, borderRadius: 16, padding: 28, color: INK, textAlign: "left", shadow: "medium" } as const;
  const title = (id: string, eyebrow: string, value: string, subtitle = "") => node(id, "section_title", {
    eyebrow, title: value, subtitle, level: "h2", decoration: "none", eyebrowItalic: false, accentColor: PINK,
  }, undefined, { color: INK });
  const tag = (id: string, value: string) => text(id, value, undefined, { backgroundColor: INK, color: SUN, borderRadius: 300, padding: "6px 16px", fontSize: 15, letterSpacing: 1, width: "fit-content" });

  return [
    // 1. 首屏：亮黃底，左承諾＋7 天標籤＋表單卡（手機在插圖之前），右手機拍攝插圖。
    section("hero", [
      columns2("hero_split", [
        text("hero_eyebrow", "免費 Email 課｜每天一封、連續 7 天", "eyebrow", { color: INK, letterSpacing: 2 }),
        headline("hero_title", "7 天，用手機\n拍出好賣的商品照", "h1", { color: INK, fontSize: 52, lineHeight: 1.22 }, {
          tablet: { style: { fontSize: 44 } },
          mobile: { style: { fontSize: 31, lineHeight: 1.3 }, props: { text: "7 天，用手機拍出好賣的商品照" } },
        }),
        tag("hero_tag", "DAY 1 → DAY 7｜每封 5 分鐘讀完"),
        text("hero_promise", "不用買相機和燈具。一扇窗、一張白紙、一支手機，跟著每天的小作業拍，第 7 天就能換掉賣場上的舊照片。", "lead", { color: INK }),
        form("hero_form", {
          fields,
          submitLabel: "免費開始第 1 天",
          submitStyle: cta,
          note,
          htmlId: "optin",
          style: formCard,
          mobile: { style: { padding: 18 } },
        }),
      ], [
        node("hero_art", "image", { src: `${ART}/phone-shoot.svg`, alt: "手機拍攝插圖：窗光下的馬克杯與手機取景畫面" }, undefined, { imageWidth: 100, textAlign: "center" }, {
          tablet: { style: { imageWidth: 64 } },
          mobile: { style: { imageWidth: 90 } },
        }),
      ], { ratio: "1:1", stackOn: "tablet", gap: 56, align: "center" }),
    ], { background: SUN, color: INK, maxWidth: 1180, paddingY: 88, paddingYTablet: 56, paddingYMobile: 28, gap: 24 }),

    // 2. 7 天課表：左標題，右直式時間軸。
    section("days", [
      columns2("days_split", [
        title("days_title", "7-DAY PLAN", "一天只練一件事", "每封信都有一個 10 分鐘內做得完的小作業，拍完再收下一封。"),
        button("days_cta", "免費開始第 1 天", "#optin", { ...cta, width: "fit-content", padding: "14px 28px", fontSize: 16 }),
      ], [
        node("days_list", "agenda_timeline", { layout: "vertical", accentColor: PINK, items: [
          { time: "Day 1", title: "找到家裡最好的那扇窗", text: "側光、逆光、順光怎麼選，拍出第一張乾淨的商品照。" },
          { time: "Day 2", title: "白紙就是反光板", text: "用一張 A4 補亮陰影，讓暗部也看得清楚。" },
          { time: "Day 3", title: "三個好用的角度", text: "平視、45 度、正上方，依商品形狀決定。" },
          { time: "Day 4", title: "背景與留白", text: "收掉雜物，用一塊布或木板做出風格。" },
          { time: "Day 5", title: "加一點生活感", text: "道具只放一樣，讓客人想像使用的樣子。" },
          { time: "Day 6", title: "手機修圖三步驟", text: "曝光、白平衡、裁切，五分鐘修出一致的色調。" },
          { time: "Day 7", title: "整理成一組賣場照", text: "主圖、細節、情境各一張，直接換上你的賣場。" },
        ] }, undefined, { color: BODY, textAlign: "left" }),
      ], { ratio: "5:7", stackOn: "tablet", gap: 64, align: "start" }),
    ], { background: BG, color: BODY, maxWidth: 1120, gap: 24 }),

    // 3. 試讀第 1 課重點（白卡＋重點清單）。
    section("preview", [
      stack("preview_card", [
        text("preview_eyebrow", "DAY 1 試讀", "eyebrow", { color: PINK, letterSpacing: 3 }),
        headline("preview_title", "先別急著買燈，先找到家裡最好的那扇窗", "h2", { color: INK, fontSize: 32, lineHeight: 1.4 }, { mobile: { style: { fontSize: 24 } } }),
        text("preview_text", "第 1 課只做一件事：在家裡找一扇沒有直射陽光的窗，把商品放在窗邊，換三個位置各拍一張。你會發現，光的方向比手機型號重要得多。", undefined, { color: BODY }),
        node("preview_points", "icon_list", { layout: "list", numbered: true, accentColor: PINK, items: [
          { icon: "spark", title: "選對時間", text: "上午 10 點到下午 3 點的窗光最柔和，避開陽光直射。" },
          { icon: "target", title: "商品離窗一步", text: "太近會過曝，太遠會變暗，先從一步的距離開始試。" },
          { icon: "check", title: "關掉室內燈", text: "混到黃色燈光會讓白色商品偏色，只用窗光就好。" },
        ] }, undefined, { color: BODY, textAlign: "left" }),
      ], 18, { backgroundColor: BG, borderColor: INK, borderWidth: 2, borderRadius: 20, padding: 48, textAlign: "left", shadow: "medium" }, { tablet: { style: { padding: 36 } }, mobile: { style: { padding: 20 } } }),
    ], { background: BAND, color: BODY, maxWidth: 860, gap: 24 }),

    // 4. 前後對照（範本示意插畫）。
    section("compare", [
      title("compare_title", "BEFORE / AFTER", "同一支手機，換個做法就不一樣", "以下是範本示意插畫，請換成你或學員的實際對照照片。"),
      node("compare_cards", "image_cards", { columns: 3, aspect: "4:3", corners: false, accentColor: PINK, items: [
        { src: `${ART}/ba-light.svg`, alt: "光線前後對照示意：頂燈下偏黃發暗，窗光下明亮乾淨", title: "光線：頂燈 → 窗光", text: "關掉室內燈、移到窗邊，顏色馬上變乾淨。（Day 1）" },
        { src: `${ART}/ba-angle.svg`, alt: "角度前後對照示意：俯拍變形，平視比例正確", title: "角度：俯拍 → 平視", text: "有高度的商品用平視拍，比例才不會變形。（Day 3）" },
        { src: `${ART}/ba-background.svg`, alt: "背景前後對照示意：雜物桌面與乾淨背景", title: "背景：雜亂 → 留白", text: "收掉雜物、只留一個道具，視線自然落在商品上。（Day 4）" },
      ] }, undefined, { color: INK, textAlign: "left" }),
    ], { background: BG, color: BODY, maxWidth: 1180, gap: 44 }),

    // 5. 講師。
    section("teacher", [
      node("teacher_card", "speaker_profiles", { layout: "featured", photoShape: "portrait", accentColor: PINK, gradientFrom: PINK, gradientTo: INK, items: [
        { photo: `${ART}/teacher.svg`, alt: "柯宇辰的照片（請替換為講師照片）", name: "柯宇辰", role: "商品攝影師（虛構）", tags: "商品攝影,手機攝影,小品牌", bio: "幫上百個小品牌拍過商品照（範本示意經歷），也常被問「沒有棚燈怎麼辦」。這 7 封信是我給自己品牌客戶的第一份功課：先用手機拍好，再決定要不要花錢升級設備。" },
      ] }, undefined, { color: INK }),
    ], { background: BAND, color: BODY, maxWidth: 1040 }),

    // 6. 常見問題。
    section("faq", [
      title("faq_title", "FAQ", "開始之前"),
      node("faq_list", "faq", { items: [
        { question: "課程真的免費嗎？", answer: "免費。7 封信會連續寄到你的信箱，不需要信用卡。" },
        { question: "我的手機比較舊，也可以嗎？", answer: "可以。課程重點是光線、角度與背景，近幾年的手機都拍得出好效果。" },
        { question: "錯過某一天的信怎麼辦？", answer: "每封信都會留在信箱裡，可以照自己的步調做，不用每天準時。" },
        { question: "適合哪些商品？", answer: "飾品、杯盤、保養品、手作小物、食品包裝都適用；大型家具不在這次課程範圍。" },
      ] }, undefined, { color: BODY, textAlign: "left" }),
    ], { background: BG, color: BODY, maxWidth: 760, gap: 36, align: "center" }),

    // 7. 第二次表單（亮黃收尾）。
    section("again", [
      headline("again_title", "明天早上，第 1 課就在你的信箱", "h2", { color: INK, fontSize: 40, lineHeight: 1.35 }, { tablet: { style: { fontSize: 34 } }, mobile: { style: { fontSize: 26 } } }),
      text("again_text", "一扇窗、一支手機，就可以開始。", "lead", { color: INK }),
      form("again_form", {
        fields,
        submitLabel: "免費開始第 1 天",
        submitStyle: cta,
        note,
        style: { ...formCard, width: "min(100%, 520px)", margin: "0 auto" },
        mobile: { style: { padding: 18 } },
      }),
    ], { background: SUN, color: INK, maxWidth: 720, gap: 20, align: "center", paddingY: 104, paddingYMobile: 56 }),

    // 8. 頁尾。
    section("footer", [
      text("footer_text", "© 宇辰商品攝影教室（虛構）｜我們不會把你的 Email 提供給第三方。", "small", { color: FOOTER_TEXT }),
      button("footer_top", "回到頂端", "#optin", { backgroundColor: SUN, color: INK, borderRadius: 300, padding: "10px 22px", width: "fit-content", margin: "0 auto", fontSize: 15 }),
    ], { background: INK, color: FOOTER_TEXT, maxWidth: 960, paddingY: 40, paddingYTablet: 36, paddingYMobile: 28, gap: 12, align: "center" }),
  ];
}

export const template: ConversionTemplateDefinition = {
  id: "leads-email-course-photo",
  kind: "leads",
  number: 5,
  name: "免費 Email 課程名單頁",
  description: "亮黃首屏＋手機拍攝插圖：7 天課表時間軸、第 1 課試讀、前後對照、講師與 FAQ，亮黃收尾再放一次表單。",
  category: "Email 課程",
  purposes: ["leads"],
  styles: ["vivid"],
  preview: { eyebrow: "名單頁", headline: "7 天，用手機拍出好賣的商品照", summary: "亮黃首屏＋7 天課表", palette: [SUN, INK, PINK], sectionCount: 8 },
  theme: { typography: { headingFont: "sans-tc", bodyFont: "sans-tc", bodySize: 18, bodyLineHeight: 1.75, textColor: BODY, headingColor: INK, linkColor: INK }, background: { color: BG } },
  settings: { scrollReveal: "rise", stickyCta: { enabled: true, label: "免費開始第 1 天", target: "optin", showDate: false, devices: "mobile_tablet", buttonColor: INK, buttonTextColor: SUN, backgroundColor: SUN } },
  build,
  thankYou: {
    name: "Email 課程・名單感謝頁",
    description: "確認第 1 課已寄出、提醒收信，並推薦商品攝影完整課。",
    tokens: { background: BAND, surface: BG, ink: INK, body: BODY, accent: INK, onAccent: SUN, line: LINE, footerBackground: INK, footerText: FOOTER_TEXT, radius: 14 },
    eyebrow: "第 1 課已寄出",
    title: "打開信箱，今天就拍第一張",
    intro: "幾分鐘內會收到標題為「Day 1｜找到家裡最好的那扇窗」的信。沒看到的話，請檢查促銷內容或垃圾郵件匣。",
    card: { title: "7 天手機商品攝影 Email 課", text: "第 1 課已經寄出，之後每天早上 8 點寄一課，連續 7 天。每封信 5 分鐘讀完，附一個 10 分鐘的小作業。", buttonLabel: "看看接下來怎麼做", buttonHref: "#ty-steps" },
    steps: [
      { icon: "message", title: "加入通訊錄", text: "把寄件者加入通訊錄，接下來 6 封課程信才不會被分到促銷匣。" },
      { icon: "spark", title: "準備一扇窗和一支手機", text: "找一扇沒有陽光直射的窗，再挑一件你最想拍好的商品。" },
      { icon: "clock", title: "明天收第 2 課", text: "先完成第 1 課的作業，明天早上會收到「白紙就是反光板」。" },
    ],
    next: { eyebrow: "想拍得更完整？", title: "商品攝影完整課", text: "6 堂錄影課＋作業批改，從構圖、道具搭配到賣場主圖規格，一次把整組賣場照拍好。", buttonLabel: "了解完整課", buttonHref: "#ty-steps" },
    footer: "© 宇辰商品攝影教室（虛構）｜如需取消訂閱，可點擊信件底部的退訂連結。",
  },
};
