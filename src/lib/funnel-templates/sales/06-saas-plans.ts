import { CONVERSION_TEMPLATE_SAMPLE_MARK, conversionOfferCard, conversionTemplateKit, type ConversionTemplateDefinition } from "../conversion/types";

/**
 * 銷售 06：訂閱方案銷售頁（specs/sales-06-saas-plans.md）。
 * 淺藍灰底、深海軍藍標題與靛藍按鈕；首屏右側是手機框裡的排班 App 畫面，背景帶淡格線。
 * 決策順序：一句話成果 → 誰在用（示意 Logo）→ 3 大功能 → 年訂閱包含什麼＋報價卡 → 評價 → 退款說明與 FAQ。
 * 方案內的金額只做展示並標示範本示意，實際售價與結帳只來自報價卡綁定的商品。
 * 產品與店家都是虛構；插畫在 public/funnel-illustrations/sales/06/（原創）。
 */
const ART = "/funnel-illustrations/sales/06";
const BG = "#f6f8fc";
const CARD = "#ffffff";
const INK = "#0d1b2a";
const BODY = "#3c4a5c";
const PRIMARY = "#3b5bdb";
const MINT = "#0f7a5f";
const LINE = "#dde3ee";
const ON_DARK = "#c9d4ea";

function build(prefix: string) {
  const { node, section, columns2, stack, headline, text, button } = conversionTemplateKit(prefix);
  const cta = { backgroundColor: PRIMARY, color: CARD, borderRadius: 12, fontSize: 18, padding: "16px 32px", width: "fit-content" } as const;
  const h2 = (id: string, value: string, color = INK, mobileText?: string) => headline(id, value, "h2", { color, fontSize: 38, lineHeight: 1.28 }, { tablet: { style: { fontSize: 32 } }, mobile: { style: { fontSize: 26, lineHeight: 1.35 }, ...(mobileText ? { props: { text: mobileText } } : {}) } });
  const heading = (id: string, eyebrow: string, title: string, mobileText?: string) => stack(`${id}_heading`, [
    text(`${id}_eyebrow`, eyebrow, "eyebrow", { color: PRIMARY, letterSpacing: 2 }),
    h2(`${id}_title`, title, INK, mobileText),
  ], 10, { textAlign: "center" });

  return [
    // 1. 首屏：左文案＋CTA，右手機框 App 畫面（桌機帶淡格線背景）。
    section("hero", [
      columns2("hero_split", [
        text("hero_brand", "▦ 班表通", "small", { color: INK, fontSize: 18, letterSpacing: 1 }),
        text("hero_eyebrow", "小店排班 App｜年訂閱方案", "eyebrow", { color: PRIMARY, letterSpacing: 2 }),
        headline("hero_title", "排班 10 分鐘搞定，\n換班不用再一直傳訊息", "h1", { color: INK, fontSize: 54, lineHeight: 1.2 }, {
          tablet: { style: { fontSize: 44 } },
          mobile: { style: { fontSize: 28, lineHeight: 1.32 } },
        }),
        text("hero_lead", "拖拉就能排好一週班表，員工在手機上申請換班、你一鍵核准；工時自動加總，月底不用再對打卡紀錄。", "lead", { color: BODY }),
        button("hero_cta", "查看年訂閱方案", "#offer", cta, { mobile: { style: { width: "100%" } } }),
        text("hero_note", "✓ 員工免費加入　✓ iOS、Android、網頁都能用　✓ 舊班表可匯入", "small", { color: MINT }, { mobile: { props: { text: "✓ 員工免費加入\n✓ iOS、Android、網頁都能用\n✓ 舊班表可匯入" } } }),
      ], [
        node("hero_phone", "media_frame", { frame: "phone", src: `${ART}/app-screen.svg`, alt: "班表通 App 畫面示意：本週班表、換班已核准通知與一鍵產生班表按鈕" }),
      ], { ratio: "7:5", stackOn: "tablet", gap: 56, align: "center" }),
    ], { background: BG, color: BODY, maxWidth: 1160, paddingY: 96, paddingYTablet: 56, paddingYMobile: 32, props: { backgroundImage: `${ART}/hero-bg.svg`, backgroundPosition: "center" } }),

    // 2. Logo 牆（虛構店家，範本示意）。
    section("logos", [
      node("logos_strip", "logo_strip", { title: `餐飲、零售與工作室都在用（${CONVERSION_TEMPLATE_SAMPLE_MARK} Logo）`, tone: "grayscale", logoHeight: 30, items: [
        { src: `${ART}/logo-tea.svg`, alt: "巷口茶事（虛構示意 Logo）" },
        { src: `${ART}/logo-bakery.svg`, alt: "BAKE&CO（虛構示意 Logo）" },
        { src: `${ART}/logo-noodle.svg`, alt: "麵町食堂（虛構示意 Logo）" },
        { src: `${ART}/logo-flower.svg`, alt: "Bloom 花室（虛構示意 Logo）" },
        { src: `${ART}/logo-gym.svg`, alt: "MOVE STUDIO（虛構示意 Logo）" },
      ] }, undefined, { color: BODY }),
    ], { background: CARD, color: BODY, paddingY: 44, paddingYTablet: 40, paddingYMobile: 32, align: "center" }),

    // 3. 三大功能。
    section("features", [
      heading("features", "FEATURES", "把排班最花時間的三件事交給 App"),
      node("features_cards", "content_cards", { columns: 3, accentColor: PRIMARY, cardColor: CARD, cardTextColor: INK, items: [
        { src: `${ART}/feat-drag.svg`, alt: "功能示意：拖拉班表格子，自動檢查人力", category: "排班", title: "拖拉排班，人力不足先提醒", text: "設定每個時段需要幾個人，排不夠或排太多，格子會直接變色。", href: "#offer", linkLabel: "看方案內容" },
        { src: `${ART}/feat-swap.svg`, alt: "功能示意：員工在 App 送出換班，店長一鍵核准", category: "換班", title: "員工自己找代班，你只要按核准", text: "換班申請集中在一個地方，不會再漏看群組訊息。", href: "#offer", linkLabel: "看方案內容" },
        { src: `${ART}/feat-hours.svg`, alt: "功能示意：自動加總工時，超時提早提醒", category: "工時", title: "工時自動加總，超時先通知", text: "打卡與班表自動對照，月底匯出薪資用的工時表。", href: "#offer", linkLabel: "看方案內容" },
      ] }, undefined, { color: BODY, textAlign: "left" }),
    ], { background: BG, color: BODY, maxWidth: 1160, gap: 48 }),

    // 4. 方案內容＋報價卡。
    section("plan", [
      heading("plan", "PRICING", "一個年訂閱，全店員工都能用", "一個年訂閱，全店都能用"),
      columns2("plan_split", [
        node("plan_stack", "value_stack", {
          title: "年訂閱包含",
          items: [
            { title: "排班與換班", text: "不限班表數量，員工手機即時收到通知。", value: "NT$2,400／年" },
            { title: "打卡與工時報表", text: "GPS 打卡、工時加總、匯出 Excel。", value: "NT$1,800／年" },
            { title: "多店與權限管理", text: "最多 3 間分店，店長與值班主管分權限。", value: "NT$1,200／年" },
            { title: "導入協助", text: "線上 30 分鐘帶你匯入員工與舊班表。", value: "NT$800" },
          ],
          totalLabel: "單項加總參考", totalValue: "NT$6,200",
          offerLabel: "年訂閱一次包含",
          note: `${CONVERSION_TEMPLATE_SAMPLE_MARK}：價值為參考展示，實際售價以右側結帳資訊為準。`,
          accentColor: PRIMARY, cardColor: CARD, cardTextColor: INK,
        }, undefined, { textAlign: "left" }),
      ], [
        conversionOfferCard(prefix, "offer", {
          title: "班表通・年訂閱",
          lines: ["✓ 全部功能，員工人數不限", "✓ 訂閱期間免費更新與客服"],
          note: "售價與付款方式以結帳頁為準。付款完成後，開通方式會寄到你的 Email。",
          style: { backgroundColor: CARD, color: INK, borderColor: PRIMARY, borderWidth: 2, borderRadius: 20, padding: 36, shadow: "strong" },
          mobile: { style: { padding: 22 } },
          titleColor: INK,
          noteColor: BODY,
          htmlId: "offer",
        }),
      ], { ratio: "7:5", stackOn: "tablet", gap: 40, align: "center" }),
    ], { background: CARD, color: BODY, maxWidth: 1120, gap: 48, paddingY: 96 }),

    // 5. 評價（範本示意）。
    section("reviews", [
      heading("reviews", "REVIEWS", "店長們這樣說"),
      node("reviews_wall", "testimonial_wall", { layout: "grid", columns: 3, autoplay: false, showRating: false, cardColor: CARD, cardTextColor: BODY, accentColor: PRIMARY, items: [
        { name: "飲料店店長 A", title: CONVERSION_TEMPLATE_SAMPLE_MARK, text: "以前週日晚上要花兩小時排班，現在喝杯茶的時間就排好了。" },
        { name: "麵店老闆 B", title: CONVERSION_TEMPLATE_SAMPLE_MARK, text: "換班不用再在群組裡喊，誰代誰一目了然，也不會有人說沒看到。" },
        { name: "花店負責人 C", title: CONVERSION_TEMPLATE_SAMPLE_MARK, text: "兩間分店的工時終於可以一起看，月底算薪水快很多。" },
      ] }, undefined, { textAlign: "left" }),
    ], { background: BG, color: BODY, maxWidth: 1120, gap: 40, align: "center" }),

    // 6. 退款說明＋FAQ。
    section("faq", [
      heading("faq", "FAQ", "訂閱前常見的問題"),
      node("faq_refund", "callout", { tone: "info", title: "試用與退款說明（請依實際政策修改）", text: "付款後 14 天內，若尚未邀請員工使用，可來信申請全額退款。\n\n年訂閱到期前 7 天會寄信提醒，不會在沒有通知的情況下自動續約。以上為範本示意，請改成你的實際訂閱與退款政策。" }, undefined, { color: INK, textAlign: "left" }),
      node("faq_list", "faq", { items: [
        { question: "員工需要付費嗎？", answer: "不用。年訂閱以店家計算，員工下載 App 用邀請連結加入即可。" },
        { question: "可以從 Excel 匯入舊班表嗎？", answer: "可以，開通後依範例格式上傳；導入協助也可以幫你一起匯入。" },
        { question: "沒有網路時可以打卡嗎？", answer: "可以先離線打卡，手機恢復連線後會自動上傳並標示時間。" },
        { question: "可以開統編發票嗎？", answer: "可以，結帳時選擇公司發票並填寫統一編號，電子發票會寄到你的 Email。" },
        { question: "資料安全嗎？", answer: "資料加密傳輸並每日備份，店長可以隨時匯出或刪除員工資料。" },
      ] }, undefined, { color: BODY, textAlign: "left" }),
    ], { background: CARD, color: BODY, maxWidth: 800, gap: 32 }),

    // 7. 頁尾 CTA（深色帶）。
    section("closing", [
      h2("closing_title", "下個月的班表，這週就排好", CARD),
      text("closing_text", "開通後 10 分鐘，就能把第一份班表傳給全店員工。", "lead", { color: ON_DARK }),
      button("closing_cta", "查看年訂閱方案", "#offer", { ...cta, margin: "0 auto" }),
      text("closing_footer", "© 班表通（虛構品牌）｜iOS、Android 與網頁版", "small", { color: ON_DARK }),
    ], { background: INK, color: ON_DARK, maxWidth: 720, paddingY: 96, paddingYMobile: 56, gap: 20, align: "center" }),
  ];
}

