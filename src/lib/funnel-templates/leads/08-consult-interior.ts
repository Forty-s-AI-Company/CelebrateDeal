import { CONVERSION_TEMPLATE_SAMPLE_MARK, conversionTemplateKit, type ConversionTemplateDefinition } from "../conversion/types";

/**
 * 名單 08：免費諮詢預約頁（specs/leads-08-consult-interior.md）。
 * 在地服務業的「預約丈量／估價」頁：首屏左邊是承諾、三個重點與信任列，右邊是白色預約表單卡
 * （姓名、手機、Email）。往下用數據、五步流程、作品、回饋與合作須知降低疑慮，最後 FAQ 旁再放一次表單。
 * 手機版保留原順序但收起重點清單，讓標題後面緊接著表單（首屏看得到第一個欄位）。
 * 森居設計與所有數據、回饋都是虛構示意。
 */
const ART = "/funnel-illustrations/leads/08";
const BG = "#f7f6f3";
const CARD = "#ffffff";
const INK = "#1d2422";
const BODY = "#424a47";
const MUTED = "#59625e";
const PRIMARY = "#2c4a3f";
const OAK = "#8a5a24";
const LINE = "#e2ded6";
const SAND = "#efe9df";

function build(prefix: string) {
  const { node, section, columns2, stack, headline, text, button, form } = conversionTemplateKit(prefix);
  const cta = { backgroundColor: PRIMARY, color: CARD, borderRadius: 8, fontSize: 18 } as const;
  const fields = [
    { name: "name", label: "姓名", placeholder: "王小姐／王先生", required: true },
    { name: "phone", label: "手機", type: "tel" as const, placeholder: "0912-345-678", required: true, helpText: "設計師會用這支電話與你約時間" },
    { name: "email", label: "Email", type: "email" as const, placeholder: "name@example.com", required: true },
  ];
  const note = "送出後 2 個工作天內由設計師聯繫。丈量與初步估價免費，不需要先簽約。";
  const formCard = { backgroundColor: CARD, borderColor: LINE, borderWidth: 1, borderRadius: 16, padding: 32, color: INK, textAlign: "left", shadow: "medium" } as const;
  const eyebrow = (id: string, value: string) => text(id, value, "eyebrow", { color: OAK, letterSpacing: 2 });
  const h2 = (id: string, value: string, mobileText?: string) => headline(id, value, "h2", { color: INK, fontSize: 38, lineHeight: 1.35 }, {
    tablet: { style: { fontSize: 32 } },
    mobile: { style: { fontSize: 26 }, ...(mobileText ? { props: { text: mobileText } } : {}) },
  });

  return [
    // 1. 首屏：左承諾＋重點＋信任列，右預約表單卡。
    section("hero", [
      columns2("hero_split", [
        eyebrow("hero_eyebrow", "老屋翻新｜免費到府丈量"),
        headline("hero_title", "先丈量、再估價，\n翻新預算不再一直追加", "h1", { color: INK, fontSize: 52, lineHeight: 1.25 }, {
          tablet: { style: { fontSize: 42 } },
          mobile: { style: { fontSize: 28, lineHeight: 1.35 } },
        }),
        text("hero_lead", "屋齡 20 年以上的房子，水電、防水與結構最容易藏著追加費用。我們先到現場看清楚，再給你一份分項列清楚的初步估價。", "lead", { color: BODY }, { mobile: { visible: false } }),
        node("hero_points", "icon_list", { layout: "list", numbered: false, accentColor: PRIMARY, items: [
          { icon: "target", title: "到府丈量與屋況檢查", text: "量尺寸，也檢查壁癌、漏水與老舊管線。" },
          { icon: "chart", title: "分項列出的初步估價", text: "拆除、水電、木作、油漆一項一項列，不是一個總價。" },
          { icon: "shield", title: "不簽約也沒關係", text: "估價單可以帶走比價，我們不會一直打電話推銷。" },
        ] }, undefined, { color: BODY, textAlign: "left" }, { mobile: { visible: false } }),
        text("hero_trust", "✓ 丈量免費　✓ 估價分項透明　✓ 完工保固（依合約）", "small", { color: PRIMARY, letterSpacing: 1 }, { mobile: { visible: false } }),
      ], form("hero_form", {
        title: "預約免費丈量",
        fields,
        submitLabel: "預約免費丈量",
        submitStyle: cta,
        note,
        htmlId: "optin",
        style: formCard,
        mobile: { style: { padding: 18 } },
      }), { ratio: "7:5", stackOn: "tablet", gap: 40, align: "center" }),
    ], { background: BG, color: BODY, maxWidth: 1180, paddingY: 88, paddingYTablet: 56, paddingYMobile: 24, gap: 24 }),

    // 2. 數據（範本示意）。
    section("numbers", [
      node("numbers_stats", "stats", { animate: true, framed: false, accentColor: PRIMARY, items: [
        { value: "12", suffix: " 年", label: `老屋翻新經驗（${CONVERSION_TEMPLATE_SAMPLE_MARK}）` },
        { value: "360", suffix: "+", label: `完工案件（${CONVERSION_TEMPLATE_SAMPLE_MARK}）` },
        { value: "2", suffix: " 天", label: `工作天內回電（${CONVERSION_TEMPLATE_SAMPLE_MARK}）` },
        { value: "5", suffix: " 步", label: "從丈量到完工的固定流程" },
      ] }, undefined, { color: INK }),
    ], { background: CARD, color: BODY, maxWidth: 1080, paddingY: 56, paddingYTablet: 48, paddingYMobile: 36 }),

    // 3. 服務流程 5 步：左標題、右直式時間軸（五步在桌機不會被拆成 4＋1）。
    section("process", [
      columns2("process_split", [
        eyebrow("process_eyebrow", "服務流程"),
        h2("process_title", "五個步驟，\n每一步都先講清楚", "五個步驟，每一步都先講清楚"),
        text("process_text", "簽約前，你會先拿到丈量結果、分項估價與平面配置建議。看完再決定，不用急著付訂金。", undefined, { color: BODY }),
        button("process_cta", "預約免費丈量", "#optin", { ...cta, fontSize: 17, padding: "14px 28px", width: "fit-content" }, { mobile: { style: { width: 100 } } }),
      ], [
        node("process_steps", "agenda_timeline", { layout: "vertical", accentColor: PRIMARY, items: [
          { time: "步驟 1", title: "線上預約", text: "留下聯絡方式，設計師 2 個工作天內來電，先了解屋況與需求。" },
          { time: "步驟 2", title: "到府丈量", text: "約 60–90 分鐘，丈量尺寸並檢查漏水、壁癌與老舊管線。" },
          { time: "步驟 3", title: "初步估價", text: "約一週內提供分項估價與平面配置建議，可以帶走比價。" },
          { time: "步驟 4", title: "設計與簽約", text: "確認圖面、建材與工期後再簽約，不先收訂金。" },
          { time: "步驟 5", title: "施工與驗收", text: "每週回報進度照片，完工後一起逐項驗收。" },
        ] }, undefined, { color: INK, textAlign: "left" }),
      ], { ratio: "5:7", stackOn: "tablet", gap: 64, align: "start" }),
    ], { background: BG, color: BODY, maxWidth: 1160, gap: 24 }),

    // 4. 作品。
    section("works", [
      columns2("works_head", [
        eyebrow("works_eyebrow", "翻新作品"),
        h2("works_title", "老屋，也可以住得很新"),
      ], [
        text("works_text", "以下為空間示意線稿，請替換成你的完工照片；建議附上屋齡、坪數與施工項目，讓客人更好想像。", undefined, { color: BODY }),
      ], { ratio: "1:1", gap: 48, align: "end" }),
      node("works_gallery", "image_gallery", { layout: "masonry", columns: 3, items: [
        { src: `${ART}/room-living.svg`, alt: "客廳翻新示意線稿：大窗、木地板與沙發", caption: "客廳｜屋齡 35 年公寓，拆除隔間引入採光" },
        { src: `${ART}/room-kitchen.svg`, alt: "廚房翻新示意線稿：木作吊櫃與中島", caption: "廚房｜改成開放式，增加中島工作檯" },
        { src: `${ART}/room-bath.svg`, alt: "浴室翻新示意線稿：磁磚牆、洗手台與淋浴間", caption: "浴室｜重做防水，乾濕分離" },
        { src: `${ART}/room-dining.svg`, alt: "餐廳示意線稿：原木餐桌、吊燈與展示櫃", caption: "餐廳｜原木餐桌搭配展示櫃" },
        { src: `${ART}/room-study.svg`, alt: "書房示意線稿：整面書牆與窗邊書桌", caption: "書房｜整面書牆收納" },
        { src: `${ART}/room-bedroom.svg`, alt: "臥室示意線稿：木作床頭板與收納牆", caption: "臥室｜床頭板結合收納牆" },
      ] }, undefined, { color: MUTED, textAlign: "left" }),
    ], { background: CARD, color: BODY, maxWidth: 1180, gap: 32 }),

    // 5. 客戶回饋（範本示意）。
    section("reviews", [
      eyebrow("reviews_eyebrow", "屋主回饋"),
      h2("reviews_title", "他們最在意的，也是預算"),
      node("reviews_wall", "testimonial_wall", { layout: "carousel", columns: 3, autoplay: false, showRating: false, accentColor: PRIMARY, cardColor: CARD, cardTextColor: INK, items: [
        { name: "屋主 A｜30 年老公寓", title: `估價和決算差不多（${CONVERSION_TEMPLATE_SAMPLE_MARK}）`, text: "之前找過一家，開工後一直說要追加。這次丈量時就把漏水和管線都看過，最後只多了一點點。" },
        { name: "屋主 B｜透天厝二樓", title: `分項估價很好比較（${CONVERSION_TEMPLATE_SAMPLE_MARK}）`, text: "每一項都列出來，我拿去跟別家比，很清楚知道差在哪裡，也知道哪些可以先不做。" },
        { name: "屋主 C｜小家庭", title: `每週都有進度照片（${CONVERSION_TEMPLATE_SAMPLE_MARK}）`, text: "我們上班沒辦法常去工地，每週收到照片和說明，心裡比較踏實。" },
        { name: "屋主 D｜長輩同住", title: `浴室終於不怕滑（${CONVERSION_TEMPLATE_SAMPLE_MARK}）`, text: "設計師主動建議加扶手和止滑地磚，爸媽住得安心很多。" },
      ] }, undefined, { textAlign: "left" }),
    ], { background: SAND, color: BODY, maxWidth: 1160, gap: 24, align: "center" }),

    // 6. 合作須知。
    section("notice", [
      node("notice_callout", "callout", { tone: "info", title: "預約前請留意", text: "免費丈量服務範圍與可預約時段，依各地區與檔期而定，設計師來電時會先確認。\n\n初步估價為現場評估的參考金額，實際費用以雙方確認的設計圖與合約為準。本段請依你的服務條款修改。" }, undefined, { color: INK, textAlign: "left" }),
    ], { background: BG, color: BODY, maxWidth: 820, paddingY: 64, paddingYTablet: 56, paddingYMobile: 40 }),

    // 7. FAQ＋第二次表單。
    section("faq", [
      columns2("faq_split", [
        eyebrow("faq_eyebrow", "常見問題"),
        h2("faq_title", "預約前，你可能想問"),
        node("faq_list", "faq", { items: [
          { question: "丈量真的不用錢嗎？", answer: "不用。丈量與初步估價都免費，收到估價後要不要繼續，由你決定。" },
          { question: "只想翻新廚房或浴室可以嗎？", answer: "可以。局部翻新也能預約，丈量時會一起看相鄰的管線與防水狀況。" },
          { question: "要準備什麼資料？", answer: "有平面圖最好；沒有也沒關係，拍幾張各空間的照片，設計師來電時會先了解。" },
          { question: "施工期間可以住在家裡嗎？", answer: "依施工範圍而定。全室翻新通常建議暫時搬出；局部翻新可以安排分區施工。" },
        ] }, undefined, { color: BODY, textAlign: "left" }),
      ], form("faq_form", {
        title: "預約免費丈量",
        fields,
        submitLabel: "預約免費丈量",
        submitStyle: cta,
        note,
        style: formCard,
        mobile: { style: { padding: 18 } },
      }), { ratio: "7:5", stackOn: "tablet", gap: 64, align: "start" }),
    ], { background: CARD, color: BODY, maxWidth: 1180, gap: 24 }),

    // 8. 頁尾。
    section("footer", [
      stack("footer_brand", [
        text("footer_mark", "森居設計", undefined, { color: "#ffffff", fontSize: 20, letterSpacing: 4 }),
        text("footer_text", "© 森居設計（虛構示意）｜服務時間：週一至週六 10:00–19:00｜我們不會把你的聯絡資料提供給第三方。", "small", { color: "#d3dcd8" }),
      ], 8),
      button("footer_top", "預約免費丈量", "#optin", { backgroundColor: "transparent", color: "#ffffff", borderColor: "#6f8a80", borderWidth: 1, borderRadius: 8, padding: "10px 20px", width: "fit-content", margin: "0 auto", fontSize: 15 }),
    ], { background: PRIMARY, color: "#d3dcd8", maxWidth: 960, paddingY: 48, paddingYTablet: 40, paddingYMobile: 32, gap: 16, align: "center" }),
  ];
}

