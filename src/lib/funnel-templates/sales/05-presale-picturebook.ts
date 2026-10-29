import { CONVERSION_TEMPLATE_SAMPLE_MARK, conversionOfferCard, conversionTemplateKit, type ConversionTemplateDefinition } from "../conversion/types";

/**
 * 銷售 05：繪本預購頁（specs/sales-05-presale-picturebook.md）。
 * 奶油白底、陽光黃大色塊與森林綠按鈕，標題用霞鶩文楷；首屏是長出植物的圖鑑封面插畫。
 * 往下依序回答預購者最在意的事：內頁長什麼樣子、做到哪一步（不寫日期）、預購拿到什麼、
 * 誰畫的、多少錢、延遲或想退款怎麼辦。不顯示募資進度或人數；截止只用營運設定的截止時間。
 * 作者與主題為虛構；插畫都在 public/funnel-illustrations/sales/05/（原創）。
 */
const ART = "/funnel-illustrations/sales/05";
const BG = "#fffdf6";
const CARD = "#ffffff";
const INK = "#1f2a1c";
const BODY = "#3e4a3a";
const PRIMARY = "#2e7d4f";
const CORAL = "#c0412b";
const SUN = "#ffcf5c";
const LEAF = "#e8f3ea";
/** Deeper green for small accent text on the leaf tint (the primary is just under 4.5:1 there). */
const PRIMARY_DEEP = "#22603c";
const LINE = "#e7e1cf";