export const template: ConversionTemplateDefinition = {
  id: "sales-saas-plans",
  kind: "sales",
  number: 6,
  name: "訂閱方案銷售頁",
  description: "專業藍白的軟體訂閱頁：手機 App 畫面首屏、示意 Logo 牆、三大功能卡、方案內容與報價卡並排，退款說明與 FAQ 收尾。",
  category: "軟體／訂閱",
  purposes: ["sales"],
  styles: ["professional"],
  preview: { eyebrow: "銷售頁", headline: "排班 10 分鐘搞定", summary: "手機 App 首屏＋方案內容與報價卡", palette: [BG, PRIMARY, INK], sectionCount: 7 },
  theme: { typography: { headingFont: "sans-tc", bodyFont: "sans-tc", bodySize: 17, bodyLineHeight: 1.75, textColor: BODY, headingColor: INK, linkColor: PRIMARY }, background: { color: BG } },
  settings: { scrollReveal: "fade", stickyCta: { enabled: true, label: "查看年訂閱方案", target: "offer", showDate: false, devices: "mobile_tablet", buttonColor: PRIMARY, buttonTextColor: CARD, backgroundColor: CARD } },
  build,
  thankYou: {
    name: "訂閱方案・訂單感謝頁",
    description: "說明付款確認信、下載 App 與邀請員工三個開通步驟。",
    tokens: { background: BG, surface: CARD, ink: INK, body: BODY, accent: PRIMARY, onAccent: CARD, line: LINE, footerBackground: INK, footerText: ON_DARK, radius: 12 },
    eyebrow: "訂單已送出",
    title: "下載 App，\n開始排第一份班表",
    intro: "付款完成後，確認信與開通方式會寄到你填寫的 Email。用同一個 Email 登入 App，就能看到你的年訂閱。",
    card: { title: "班表通・年訂閱", text: "全部功能，員工人數不限。登入後先建立分店，再用邀請連結把員工加進來。", buttonLabel: "看開通步驟", buttonHref: "#ty-steps" },
    steps: [
      { icon: "message", title: "收確認信", text: "付款完成後寄出，信裡有 App 下載連結與開通說明。" },
      { icon: "rocket", title: "下載 App 並登入", text: "在 App Store 或 Google Play 搜尋「班表通」，用購買時的 Email 登入。" },
      { icon: "users", title: "邀請員工", text: "在「員工」頁產生邀請連結，傳到店裡群組就完成了。" },
    ],
    next: { eyebrow: "需要幫忙導入？", title: "預約 30 分鐘線上導入", text: "我們陪你匯入員工與舊班表，第一週就能用 App 排班。", buttonLabel: "預約導入時段", buttonHref: "#ty-steps" },
    faq: [
      { question: "發票什麼時候會收到？", answer: "付款完成後開立電子發票，寄到結帳時填寫的 Email；需要統編請在結帳時填寫。" },
      { question: "如果不適合，可以退款嗎？", answer: "請依頁面上的試用與退款說明來信申請。範本示意，請依實際政策修改。" },
      { question: "遇到問題要聯絡誰？", answer: "直接回覆確認信，或在 App 的「說明」頁留言，客服會在上班時間回覆。" },
    ],
    footer: "© 班表通（虛構品牌）｜回覆確認信即可聯絡客服。",
  },
};
