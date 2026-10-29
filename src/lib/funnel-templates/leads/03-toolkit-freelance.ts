import { CONVERSION_TEMPLATE_SAMPLE_MARK, conversionTemplateKit, type ConversionTemplateDefinition } from "../conversion/types";

/**
 * 名單 03：範本工具包名單頁（specs/leads-03-toolkit-freelance.md）。
 * 深藍首屏與收尾帶夾住淺灰藍內容：首屏左承諾＋白色表單卡、右瀏覽器框裡的報價單畫面；
 * 往下是 4 個檔案縮圖、3 步驟用法與使用者回饋輪播，最後在深藍帶上 FAQ 旁邊再放一次表單。
 * 作者、客戶與回饋都是虛構示意，商家套用後換成自己的工具包。
 */
const ART = "/funnel-illustrations/leads/03";
const NAVY = "#0f1e36";
const NAVY_DEEP = "#0a1528";
const NAVY_BODY = "#c7d2e3";
const BG = "#f5f7fb";
const INK = "#0f1e36";
const BODY = "#3a4559";
const PRIMARY = "#1f4fd6";
const TEAL = "#5ad1c3";
const CARD = "#ffffff";
const LINE = "#dde3ee";

function build(prefix: string) {
  const { node, section, columns2, stack, headline, text, button, form } = conversionTemplateKit(prefix);
  const cta = { backgroundColor: PRIMARY, color: CARD, borderRadius: 8, fontSize: 18 } as const;
  const fields = [
    { name: "name", label: "姓名", placeholder: "你的名字", required: false },
    { name: "email", label: "Email", type: "email" as const, placeholder: "name@example.com", required: true, helpText: "下載連結會寄到這個信箱" },
  ];
  const note = "免費下載，不需信用卡。之後每兩週一封接案實務信，可隨時退訂。";
  const formCard = { backgroundColor: CARD, borderColor: LINE, borderWidth: 1, borderRadius: 14, padding: 28, color: INK, textAlign: "left", shadow: "strong" } as const;
  const title = (id: string, eyebrow: string, value: string, subtitle = "", dark = false) => node(id, "section_title", {
    eyebrow, title: value, subtitle, level: "h2", decoration: "none", eyebrowItalic: false, accentColor: dark ? TEAL : PRIMARY,
  }, undefined, { color: dark ? CARD : INK });

  return [
    // 1. 首屏：深藍底，左承諾＋表單卡，右瀏覽器框預覽（平板起堆疊，預覽放在表單下方）。
    section("hero", [
      columns2("hero_split", [
        text("hero_eyebrow", "免費範本包｜Google 試算表＋Word", "eyebrow", { color: TEAL, letterSpacing: 2 }),
        headline("hero_title", "報價、合約、請款，\n一次備齊的接案範本包", "h1", { color: CARD, fontSize: 48, lineHeight: 1.25 }, {
          tablet: { style: { fontSize: 42 } },
          mobile: { style: { fontSize: 29, lineHeight: 1.32 }, props: { text: "報價、合約、請款，一次備齊的接案範本包" } },
        }),
        text("hero_promise", "4 個改好就能寄的檔案：填上客戶名稱與工時，報價自動算好；合約條款逐條附說明，不用再從網路東拼西湊。", "lead", { color: NAVY_BODY }),
        form("hero_form", {
          fields,
          submitLabel: "免費下載範本包",
          submitStyle: cta,
          note,
          htmlId: "optin",
          style: formCard,
          mobile: { style: { padding: 18 } },
        }),
      ], [
        node("hero_preview", "media_frame", { frame: "browser", src: `${ART}/quote-preview.svg`, alt: "報價單試算表畫面示意：項目、工時、單價、小計與合計自動計算", url: "docs.example/報價單範本", aspect: "16:10" }),
        text("hero_preview_caption", "報價單畫面示意：改工時，金額自動更新。", "small", { color: NAVY_BODY, textAlign: "center" }),
      ], { ratio: "1:1", stackOn: "tablet", gap: 56, align: "center" }),
    ], { background: NAVY, color: NAVY_BODY, maxWidth: 1200, paddingY: 96, paddingYTablet: 64, paddingYMobile: 28, gap: 24 }),

    // 2. 工具包內容：4 個檔案。
    section("files", [
      title("files_title", "WHAT'S INSIDE", "下載後，你會拿到 4 個檔案", "每個檔案都附填寫說明，第一次用也能在 15 分鐘內寄出。"),
      node("files_cards", "content_cards", { columns: 4, accentColor: PRIMARY, cardColor: CARD, cardTextColor: INK, items: [
        { src: `${ART}/file-quote.svg`, alt: "報價單試算表縮圖", category: "試算表", title: "報價單", text: "填工時與單價，小計、稅額與合計自動算好。" },
        { src: `${ART}/file-contract.svg`, alt: "接案合約縮圖", category: "Word", title: "接案合約", text: "付款、修改次數與著作權，逐條附白話說明。" },
        { src: `${ART}/file-invoice.svg`, alt: "請款單與收款追蹤縮圖", category: "試算表", title: "請款與收款追蹤", text: "一張表看完誰已付款、誰該提醒。" },
        { src: `${ART}/file-pricing.svg`, alt: "時薪與報價計算器縮圖", category: "試算表", title: "時薪計算器", text: "從目標月收入反推，算出不吃虧的時薪。" },
      ] }, undefined, { color: BODY, textAlign: "left" }),
    ], { background: BG, color: BODY, maxWidth: 1200, gap: 44 }),

    // 3. 3 步驟使用。
    section("steps", [
      title("steps_title", "HOW IT WORKS", "三步驟，把報價寄出去"),
      node("steps_list", "icon_list", { layout: "grid", columns: 3, numbered: true, accentColor: PRIMARY, items: [
        { icon: "compass", title: "複製到自己的雲端", text: "點開連結就能複製一份 Google 試算表，或下載 Word 檔。" },
        { icon: "target", title: "換上你的資料", text: "Logo、匯款帳戶與付款條件填一次，之後每份報價都沿用。" },
        { icon: "rocket", title: "匯出 PDF 寄給客戶", text: "報價與合約一起寄出，看起來專業，也少了來回確認。" },
      ] }, undefined, { color: BODY, textAlign: "left" }),
    ], { background: CARD, color: BODY, maxWidth: 1080, gap: 44, align: "center" }),

    // 4. 使用者回饋（範本示意）。
    section("reviews", [
      title("reviews_title", "FROM FREELANCERS", "用過的接案者怎麼說"),
      node("reviews_wall", "testimonial_wall", { layout: "carousel", columns: 3, autoplay: false, showRating: false, cardColor: CARD, cardTextColor: BODY, accentColor: PRIMARY, items: [
        { name: "使用者 A｜平面設計", title: CONVERSION_TEMPLATE_SAMPLE_MARK, text: "以前報價都用聊天訊息講，現在寄一份正式報價單，客戶殺價的情況少很多。" },
        { name: "使用者 B｜影片剪輯", title: CONVERSION_TEMPLATE_SAMPLE_MARK, text: "合約裡的修改次數條款救了我，第三次大改時終於可以好好談加價。" },
        { name: "使用者 C｜文案寫手", title: CONVERSION_TEMPLATE_SAMPLE_MARK, text: "收款追蹤表讓我第一次知道自己有多少款項還沒收回來。" },
        { name: "使用者 D｜網站工程", title: CONVERSION_TEMPLATE_SAMPLE_MARK, text: "時薪計算器算完才發現自己一直在虧錢，隔月就調整了報價。" },
      ] }, undefined, { textAlign: "left" }),
    ], { background: BG, color: BODY, maxWidth: 1200, gap: 40, align: "center" }),

    // 5. FAQ＋第二次表單（深藍收尾）。
    section("again", [
      columns2("again_split", [
        title("again_faq_title", "FAQ", "下載前常見的問題", "", true),
        node("again_faq", "faq", { items: [
          { question: "真的免費嗎？之後會收費嗎？", answer: "範本包免費，不需要信用卡，也不會自動扣款。" },
          { question: "沒有 Google 帳號也能用嗎？", answer: "可以。每個檔案都另外提供 Excel 或 Word 格式。" },
          { question: "合約範本可以直接使用嗎？", answer: "範本是常見條款的起點，不是法律意見。金額較大或情況特殊的案子，建議請專業人士檢視。" },
          { question: "可以分享給朋友嗎？", answer: "歡迎分享這個頁面，讓朋友自己下載最新版本。" },
        ] }, undefined, { color: NAVY_BODY, textAlign: "left" }),
      ], [
        form("again_form", {
          title: "免費下載範本包",
          fields,
          submitLabel: "免費下載範本包",
          submitStyle: cta,
          note,
          style: { ...formCard, padding: 32 },
          mobile: { style: { padding: 18 } },
        }),
      ], { ratio: "7:5", stackOn: "tablet", gap: 56, align: "start" }),
    ], { background: NAVY, color: NAVY_BODY, maxWidth: 1200, gap: 24 }),

    // 6. 頁尾。
    section("footer", [
      stack("footer_stack", [
        text("footer_text", "© 以安接案工作室（虛構）｜我們不會把你的 Email 提供給第三方。", "small", { color: NAVY_BODY }),
        button("footer_top", "回到頂端下載", "#optin", { backgroundColor: "transparent", color: CARD, borderColor: NAVY_BODY, borderWidth: 1, borderRadius: 8, padding: "10px 20px", width: "fit-content", margin: "0 auto", fontSize: 15 }),
      ], 12),
    ], { background: NAVY_DEEP, color: NAVY_BODY, maxWidth: 960, paddingY: 40, paddingYTablet: 36, paddingYMobile: 28, gap: 12, align: "center" }),
  ];
}