function build(prefix: string) {
  const { node, section, columns2, stack, headline, text, button } = conversionTemplateKit(prefix);
  const cta = { backgroundColor: PRIMARY, color: CARD, borderRadius: 300, fontSize: 18, padding: "16px 36px", width: "fit-content" } as const;
  const h2 = (id: string, value: string, color = INK) => headline(id, value, "h2", { color, fontSize: 40, lineHeight: 1.3 }, { tablet: { style: { fontSize: 34 } }, mobile: { style: { fontSize: 27, lineHeight: 1.35 } } });
  const eyebrow = (id: string, value: string, color = CORAL) => text(id, value, "eyebrow", { color, letterSpacing: 2 });

  return [
    // 1. 首屏：預購狀態徽章、H1、三個安心點與 CTA；右側是封面插畫。
    section("hero", [
      columns2("hero_split", [
        text("hero_status", "● 預購進行中｜首刷製作中", "small", { color: INK, backgroundColor: SUN, borderRadius: 300, padding: "6px 16px", width: "fit-content", fontSize: 15, letterSpacing: 1 }),
        headline("hero_title", "把島上的原生植物，\n畫進一本給孩子的圖鑑", "h1", { color: INK, fontSize: 54, lineHeight: 1.25 }, {
          tablet: { style: { fontSize: 44 } },
          mobile: { style: { fontSize: 31, lineHeight: 1.32 }, props: { text: "把島上的原生植物，畫進一本給孩子的圖鑑" } },
        }),
        text("hero_lead", "《島嶼原生植物小圖鑑》收錄 24 種走在海邊、山路與公園就遇得到的植物。每一頁都是手繪，附上孩子看得懂的觀察提示。", "lead", { color: BODY }),
        text("hero_points", "✓ 精裝 48 頁・適合 5 歲以上親子共讀\n✓ 預購者限定：作者簽名扉頁＋植物書籤組\n✓ 每個製作階段完成，都會寄信告訴你進度", undefined, { color: INK, lineHeight: 1.9 }),
        button("hero_cta", "預購這本圖鑑", "#offer", cta, { mobile: { style: { width: "100%" } } }),
      ], [
        node("hero_art", "image", { src: `${ART}/hero-book.svg`, alt: "繪本封面插畫：圖鑑周圍長出姑婆芋、百合與海檬果" }, undefined, { imageWidth: 100 }, { tablet: { style: { imageWidth: 72 } }, mobile: { style: { imageWidth: 88 } } }),
      ], { ratio: "7:5", stackOn: "tablet", gap: 48, align: "center" }),
    ], { background: BG, color: BODY, maxWidth: 1160, paddingY: 88, paddingYTablet: 56, paddingYMobile: 32, gap: 24 }),

    // 2. 內頁預覽（4 張跨頁）。
    section("pages", [
      stack("pages_heading", [eyebrow("pages_eyebrow", "翻開來看看", PRIMARY_DEEP), h2("pages_title", "一頁一種植物，畫給孩子看得懂")], 10, { textAlign: "center" }),
      text("pages_text", "左頁是植物的全身像，右頁是「去哪裡找」「摸起來怎樣」「小心！」三個觀察提示。以下為內頁示意。", undefined, { color: BODY, textAlign: "center", width: "min(100%, 640px)", margin: "0 auto" }),
      node("pages_gallery", "image_gallery", { layout: "grid", columns: 2, items: [
        { src: `${ART}/page-cerbera.svg`, alt: "內頁示意：海檬果的白色星形花與果實", caption: "海邊｜海檬果" },
        { src: `${ART}/page-lily.svg`, alt: "內頁示意：台灣百合的喇叭形花朵", caption: "山坡｜台灣百合" },
        { src: `${ART}/page-alocasia.svg`, alt: "內頁示意：姑婆芋的大葉片", caption: "林下｜姑婆芋" },
        { src: `${ART}/page-pandanus.svg`, alt: "內頁示意：林投的長葉與鳳梨狀果實", caption: "海岸｜林投" },
      ] }, undefined, { color: BODY, textAlign: "left" }),
    ], { background: LEAF, color: BODY, maxWidth: 1040, gap: 28 }),

    // 3. 製作流程（只寫階段，不寫日期；進度以信件通知）。
    section("process", [
      stack("process_heading", [eyebrow("process_eyebrow", "現在做到哪裡"), h2("process_title", "從草稿到你手上的四個階段")], 10, { textAlign: "center" }),
      node("process_steps", "agenda_timeline", { layout: "steps", accentColor: PRIMARY, items: [
        { time: "已完成", title: "文字與植物考證", text: "與植物老師一起確認名稱、分布與安全提醒。" },
        { time: "進行中", title: "手繪插畫", text: "24 種植物逐一畫成全身像與細節圖。" },
        { time: "接下來", title: "打樣、校色與印製", text: "印出樣書確認顏色與字級，再進廠印製裝訂。" },
        { time: "最後", title: "依序寄出", text: "依預購順序出貨，寄出時附上物流單號。" },
      ] }, undefined, { color: INK, textAlign: "left" }),
      text("process_note", "每完成一個階段，預購者都會收到一封進度信。階段狀態為範本示意，請改成實際進度。", "small", { color: BODY, textAlign: "center" }),
    ], { background: BG, color: BODY, maxWidth: 1120, gap: 36 }),

    // 4. 預購權益（陽光黃大色塊）。
    section("perks", [
      columns2("perks_split", [
        eyebrow("perks_eyebrow", "預購才有", INK),
        h2("perks_title", "預購者限定的四份心意"),
        text("perks_text", "書出版後也買得到，但這些只留給一起把它做出來的你。", undefined, { color: INK }),
      ], stack("perks_card", [
          node("perks_list", "icon_list", { layout: "grid", columns: 2, numbered: false, accentColor: PRIMARY, items: [
            { icon: "heart", title: "作者簽名扉頁", text: "可指定孩子的名字，印在扉頁的小葉子上。" },
            { icon: "book", title: "植物書籤組", text: "三張厚卡書籤：海檬果、百合、姑婆芋。" },
            { icon: "message", title: "製作進度信", text: "每個階段的手稿與幕後照片，先讓你看。" },
            { icon: "star", title: "致謝頁留名", text: "願意的話，你的名字會出現在書末的致謝頁。" },
          ] }, undefined, { color: INK, textAlign: "left" }),
      ], 0, { backgroundColor: CARD, borderColor: INK, borderWidth: 2, borderRadius: 24, padding: 36 }, { mobile: { style: { padding: 20 } } }), { ratio: "5:7", stackOn: "tablet", gap: 48, align: "center" }),
    ], { background: SUN, color: INK, maxWidth: 1120, paddingY: 96 }),

    // 5. 作者。
    section("author", [
      node("author_card", "speaker_profiles", { layout: "featured", photoShape: "circle", accentColor: PRIMARY, items: [
        { photo: `${ART}/author.svg`, alt: "作者葉小森的插畫頭像（虛構，可替換為照片）", name: "葉小森", role: "自然插畫家・繪本作者（虛構）", tags: "植物手繪,親子共讀,自然觀察", bio: "在海邊小鎮長大，週末帶孩子散步時，總被問「這是什麼樹？」。花了兩年走訪步道與海岸，把最常遇到的植物畫成這本書（範本示意經歷）。" },
      ] }, undefined, { color: INK, textAlign: "left" }),
    ], { background: BG, color: BODY, maxWidth: 920 }),

    // 6. 報價卡＋截止提示。
    section("buy", [
      columns2("buy_split", [
        eyebrow("buy_eyebrow", "現在預購", PRIMARY_DEEP),
        h2("buy_title", "預購一本，\n陪孩子認識腳邊的植物"),
        node("buy_list", "icon_list", { layout: "list", numbered: false, accentColor: PRIMARY, items: [
          { icon: "book", title: "《島嶼原生植物小圖鑑》精裝一本", text: "" },
          { icon: "heart", title: "簽名扉頁＋植物書籤組（預購限定）", text: "" },
          { icon: "message", title: "製作進度信，直到書寄到你家", text: "" },
        ] }, undefined, { color: INK }),
      ], [
        conversionOfferCard(prefix, "offer", {
          title: "《島嶼原生植物小圖鑑》預購",
          lines: ["精裝 48 頁・含預購限定贈品", "完成印製後依預購順序寄出"],
          note: "售價與付款方式以結帳頁為準。預購款項用於首刷印製，出貨前可依預購須知申請退款。",
          style: { backgroundColor: CARD, color: INK, borderColor: INK, borderWidth: 2, borderRadius: 24, padding: 36, shadow: "medium" },
          mobile: { style: { padding: 22 } },
          titleColor: INK,
          noteColor: BODY,
          htmlId: "offer",
        }),
        node("buy_deadline", "deadline_notice", { label: "預購截止", closedText: "本次預購已截止，留意作者的出版消息。", accentColor: CORAL }, undefined, { color: INK }),
      ], { ratio: "1:1", stackOn: "tablet", gap: 56, align: "center" }),
    ], { background: LEAF, color: BODY, maxWidth: 1120, paddingY: 96, paddingYMobile: 48 }),

    // 7. 預購須知（交付、延遲、退款）。
    section("terms", [
      node("terms_callout", "callout", { tone: "warning", title: "預購須知（請依實際政策修改）", text: "這是預購商品：付款後才開始印製，完成後依預購順序寄出，寄出時會以 Email 通知物流單號。\n\n若印製或物流延遲，我們會在原定階段結束前寄信說明新的預計時間；延遲期間仍可申請退款。\n\n出貨前可申請全額退款；出貨後依商品退換貨規定辦理。以上為範本示意，請改成你的實際交付與退款政策。" }, undefined, { color: INK, textAlign: "left" }),
    ], { background: BG, color: BODY, maxWidth: 760, paddingY: 72, paddingYMobile: 40 }),

    // 8. FAQ。
    section("faq", [
      h2("faq_title", "預購前常被問的問題"),
      node("faq_list", "faq", { items: [
        { question: "什麼時候會收到書？", answer: "書印好後依預購順序寄出。每個製作階段完成都會寄信更新進度，出貨時附上物流單號。" },
        { question: "適合幾歲的孩子？", answer: "建議 5 歲以上親子共讀；國小孩子可以自己帶著書去散步、對照植物。" },
        { question: "簽名扉頁要怎麼指定名字？", answer: "付款完成後的確認信裡有表單連結，在印製前填寫孩子的名字即可。" },
        { question: "可以寄到海外嗎？", answer: "預購期間先開放國內寄送；海外寄送請先來信詢問。範本示意，請依實際物流修改。" },
        { question: "可以開發票或統編嗎？", answer: "可以，結帳時選擇個人、公司或捐贈發票，發票會寄到你的 Email。" },
      ] }, undefined, { color: BODY, textAlign: "left" }),
    ], { background: BG, color: BODY, maxWidth: 760, gap: 32, paddingY: 72, align: "center" }),

    // 9. 頁尾 CTA。
    section("footer", [
      headline("footer_title", "一起把這本書做出來", "h2", { color: INK, fontSize: 32 }, { mobile: { style: { fontSize: 25 } } }),
      button("footer_cta", "預購這本圖鑑", "#offer", { ...cta, margin: "0 auto" }),
      text("footer_text", `© 葉小森的植物散步（虛構品牌）｜${CONVERSION_TEMPLATE_SAMPLE_MARK}頁面，請替換為你的出版資訊。`, "small", { color: BODY }),
    ], { background: SUN, color: INK, maxWidth: 760, paddingY: 72, paddingYMobile: 48, gap: 20, align: "center" }),
  ];
}

