import { webinarTemplateKit, type WebinarTemplateDefinition } from "./types";

/**
 * 範本 20：醫美衛教講座合規報名頁（specs/20-aesthetic-clinic.md）。
 * 乾淨、柔和、可信：暖白底、玫瑰灰點綴、襯線標題；首屏右側是講座資訊側欄（活動資訊＋表單＋隱私說明）。
 * 合規前提：只談衛教，不放療效保證、術前術後對比、價格促銷或名人推薦（單元測試檢查禁用詞）。
 * 醫師與診所皆為虛構；證書字號、地址與醫療機構代碼是佔位，商家套用後必須替換並自行確認法規。
 */
const ART = "/funnel-illustrations/webinar/20";
const BG = "#fffaf8";
const BLUSH = "#f7ebe8";
const INK = "#3a2a2e";
const BODY = "#574549";
const MUTED = "#6f5f62";
const PRIMARY = "#9c4a5c";
const CLINIC = "澄光皮膚科診所";

/** Words a medical advert must not use (醫療法／醫療廣告規範精神); the template test scans every string for them. */
export const AESTHETIC_CLINIC_BANNED_WORDS = ["保證", "最", "第一", "根治", "永久", "優惠價", "術前術後"] as const;

function build(prefix: string) {
  const { node, section, columns2, stack, headline, text, button, form } = webinarTemplateKit(prefix);
  const primaryButton = { backgroundColor: PRIMARY, color: "#ffffff", borderRadius: 8 } as const;
  const title = (id: string, eyebrow: string, value: string, subtitle = "", align: "left" | "center" = "center") => node(id, "section_title", { eyebrow, title: value, subtitle, level: "h2", decoration: "line", eyebrowItalic: true, accentColor: PRIMARY }, undefined, { color: INK, textAlign: align });
  const doctorCard = (id: string, options: Parameters<typeof node>[5]) => node(id, "speaker_profiles", { layout: "featured", size: "small", photoShape: "circle", accentColor: PRIMARY, items: [
    { photo: `${ART}/doctor.svg`, alt: "方怡如醫師的照片（請替換）", name: "方怡如 醫師", role: `皮膚科專科醫師｜${CLINIC}` },
  ] }, undefined, { color: INK, backgroundColor: "#ffffff", padding: 24, borderRadius: 16, borderColor: BLUSH, borderWidth: 1 }, options);

  return [
    // 1. 簡潔頁首：診所字標＋報名錨點（不固定，避免和固定報名列重複）。
    node("nav", "nav_bar", { brand: CLINIC, homeHref: "#top", sticky: false, accentColor: PRIMARY, ctaLabel: "報名講座", ctaHref: "#register", items: [] }, undefined, { backgroundColor: BG, color: INK }),
    // 2. 首屏：左文字＋醫師小卡，右講座資訊側欄；手機順序 H1 → 側欄（表單）→ 醫師小卡。
    section("hero", [
      // 右欄是有底色的側欄卡片：直接放進 columns_2（content_box 不可再巢狀 content_box）。
      node("hero_columns", "columns_2", { ratio: "7:5", stackOn: "tablet", gap: 64 }, [stack("hero_columns_left", [
        text("hero_eyebrow", "線上衛教講座｜免費參加", "eyebrow", { color: PRIMARY, letterSpacing: 3 }),
        headline("hero_title", "保養品能做到什麼？\n認識肌膚老化與正確保養", "h1", { fontSize: 44, lineHeight: 1.3, color: INK }, { tablet: { style: { fontSize: 38 } }, mobile: { style: { fontSize: 28, lineHeight: 1.35 }, props: { text: "保養品能做到什麼？\n認識肌膚老化與正確保養" } } }),
        text("hero_lead", "由皮膚科專科醫師說明老化成因、日常保養與防曬觀念，幫助你在考慮任何療程前做出更好的判斷。", "lead", { color: BODY }, { mobile: { props: { text: "皮膚科專科醫師說明老化成因、日常保養與防曬觀念，在考慮療程前先做好功課。" } } }),
        doctorCard("hero_doctor", { tablet: { visible: false }, mobile: { visible: false } }),
      ], 20),
        stack("hero_sidebar", [
          node("hero_facts", "event_facts", { layout: "card", title: "講座資訊", formatLabel: "線上直播", priceLabel: "免費", accentColor: PRIMARY, cardColor: "#ffffff", cardTextColor: INK }, undefined, { color: INK }, { mobile: { props: { layout: "row" } } }),
          form("hero_form", {
            title: "報名衛教講座",
            fields: [
              { name: "name", label: "姓名", placeholder: "王小明", required: true },
              { name: "email", label: "Email", type: "email", placeholder: "name@example.com", required: true, helpText: "講座連結會寄到這個信箱" },
            ],
            submitLabel: "免費報名",
            submitStyle: { ...primaryButton, fontSize: 18 },
            htmlId: "register",
            style: { color: INK, textAlign: "left", width: 100 },
          }),
          text("hero_privacy", "資料僅用於寄送講座資訊，不會用於療程推銷電話。（商家請依實際作法修改）", "small", { color: MUTED }),
        ], 20, { backgroundColor: BLUSH, padding: 32, borderRadius: 20, color: INK }, { mobile: { style: { padding: 16 } } }),
      ], { align: "center" }, { tablet: { props: { gap: 40 } }, mobile: { props: { gap: 24 } } }),
      doctorCard("hero_doctor_stacked", { desktop: { visible: false }, tablet: { visible: true }, mobile: { visible: true } }),
    ], { background: BG, color: BODY, maxWidth: 1120, gap: 28, paddingY: 72, paddingYTablet: 56, paddingYMobile: 28, htmlId: "top" }),
    // 3. 你將了解（衛教主題 4 點，2×2）
    section("learn", [
      title("learn_title", "What you'll learn", "這場講座，你將了解"),
      columns2("learn_columns", [
        node("learn_left", "icon_list", { layout: "list", numbered: false, accentColor: PRIMARY, items: [
          { icon: "leaf", title: "肌膚老化的內外因素", text: "年齡、紫外線、睡眠與生活習慣，各自扮演什麼角色。" },
          { icon: "shield", title: "防曬係數怎麼看", text: "SPF 與 PA 的意義、用量與補擦的時機。" },
        ] }, undefined, { color: INK }),
      ], [
        node("learn_right", "icon_list", { layout: "list", numbered: false, accentColor: PRIMARY, items: [
          { icon: "book", title: "保養品成分的基本觀念", text: "看懂成分表的順序，認識常見成分的作用與限制。" },
          { icon: "heart", title: "什麼情況該就醫", text: "哪些肌膚狀況不適合自行處理，應該由醫師評估。" },
        ] }, undefined, { color: INK }),
      ], { ratio: "1:1", gap: 48 }),
    ], { background: BLUSH, color: BODY, maxWidth: 1000, gap: 48 }),
    // 4. 肌膚老化的 3 個主題（衛教圖解，無人臉）
    section("stages", [
      title("stages_title", "Skin basics", "三張圖，認識肌膚老化", "一般衛教知識示意，個人狀況請由醫師評估。"),
      node("stages_cards", "image_cards", { columns: 3, aspect: "4:3", corners: false, accentColor: PRIMARY, items: [
        { src: `${ART}/stage-1.svg`, alt: "皮膚分層示意圖：表皮、真皮與皮下組織", title: "皮膚的三層結構", text: "隨著年齡增長，真皮層的膠原蛋白會逐漸減少，這是自然的老化過程。" },
        { src: `${ART}/stage-2.svg`, alt: "防曬標示示意圖：紫外線與 SPF、PA 標示", title: "紫外線與光老化", text: "日常紫外線是外在老化的主要因素之一，規律防曬是基本的保養習慣。" },
        { src: `${ART}/stage-3.svg`, alt: "保養品瓶罐線條示意圖：成分表的閱讀方式", title: "保養品的角色", text: "保養品著重於清潔、保濕與防曬；若有特定肌膚問題，應尋求醫師評估。" },
      ] }, undefined, { color: INK, textAlign: "left" }),
    ], { background: BG, color: BODY, maxWidth: 1120, gap: 48 }),
    // 5. 講座流程（3 步）
    section("flow", [
      title("flow_title", "How it works", "講座流程"),
      node("flow_steps", "agenda_timeline", { layout: "steps", accentColor: PRIMARY, items: [
        { title: "醫師講解", text: "老化成因、防曬與保養的基本觀念。" },
        { title: "常見迷思", text: "整理門診常被問到的保養問題。" },
        { title: "線上提問", text: "開放提問，醫師就一般衛教層面回答。" },
      ] }, undefined, { color: INK, textAlign: "left" }),
    ], { background: BLUSH, color: BODY, maxWidth: 1000, gap: 48 }),
    // 6. 醫師與診所資訊
    section("doctor", [
      title("doctor_title", "Your speaker", "講者與診所資訊"),
      node("doctor_profile", "speaker_profiles", { layout: "featured", photoShape: "portrait", accentColor: PRIMARY, items: [
        { photo: `${ART}/doctor.svg`, alt: "方怡如醫師的照片（請替換）", name: "方怡如 醫師", role: `皮膚科專科醫師｜執業院所：${CLINIC}`, tags: "皮膚科專科,衛教講座,敏感肌照護", bio: "學歷：○○大學醫學系（請填入）\n經歷：○○醫院皮膚科住院醫師、主治醫師（請填入）\n專科醫師證書字號：皮專醫字第 ○○○○ 號（請填入）\n\n門診中常遇到民眾在不了解肌膚狀況下購買產品，因此投入衛教講座，希望大家先認識自己的肌膚，再做選擇。（範本示意）" },
      ] }, undefined, { color: INK, textAlign: "left" }),
    ], { background: BG, color: BODY, maxWidth: 1000, gap: 48 }),
    // 7. 常見迷思 Q&A
    section("myths", [
      title("myths_title", "Myths & facts", "常見迷思 Q&A"),
      node("myths_list", "faq", { items: [
        { question: "越貴的保養品越有效嗎？", answer: "價格和效果沒有必然關係。比起價格，更重要的是成分是否適合自己的膚況，以及能不能持續使用。" },
        { question: "陰天需要防曬嗎？", answer: "需要。雲層無法完全阻擋紫外線，戶外活動時仍建議依活動時間選擇合適的防曬係數並適時補擦。" },
        { question: "敏感肌可以用 A 酸嗎？", answer: "A 酸可能造成刺激與脫屑，敏感肌或有皮膚疾病者使用前應先經醫師評估，並依醫囑調整濃度與頻率。" },
        { question: "講座會推銷療程嗎？", answer: "講座內容以一般衛教為主，不在講座中介紹療程或價格。若有個人肌膚問題，請另行就醫由醫師評估。" },
      ] }, undefined, { color: BODY, textAlign: "left" }),
    ], { background: BG, color: BODY, maxWidth: 720, gap: 40, paddingY: 0, paddingYTablet: 0, paddingYMobile: 0 }),
    // 8. 衛教聲明與醫療廣告提醒（不得摺疊）
    section("notice", [
      node("notice_callout", "callout", { tone: "compliance", title: "衛教聲明", text: "本講座為一般衛教資訊，不構成診斷或治療建議；實際療程須經醫師面診評估，效果因人而異。\n\n商家使用本範本時，請依醫療法及主管機關現行醫療廣告規範檢視內容，並替換醫師證書字號、診所地址與醫療機構代碼。" }, undefined, { fontSize: 15 }, { mobile: { style: { fontSize: 14 } } }),
    ], { background: BG, color: BODY, maxWidth: 720, gap: 24, paddingY: 64, paddingYTablet: 56, paddingYMobile: 40 }),
    // 9. 第二次報名（回到首屏側欄）
    section("cta", [
      headline("cta_title", "先認識肌膚，再做選擇", "h2", { color: INK }),
      text("cta_date", "{{webinar.startAt}}・線上直播・免費參加", undefined, { color: BODY }),
      button("cta_button", "免費報名衛教講座", "#register", { ...primaryButton, fontSize: 18 }),
    ], { background: BLUSH, color: BODY, maxWidth: 720, gap: 20, align: "center", paddingY: 80, paddingYMobile: 56 }),
    // 10. 頁尾：診所資訊（佔位）
    section("footer", [
      text("footer_name", CLINIC, undefined, { color: INK, fontSize: 17 }),
      text("footer_info", "地址：（請填入診所地址）\n電話：（請填入聯絡電話）\n醫療機構代碼：（請填入 10 碼代碼）", "small", { color: MUTED }),
    ], { background: BG, color: MUTED, maxWidth: 1120, gap: 8, paddingY: 40, paddingYTablet: 36, paddingYMobile: 32 }),
  ];
}

export const template: WebinarTemplateDefinition = {
  id: "webinar-aesthetic-clinic",
  number: 20,
  name: "醫美衛教講座（合規）",
  description: "柔和可信的衛教講座報名頁：首屏講座資訊側欄＋表單，完整醫師與診所資訊、衛教圖解與迷思 Q&A，附醫療廣告合規聲明。",
  category: "醫療衛教",
  purposes: ["webinar"],
  styles: ["luxe"],
  preview: { eyebrow: "Webinar", headline: "保養品能做到什麼？認識肌膚老化與正確保養", summary: "資訊側欄首屏＋合規聲明", palette: [BG, PRIMARY, BLUSH], sectionCount: 10 },
  theme: { typography: { headingFont: "serif-tc", bodyFont: "sans-tc", bodySize: 17, bodyLineHeight: 1.8, textColor: BODY, headingColor: INK, linkColor: PRIMARY }, background: { color: BG } },
  settings: {
    eventTitle: "保養還是療程？認識肌膚老化與正確保養的線上衛教講座",
    scrollReveal: "fade",
    stickyCta: { enabled: true, label: "免費報名講座", showDate: true, devices: "mobile_tablet", buttonColor: PRIMARY, buttonTextColor: "#ffffff" },
  },
  build,
};