export const template: ConversionTemplateDefinition = {
  id: "leads-toolkit-freelance",
  kind: "leads",
  number: 3,
  name: "範本工具包名單頁",
  description: "深藍首屏＋瀏覽器框預覽：4 個檔案縮圖、三步驟用法與回饋輪播，深藍收尾帶再放一次表單。",
  category: "範本／工具包",
  purposes: ["leads"],
  styles: ["professional"],
  preview: { eyebrow: "名單頁", headline: "報價、合約、請款，一次備齊的接案範本包", summary: "深藍首屏＋報價單畫面預覽", palette: [NAVY, PRIMARY, TEAL], sectionCount: 6 },
  theme: { typography: { headingFont: "sans-tc", bodyFont: "sans-tc", bodySize: 17, bodyLineHeight: 1.75, textColor: BODY, headingColor: INK, linkColor: PRIMARY }, background: { color: BG } },
  settings: { scrollReveal: "rise", stickyCta: { enabled: true, label: "免費下載範本包", target: "optin", showDate: false, devices: "mobile_tablet", buttonColor: PRIMARY, buttonTextColor: CARD, backgroundColor: NAVY } },
  build,
  thankYou: {
    name: "接案範本包・名單感謝頁",
    description: "交付範本包、提醒收信，並推薦接案定價工作坊。",
    tokens: { background: BG, surface: CARD, ink: INK, body: BODY, accent: PRIMARY, onAccent: CARD, line: LINE, footerBackground: NAVY, footerText: NAVY_BODY, radius: 8 },
    eyebrow: "範本包已寄出",
    title: "下載連結在你的信箱裡",
    intro: "一分鐘內會收到標題為「你的接案範本包」的信。沒看到的話，請檢查促銷內容或垃圾郵件匣。",
    card: { title: "自由接案報價單＋合約範本包", text: "報價單、接案合約、請款與收款追蹤、時薪計算器，共 4 個檔案（Google 試算表、Excel、Word）。", buttonLabel: "開啟範本包", buttonHref: "#ty-steps" },
    steps: [
      { icon: "message", title: "打開確認信", text: "把寄件者加入通訊錄，之後的接案實務信才不會被分到促銷匣。" },
      { icon: "compass", title: "先算你的時薪", text: "用時薪計算器填目標月收入，得到報價時的底線。" },
      { icon: "rocket", title: "寄出下一份報價", text: "換上你的 Logo 與付款條件，下一個案子就用新報價單。" },
    ],
    next: { eyebrow: "想把價格開得更有底氣？", title: "接案定價工作坊（付費）", text: "兩小時線上實作，帶你拆解自己的服務、設計三種方案，並練習怎麼回應「可以便宜一點嗎」。", buttonLabel: "了解工作坊", buttonHref: "#ty-steps" },
    footer: "© 以安接案工作室（虛構）｜如需取消訂閱，可點擊信件底部的退訂連結。",
  },
};
