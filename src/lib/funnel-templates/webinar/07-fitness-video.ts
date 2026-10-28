import { WEBINAR_TEMPLATE_SAMPLE_MARK, webinarTemplateKit, type WebinarTemplateDefinition } from "./types";

/**
 * 範本 07：健身影片預告報名頁（specs/07-fitness-video.md）。
 * 全黑頁面＋螢光綠唯一高彩度色，斜切分隔製造動感；首屏右側是 16:9 預告影片
 * （影片牆元件：沒有網址時顯示封面，貼上 YouTube 網址後按下播放才載入），
 * 報名區切換成螢光綠底。插圖在 public/funnel-illustrations/webinar/07/。
 */
const ART = "/funnel-illustrations/webinar/07";
const BG = "#0d0d0f";
const SURFACE = "#18181b";
const INK = "#fafafa";
const BODY = "#d4d4d8";
const LIME = "#d7ff3a";
const CORAL = "#ff6a4d";

function build(prefix: string) {
  const { node, section, columns2, stack, headline, text, button, form } = webinarTemplateKit(prefix);
  const limeButton = { backgroundColor: LIME, color: BG, borderRadius: 8, fontSize: 18, padding: "16px 34px" } as const;
  /** 英文眉標＋可用 *星號* 標出螢光綠重點字的標題；`mobileTitle` 是手機版不含換行的文字。 */
  const title = (id: string, eyebrow: string, value: string, options: { level?: "h1" | "h2"; subtitle?: string; mobileTitle?: string } = {}) =>
    node(id, "section_title", { eyebrow, title: value, subtitle: options.subtitle ?? "", level: options.level ?? "h2", decoration: "none", accentColor: LIME }, undefined, { color: INK },
      options.mobileTitle ? { mobile: { props: { title: options.mobileTitle } } } : {});
  const slant = (id: string, fill: string, behind: string, flip = false) =>
    node(id, "shape_divider", { shape: "slant", position: "top", height: 88, flip }, undefined, { color: fill, backgroundColor: behind }, { tablet: { props: { height: 64 } }, mobile: { props: { height: 40 } } });
  return [
    // 1. 首屏：左文案、右 16:9 預告；手機影片在上。
    section("hero", [
      columns2("hero_columns", [
        title("hero_title", "FREE LIVE WORKOUT · 20 MIN", "不跳躍、不吵鄰居，\n在家 *20 分鐘*練到流汗", { level: "h1", mobileTitle: "不跳躍、不吵鄰居，在家 *20 分鐘*練到流汗" }),
        text("hero_lead", "跟著教練在客廳直播跟練：4 個低衝擊動作組合，膝蓋友善、樓下聽不到，練完一樣全身發熱。", "lead", { color: BODY }),
        button("hero_cta", "報名免費跟練", "#register", limeButton),
        node("hero_facts", "event_facts", { layout: "row", formatLabel: "直播跟練", priceLabel: "免費", showDuration: true, accentColor: LIME }, undefined, { color: INK }),
      ], [
        node("hero_video", "video_gallery", { columns: 1, accentColor: LIME, items: [
          { url: "", title: "60 秒預告：4 個動作搶先看", thumbnail: `${ART}/trailer-poster.svg` },
        ] }, undefined, { color: INK }),
      ], { ratio: "1:1", gap: 56, mobileOrder: "reverse", stackOn: "tablet", align: "center" }),
    ], { background: BG, color: BODY, maxWidth: 1200, gap: 0, paddingY: 88, paddingYTablet: 64, paddingYMobile: 28 }),
    // 2. 斜切分隔（深灰 → 動作預覽）。
    slant("divider_moves", SURFACE, BG),
    // 3. 4 個動作預覽。
    section("moves", [
      title("moves_title", "4 MOVES", "直播會帶你練的 *4 個動作*", { subtitle: "每個動作都有簡易版與進階版，跟不上也不會被落下。" }),
      node("moves_cards", "image_cards", { columns: 4, aspect: "4:3", corners: false, accentColor: LIME, items: [
        { src: `${ART}/move-squat-press.svg`, alt: "深蹲推舉的線條動作示意", title: "深蹲推舉", text: "下蹲同時把水瓶推過頭，練腿也練肩。" },
        { src: `${ART}/move-mountain-climber.svg`, alt: "慢速登山者的線條動作示意", title: "登山者慢速版", text: "不跳躍、一步一步換腳，核心持續出力。" },
        { src: `${ART}/move-side-plank.svg`, alt: "側棒式轉體的線條動作示意", title: "側棒式轉體", text: "側腰與肩膀的穩定度，一次練到。" },
        { src: `${ART}/move-glute-bridge.svg`, alt: "臀橋行走的線條動作示意", title: "臀橋行走", text: "躺著也能練，喚醒久坐沉睡的臀部。" },
      ] }, undefined, { color: INK }, { mobile: { props: { aspect: "16:9" } } }),
    ], { background: SURFACE, color: BODY, maxWidth: 1200, gap: 44, paddingY: 72, paddingYMobile: 48 }),
    slant("divider_gain", BG, SURFACE, true),
    // 4. 你會得到。
    section("gain", [
      title("gain_title", "WHAT YOU GET", "報名就能帶走的 *3 樣東西*"),
      stack("gain_panel", [
        node("gain_list", "icon_list", { layout: "grid", columns: 3, numbered: false, accentColor: LIME, items: [
          { icon: "clock", title: "4 週跟練課表", text: "每週 3 次、每次 20 分鐘，照表練就好。" },
          { icon: "check", title: "動作錯誤檢查表", text: "膝蓋內夾、腰部塌陷，對照圖片自己修正。" },
          { icon: "message", title: "直播限定動作提問", text: "直播中打字提問，教練當場示範調整。" },
        ] }, undefined, { color: INK, textAlign: "left" }),
      ], 0, { padding: 40, backgroundColor: SURFACE, borderRadius: 12 }, { mobile: { style: { padding: 24 } } }),
    ], { background: BG, color: BODY, maxWidth: 1200, gap: 44, paddingY: 72, paddingYMobile: 48 }),
    // 5. 學員評價（感受與習慣，不放體重數字或對比照）。
    section("reviews", [
      title("reviews_title", "REAL TALK", "跟練過的人，*最有感的改變*"),
      node("reviews_wall", "testimonial_wall", { layout: "carousel", columns: 3, autoplay: false, showRating: false, accentColor: LIME, cardColor: BG, cardTextColor: INK, items: [
        { name: "學員 A｜上班族", title: `下班後終於有動力動一動（${WEBINAR_TEMPLATE_SAMPLE_MARK}）`, text: "20 分鐘剛好，換完衣服就開始，不用出門也不用想今天要練什麼。" },
        { name: "學員 B｜新手媽媽", title: `孩子睡了也能練（${WEBINAR_TEMPLATE_SAMPLE_MARK}）`, text: "不用跳，完全不怕吵醒小孩。練完肩頸比較不緊，睡得也比較好。" },
        { name: "學員 D｜自由工作者", title: `在家也能固定運動（${WEBINAR_TEMPLATE_SAMPLE_MARK}）`, text: "以前總找藉口說沒時間去健身房，現在每週三次，打開直播就開始，已經變成生活節奏的一部分。" },
        { name: "學員 E｜銀髮族家屬", title: `全家一起跟練（${WEBINAR_TEMPLATE_SAMPLE_MARK}）`, text: "動作有簡易版，爸媽也能跟上。看他們每天在客廳動一動，我們都覺得很安心。" },
        { name: "學員 F｜學生", title: `考試期間也能放鬆（${WEBINAR_TEMPLATE_SAMPLE_MARK}）`, text: "念書念到肩頸僵硬時跟著練一輪，二十分鐘就覺得整個人清醒不少。" },
        { name: "學員 C｜工程師", title: `爬樓梯不再喘（${WEBINAR_TEMPLATE_SAMPLE_MARK}）`, text: "連續跟了一個月，最明顯的是體力變好，久坐的腰也舒服很多。" },
      ] }, undefined, { textAlign: "left" }),
    ], { background: SURFACE, color: BODY, maxWidth: 1200, gap: 44, paddingY: 88, paddingYMobile: 56 }),
    // 6. 教練介紹。
    section("coach", [
      title("coach_title", "YOUR COACH", "嗨，我是 *凱文教練*"),
      node("coach_card", "speaker_profiles", { layout: "featured", photoShape: "portrait", accentColor: CORAL, items: [
        { photo: `${ART}/coach.svg`, alt: "黃凱文教練的照片（請替換）", name: "黃凱文", role: "體能教練・「凱文的客廳健身房」主理人", bio: "專攻小空間、低衝擊的居家訓練，帶過上班族、產後媽媽與銀髮族。相信運動不用很痛苦，只要每天做一點、做得對。", tags: "居家訓練,低衝擊課表" },
      ] }, undefined, { color: INK, textAlign: "left" }),
      node("coach_stats", "stats", { animate: true, framed: false, accentColor: LIME, items: [
        { value: "8", suffix: "年", label: `教學經驗（${WEBINAR_TEMPLATE_SAMPLE_MARK}）` },
        { value: "3200", suffix: "+", label: `跟練學員（${WEBINAR_TEMPLATE_SAMPLE_MARK}）` },
        { value: "20", suffix: "分", label: "每次跟練長度" },
      ] }, undefined, { color: INK }),
    ], { background: BG, color: BODY, maxWidth: 1080, gap: 48 }),
    // 7. 報名表（螢光綠底，區塊內文字一律黑色）。
    slant("divider_register", LIME, BG),
    section("register", [
      columns2("register_columns", [
        text("register_eyebrow", "免費直播跟練", "eyebrow", { color: BG }),
        headline("register_title", "今晚就在客廳，\n跟我一起練到流汗", "h2", { color: BG, fontSize: 40, lineHeight: 1.25 }, { tablet: { style: { fontSize: 34 } }, mobile: { style: { fontSize: 28 }, props: { text: "今晚，在客廳一起流汗" } } }),
        text("register_lead", "直播時間：{{webinar.startAt}}", "lead", { color: BG }),
        text("register_points", "✓ 準備一張瑜伽墊與一瓶水\n✓ 直播連結會寄到你的信箱\n✓ 報名就送 4 週跟練課表", undefined, { color: BG, lineHeight: 1.9 }),
      ], [
        form("register_form", {
          title: "免費報名跟練",
          fields: [
            { name: "name", label: "姓名", placeholder: "王小明", required: true },
            { name: "email", label: "Email", type: "email", placeholder: "name@example.com", required: true, helpText: "直播連結與課表會寄到這裡" },
          ],
          submitLabel: "報名免費跟練",
          submitStyle: { backgroundColor: BG, color: LIME, borderRadius: 8, fontSize: 18 },
          note: "報名即表示同意接收本場直播相關通知，可隨時取消訂閱。",
          htmlId: "register",
          style: { backgroundColor: "#ffffff", color: BG, padding: 32, borderRadius: 12, textAlign: "left", width: 100 },
          mobile: { style: { padding: 16 } },
        }),
      ], { ratio: "1:1", gap: 56, stackOn: "tablet", align: "center" }),
    ], { background: LIME, color: BG, maxWidth: 1080, paddingY: 64, paddingYMobile: 40 }),
    // 8. 安全提醒＋FAQ。
    section("faq", [
      stack("faq_safety", [
        text("faq_safety_text", "安全提醒：如有心血管疾病、孕期或受傷，請先諮詢醫師；運動中感到不適請立即停止。", "small", { color: INK }),
      ], 8, { backgroundColor: SURFACE, borderColor: CORAL, borderWidth: 1, borderRadius: 12, padding: 20 }),
      headline("faq_title", "常見問題", "h2", { color: INK, fontSize: 38 }, { tablet: { style: { fontSize: 32 } }, mobile: { style: { fontSize: 26 } } }),
      node("faq_list", "faq", { items: [
        { question: "需要準備器材嗎？", answer: "不用。一張瑜伽墊就夠了；想加強的話，可以用裝滿水的寶特瓶當啞鈴。" },
        { question: "體能很差也可以跟嗎？", answer: "可以。每個動作都會示範簡易版，跟不上就先做簡易版，循序漸進。" },
        { question: "樓下會聽到嗎？", answer: "整堂課沒有跳躍動作，落地都很輕，住公寓也能放心練。" },
        { question: "沒辦法準時參加，有回放嗎？", answer: "依主辦單位的回放設定，報名後會收到回放資訊。" },
      ] }, undefined, { textAlign: "left", color: INK }),
    ], { background: BG, color: BODY, maxWidth: 760, gap: 28, paddingY: 88, paddingYMobile: 56 }),
    // 9. 頁尾 CTA。
    section("footer_cta", [
      title("footer_title", "READY?", "20 分鐘，*現在就開始*"),
      text("footer_date", "{{webinar.startAt}}・線上直播跟練", "lead", { color: BODY }),
      button("footer_button", "報名免費跟練", "#register", limeButton),
    ], { background: SURFACE, color: BODY, maxWidth: 720, gap: 28, align: "center", paddingY: 88, paddingYMobile: 56 }),
  ];
}

export const template: WebinarTemplateDefinition = {
  id: "webinar-fitness-video",
  number: 7,
  name: "健身影片預告報名頁",
  description: "黑底螢光綠的動感頁：首屏 16:9 預告影片、4 個動作預覽、斜切分隔與螢光綠報名區。",
  category: "健身運動講座",
  purposes: ["webinar"],
  styles: ["vivid"],
  preview: { eyebrow: "Webinar", headline: "健身影片預告報名頁", summary: "黑底螢光綠＋預告影片", palette: [BG, LIME, CORAL], sectionCount: 11 },
  theme: { typography: { headingFont: "sans-tc", bodyFont: "sans-tc", bodySize: 17, bodyLineHeight: 1.75, textColor: BODY, headingColor: INK, linkColor: LIME }, background: { color: BG } },
  settings: {
    eventTitle: "在家 20 分鐘的燃脂訓練：不跳躍也有效的 4 個動作組合",
    scrollReveal: "rise",
    stickyCta: { enabled: true, label: "報名免費跟練", showDate: true, devices: "mobile_tablet", buttonColor: LIME, buttonTextColor: BG, backgroundColor: BG },
  },
  build,
};