export const template: ConversionTemplateDefinition = {
  id: "leads-consult-interior",
  kind: "leads",
  number: 8,
  name: "免費諮詢預約頁",
  description: "在地服務業的預約丈量／估價頁：首屏表單卡、數據、五步流程、作品與合作須知，適合設計、裝修與顧問。",
  category: "免費諮詢／估價申請",
  purposes: ["leads"],
  styles: ["professional"],
  preview: { eyebrow: "名單頁", headline: "先丈量、再估價，翻新預算不再一直追加", summary: "首屏預約表單卡＋五步流程", palette: [BG, PRIMARY, OAK], sectionCount: 8 },
  theme: { typography: { headingFont: "sans-tc", bodyFont: "sans-tc", bodySize: 17, bodyLineHeight: 1.75, textColor: BODY, headingColor: INK, linkColor: PRIMARY }, background: { color: BG } },
  settings: { scrollReveal: "rise", stickyCta: { enabled: true, label: "預約免費丈量", target: "optin", showDate: false, devices: "mobile_tablet", buttonColor: PRIMARY, buttonTextColor: CARD, backgroundColor: CARD } },
  build,
  thankYou: {
    name: "免費諮詢・名單感謝頁",
    description: "確認收到預約，說明聯繫時間與丈量前的準備。",
    tokens: { background: BG, surface: CARD, ink: INK, body: BODY, accent: PRIMARY, onAccent: CARD, line: LINE, footerBackground: PRIMARY, footerText: "#d3dcd8", radius: 8 },
    eyebrow: "預約已送出",
    title: "我們收到你的預約了",
    intro: "設計師會在 2 個工作天內打電話給你，約丈量時間。確認信也已寄到你的信箱；沒看到的話，請看看垃圾郵件匣。",
    card: { title: "老屋翻新｜免費丈量與初步估價", text: "丈量約 60–90 分鐘，會檢查漏水、壁癌與老舊管線，約一週內提供分項估價。過程中不需要先簽約。", buttonLabel: "丈量前要準備什麼", buttonHref: "#ty-steps" },
    steps: [
      { icon: "message", title: "2 個工作天內聯繫", text: "設計師會來電了解屋況與需求；不方便接電話的話，也會寄 Email 給你。" },
      { icon: "book", title: "準備平面圖或照片", text: "有平面圖最好；沒有的話，拍下每個空間與漏水、壁癌的位置就很有幫助。" },
      { icon: "clock", title: "約丈量時間", text: "選一個方便的時段，最好家中決定裝修的人都能在場一起討論。" },
    ],
    footer: "© 森居設計（虛構示意）｜如需更改預約，直接回覆確認信即可。",
  },
};
