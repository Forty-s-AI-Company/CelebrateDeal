import { WEBINAR_TEMPLATE_SAMPLE_MARK, webinarTemplateKit, type WebinarTemplateDefinition } from "./types";

/**
 * 範本 08：行銷線上峰會報名頁（specs/08-marketing-summit.md）。
 * 深紫夜色＋紫粉光暈的研討會首屏、超大標題與講者頭像疊排；講者牆 8 人、
 * 4 個時段的議程、合作夥伴與往屆片段，最後切換到淺紫的報名區製造「抵達」感。
 * 講者、Logo 與數據都是明顯的示意內容，插圖在 public/funnel-illustrations/webinar/08/。
 */
const ART = "/funnel-illustrations/webinar/08";
const BG = "#0b0820";
const SURFACE = "#1a1440";
const INK = "#ffffff";
const BODY = "#d6d3f0";
const MUTED = "#a9a4d6";
const PINK = "#ff4d8d";
const LAVENDER = "#b79cff";
const LIGHT_BG = "#f7f5ff";
const LIGHT_INK = "#1a1440";
const LIGHT_BODY = "#3d3566";

function build(prefix: string) {
  const { node, section, stack, headline, text, button, form } = webinarTemplateKit(prefix);
  const pinkButton = { backgroundColor: PINK, color: BG, borderRadius: 100, fontSize: 18, padding: "16px 40px" } as const;
  const eyebrow = (id: string, value: string, color = LAVENDER) => text(id, value, "eyebrow", { color, textAlign: "center" });
  const h2 = (id: string, value: string, color = INK) => headline(id, value, "h2", { color, fontSize: 40, lineHeight: 1.25, textAlign: "center" }, { tablet: { style: { fontSize: 34 } }, mobile: { style: { fontSize: 28 } } });
  const speaker = (letter: string, role: string, bio: string, tags: string) => ({ photo: `${ART}/speaker-${letter.toLowerCase()}.svg`, alt: `講者 ${letter} 的照片（請替換）`, name: `講者姓名 ${letter}`, role, bio, tags });
  return [
    // 1. 公告條（開播倒數綁漏斗排程）。
    node("announce", "announcement_bar", { text: "早鳥報名中｜{{webinar.date}}｜線上舉行・免費參加", showCountdown: true, countdownLabel: "距離開場", barColor: PINK, barTextColor: BG }),
    // 2. 導覽列（固定在頂端，錨點平滑捲動）。
    node("nav", "nav_bar", { brand: "成長派社群", homeHref: "#top", sticky: true, accentColor: PINK, ctaLabel: "免費報名", ctaHref: "#register", items: [
      { label: "講者", href: "#speakers" },
      { label: "議程", href: "#agenda" },
      { label: "常見問題", href: "#faq" },
    ], socials: [] }, undefined, { backgroundColor: BG, color: INK }),
    // 3. 首屏：紫粉光暈、超大標題、活動資訊與講者頭像疊排。
    section("hero", [
      eyebrow("hero_eyebrow", "ONLINE SUMMIT・一天 4 場・免費參加"),
      headline("hero_title", "小品牌的下一步成長，\n聽 8 位操盤手說真話", "h1", { color: INK, fontSize: 64, lineHeight: 1.15, textAlign: "center" }, { tablet: { style: { fontSize: 48 } }, mobile: { style: { fontSize: 34, lineHeight: 1.25 }, props: { text: "小品牌的下一步成長，聽 8 位操盤手說真話" } } }),
      text("hero_lead", "品牌定位、內容、廣告到會員經營，一天聽完 4 個時段的實戰分享與對談，帶走能直接套用的做法。", "lead", { color: BODY, textAlign: "center" }),
      node("hero_facts", "event_facts", { layout: "row", formatLabel: "線上峰會", priceLabel: "免費", showDuration: false, align: "center", accentColor: PINK }, undefined, { color: INK }),
      button("hero_cta", "免費報名峰會", "#register", pinkButton),
      node("hero_speakers", "image", { src: `${ART}/speakers-stack.svg`, alt: "8 位講者頭像示意" }, undefined, { imageWidth: 26 }, { tablet: { style: { imageWidth: 40 } }, mobile: { style: { imageWidth: 62 } } }),
      text("hero_speakers_note", "8 位品牌操盤手・4 個主題時段", "small", { color: MUTED, textAlign: "center" }),
    ], {
      background: BG, color: BODY, maxWidth: 960, gap: 28, align: "center", paddingY: 120, paddingYTablet: 88, paddingYMobile: 48, htmlId: "top",
      props: { backgroundImage: `${ART}/hero-glow.svg`, backgroundPosition: "top" },
    }),
    // 4. 峰會數據（示意）。
    section("numbers", [
      node("numbers_stats", "stats", { animate: true, framed: false, accentColor: LAVENDER, items: [
        { value: "8", suffix: "位", label: "實戰講者" },
        { value: "4", suffix: "場", label: "主題時段" },
        { value: "12000", suffix: "+", label: `往年參加人次（${WEBINAR_TEMPLATE_SAMPLE_MARK}）` },
      ] }, undefined, { color: INK }),
    ], { background: SURFACE, color: BODY, maxWidth: 1000, paddingY: 64, paddingYMobile: 48 }),
    // 5. 講者牆（8 人，桌機 4 欄、平板與手機 2 欄以內）。
    section("speakers", [
      eyebrow("speakers_eyebrow", "SPEAKERS"),
      h2("speakers_title", "這次上台的 8 位操盤手"),
      node("speakers_wall", "speaker_profiles", { layout: "grid", columns: 4, photoShape: "portrait", accentColor: PINK, items: [
        speaker("A", "品牌創辦人", "從市集攤位做到全通路的生活選物品牌。", "品牌定位"),
        speaker("B", "品牌顧問", "協助小品牌找出一句話就說得清楚的定位。", "品牌定位"),
        speaker("C", "內容總監", "經營百萬觸及的品牌內容與社群。", "內容行銷"),
        speaker("D", "Podcast 主持人", "用聲音內容累積死忠聽眾與訂閱。", "內容行銷"),
        speaker("E", "廣告投手", "負責多個電商品牌的廣告投放與素材測試。", "廣告投放"),
        speaker("F", "成長行銷經理", "專長小預算的轉換優化與數據追蹤。", "廣告投放"),
        speaker("G", "會員經營顧問", "設計讓顧客願意回購的會員制度。", "會員經營"),
        speaker("H", "LINE 社群操盤手", "經營數萬人的品牌官方帳號與社群。", "會員經營"),
      ] }, undefined, { color: INK, textAlign: "left" }, { mobile: { props: { photoShape: "square" } } }),
    ], { background: BG, color: BODY, maxWidth: 1200, gap: 24, align: "center", htmlId: "speakers" }),
    // 6. 議程（4 時段，每場 2 位講者分享＋對談）。
    section("agenda", [
      eyebrow("agenda_eyebrow", "AGENDA"),
      h2("agenda_title", "一天 4 個時段，從定位走到回購"),
      stack("agenda_panel", [
        node("agenda_list", "agenda_timeline", { layout: "vertical", accentColor: LAVENDER, items: [
          { time: "13:00", title: "品牌定位：小品牌的一句話策略", text: "怎麼在大品牌之間找到只有你能說的位置。", speaker: "講者姓名 A × 講者姓名 B", tag: "分享＋對談" },
          { time: "14:30", title: "內容行銷：讓顧客主動找上門", text: "從選題、產製到分發，一套小團隊做得到的節奏。", speaker: "講者姓名 C × 講者姓名 D", tag: "分享＋對談" },
          { time: "16:00", title: "廣告投放：小預算的素材測試", text: "每月預算有限時，先測什麼、怎麼判斷該停。", speaker: "講者姓名 E × 講者姓名 F", tag: "分享＋對談" },
          { time: "19:30", title: "會員經營：讓第一次購買變成第十次", text: "會員分級、LINE 推播與回購活動的實際案例。", speaker: "講者姓名 G × 講者姓名 H", tag: "分享＋對談" },
        ] }, undefined, { color: INK, textAlign: "left" }),
      ], 0, { backgroundColor: SURFACE, borderRadius: 20, padding: 40 }, { mobile: { style: { padding: 20 } } }),
      text("agenda_note", "時段為示意，實際日期與時間以報名確認信為準。", "small", { color: MUTED, textAlign: "center" }),
    ], { background: BG, color: BODY, maxWidth: 860, gap: 24, align: "center", htmlId: "agenda" }),
    // 7. 合作夥伴（虛構字標）。
    section("partners", [
      node("partners_logos", "logo_strip", { title: `合作夥伴（${WEBINAR_TEMPLATE_SAMPLE_MARK}）`, tone: "light", logoHeight: 34, items: [
        { src: `${ART}/logo-mossline.svg`, alt: "MOSSLINE（示意 Logo）" },
        { src: `${ART}/logo-brightnook.svg`, alt: "Brightnook（示意 Logo）" },
        { src: `${ART}/logo-oakmere.svg`, alt: "OAKMERE（示意 Logo）" },
        { src: `${ART}/logo-tidepine.svg`, alt: "Tidepine（示意 Logo）" },
        { src: `${ART}/logo-quillora.svg`, alt: "Quillora（示意 Logo）" },
      ] }, undefined, { color: BODY }),
    ], { background: SURFACE, color: BODY, maxWidth: 1100, paddingY: 56, paddingYMobile: 40 }),
    // 8. 歷屆精彩片段（3 支，佔位封面）。
    section("replays", [
      eyebrow("replays_eyebrow", "HIGHLIGHTS"),
      h2("replays_title", "先看看往屆的現場"),
      node("replays_videos", "video_gallery", { columns: 3, accentColor: PINK, items: [
        { url: "", title: "往屆片段：品牌定位對談", thumbnail: `${ART}/replay-1.svg` },
        { url: "", title: "往屆片段：內容行銷實戰", thumbnail: `${ART}/replay-2.svg` },
        { url: "", title: "往屆片段：廣告投放拆解", thumbnail: `${ART}/replay-3.svg` },
      ] }, undefined, { color: INK, textAlign: "left" }),
    ], { background: BG, color: BODY, maxWidth: 1200, gap: 24, align: "center" }),
    // 9. 報名表（淺紫區塊）。
    section("register", [
      eyebrow("register_eyebrow", "REGISTER", "#5b3fc4"),
      h2("register_title", "免費保留你的峰會席次", LIGHT_INK),
      text("register_lead", "開場時間：{{webinar.startAt}}。報名一次就能參加全部 4 個時段。", undefined, { color: LIGHT_BODY, textAlign: "center" }),
      form("register_form", {
        fields: [
          { name: "name", label: "姓名", placeholder: "王小明", required: true, half: true },
          { name: "email", label: "Email", type: "email", placeholder: "name@example.com", required: true, half: true },
        ],
        submitLabel: "免費報名峰會",
        submitStyle: { ...pinkButton, padding: "16px 24px" },
        note: "報名即表示同意接收本次峰會相關通知，可隨時取消訂閱。",
        htmlId: "register",
        style: { backgroundColor: "#ffffff", color: LIGHT_INK, padding: 36, borderRadius: 20, borderColor: "#ddd6fe", borderWidth: 1, shadow: "soft", textAlign: "left", width: 100 },
        mobile: { style: { padding: 16 } },
      }),
    ], { background: LIGHT_BG, color: LIGHT_BODY, maxWidth: 640, gap: 20, align: "center" }),
    // 10. FAQ（淺紫延續）。
    section("faq", [
      h2("faq_title", "常見問題", LIGHT_INK),
      node("faq_list", "faq", { items: [
        { question: "可以只看其中一場嗎？", answer: "可以。報名一次就能參加全部時段，挑你有興趣的場次進場即可。" },
        { question: "有回放嗎？", answer: "依主辦單位的回放設定，報名者會收到回放資訊。" },
        { question: "講者簡報會提供嗎？", answer: "經講者同意公開的簡報，會在峰會後寄給報名者。" },
        { question: "可以團體報名嗎？", answer: "可以，請每位參加者各自填寫報名表，才能收到專屬的進場連結。" },
        { question: "如何成為合作夥伴？", answer: "歡迎透過報名確認信中的聯絡方式與主辦單位聯繫。" },
      ] }, undefined, { textAlign: "left", color: LIGHT_INK }),
    ], { background: LIGHT_BG, color: LIGHT_BODY, maxWidth: 760, gap: 28, align: "center", paddingY: 40, paddingYMobile: 32, htmlId: "faq" }),
    // 11. 頁尾 CTA。
    section("footer_cta", [
      headline("footer_title", "8 位操盤手，一天說完他們的真心話", "h2", { color: INK, fontSize: 40, lineHeight: 1.3, textAlign: "center" }, { tablet: { style: { fontSize: 34 } }, mobile: { style: { fontSize: 26 } } }),
      text("footer_date", "{{webinar.startAt}}・線上峰會・免費參加", undefined, { color: BODY, textAlign: "center" }),
      button("footer_button", "免費報名峰會", "#register", pinkButton),
    ], {
      background: BG, color: BODY, maxWidth: 760, gap: 24, align: "center", paddingY: 104,
      props: { backgroundImage: `${ART}/hero-glow.svg`, backgroundPosition: "bottom" },
    }),
  ];
}

export const template: WebinarTemplateDefinition = {
  id: "webinar-marketing-summit",
  number: 8,
  name: "行銷線上峰會報名頁",
  description: "深紫光暈的線上峰會頁：超大標題、8 人講者牆、4 時段議程、合作夥伴與往屆片段。",
  category: "線上峰會",
  purposes: ["webinar"],
  styles: ["vivid"],
  preview: { eyebrow: "Summit", headline: "行銷線上峰會報名頁", summary: "深紫光暈＋講者牆", palette: [BG, PINK, LAVENDER], sectionCount: 11 },
  theme: { typography: { headingFont: "sans-tc", bodyFont: "sans-tc", bodySize: 17, bodyLineHeight: 1.75, textColor: BODY, headingColor: INK, linkColor: LAVENDER }, background: { color: BG } },
  settings: {
    eventTitle: "2026 小品牌成長線上峰會：8 位操盤手的實戰分享",
    scrollReveal: "rise",
    stickyCta: { enabled: true, label: "免費報名峰會", showDate: true, devices: "mobile_tablet", buttonColor: PINK, buttonTextColor: BG, backgroundColor: BG },
  },
  build,
};