export const template: ConversionTemplateDefinition = {
  id: "sales-presale-picturebook",
  kind: "sales",
  number: 5,
  name: "繪本預購頁",
  description: "陽光黃與森林綠的手繪預購頁：內頁預覽、製作階段、預購限定權益與清楚的交付與退款須知，不顯示假進度。",
  category: "預購／募資",
  purposes: ["sales"],
  styles: ["vivid"],
  preview: { eyebrow: "銷售頁", headline: "把島上的原生植物畫進圖鑑", summary: "手繪封面＋製作階段＋預購須知", palette: [SUN, PRIMARY, BG], sectionCount: 9 },
  theme: { typography: { headingFont: "wenkai-tc", bodyFont: "sans-tc", bodySize: 17, bodyLineHeight: 1.8, textColor: BODY, headingColor: INK, linkColor: PRIMARY }, background: { color: BG } },
  settings: { scrollReveal: "rise", stickyCta: { enabled: true, label: "預購這本圖鑑", target: "offer", showDate: false, devices: "mobile_tablet", buttonColor: PRIMARY, buttonTextColor: CARD, backgroundColor: BG } },
  build,
  thankYou: {
    name: "繪本預購・訂單感謝頁",
    description: "說明付款確認信、製作進度通知與出貨方式。",
    tokens: { background: BG, surface: CARD, ink: INK, body: BODY, accent: PRIMARY, onAccent: CARD, line: LINE, footerBackground: INK, footerText: "#e8f3ea", radius: 14 },
    eyebrow: "已收到你的預購",
    title: "謝謝你，\n一起把這本書做出來",
    intro: "付款完成後，確認信會寄到你填寫的 Email。之後每完成一個製作階段，我們都會寄信告訴你進度。",
    card: { title: "《島嶼原生植物小圖鑑》預購", text: "精裝一本＋簽名扉頁與植物書籤組。製作進度會寄到你的信箱，書印好後依預購順序寄出。", buttonLabel: "看接下來的流程", buttonHref: "#ty-steps" },
    steps: [
      { icon: "message", title: "收到確認信", text: "付款完成後寄出。信裡有填寫簽名名字的表單連結。" },
      { icon: "book", title: "製作進度通知", text: "插畫、打樣、印製，每個階段完成都會寄信附上幕後照片。" },
      { icon: "rocket", title: "出貨", text: "依預購順序寄出，寄出當天以 Email 通知物流單號。" },
    ],
    faq: [
      { question: "發票什麼時候開？", answer: "付款完成後開立電子發票，寄到你結帳時填寫的 Email。" },
      { question: "想取消預購怎麼辦？", answer: "出貨前可以回覆確認信申請退款，我們會依預購須知處理。範本示意，請依實際政策修改。" },
      { question: "要修改寄送地址或聯絡作者？", answer: "直接回覆確認信即可，出貨前都可以修改地址。" },
    ],
    footer: "© 葉小森的植物散步（虛構品牌）｜有任何問題，回覆確認信就會找到我們。",
  },
};
