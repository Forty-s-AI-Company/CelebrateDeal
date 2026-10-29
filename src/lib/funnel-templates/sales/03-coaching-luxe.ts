import { CONVERSION_TEMPLATE_SAMPLE_MARK, conversionOfferCard, conversionTemplateKit, type ConversionTemplateDefinition } from "../conversion/types";

/**
 * 銷售 03：高價陪跑方案頁（黑金）（specs/sales-03-coaching-luxe.md）。
 * 與 #497 黑金品牌首頁同一套色票，但是一張「方案頁」：沒有導覽列、首屏單欄置中，
 * 金線同心圓襯底；先講 12 週後的成果、再用適合／不適合篩選對象、說清楚陪跑流程與顧問，
 * 最後在黑底上放一張白色報價卡（結帳元件字色固定深色）。按鈕金底深字，跟隨頁面 linkColor。
 */
const ART = "/funnel-illustrations/sales/03";
const BLACK = "#0c0c0d";
const CHARCOAL = "#17171a";
const INK = "#f5f1e8";
const BODY = "#cfc8bb";
const MUTED = "#a8a092";
const GOLD = "#c9a063";
const CARD = "#ffffff";
const CARD_INK = "#16140f";
const CARD_BODY = "#4a443b";
const LINE = "#2c2a27";
const SAMPLE = CONVERSION_TEMPLATE_SAMPLE_MARK;

function build(prefix: string) {
  const { node, section, stack, headline, text, button, columns2 } = conversionTemplateKit(prefix);
  const gold = { backgroundColor: GOLD, color: BLACK, borderRadius: 0, fontSize: 17, letterSpacing: 2, padding: "18px 44px", width: "fit-content", margin: "0 auto" } as const;
  const eyebrow = (id: string, value: string) => text(id, value, "eyebrow", { color: GOLD, letterSpacing: 4, textAlign: "center" });
  const h2 = (id: string, value: string, mobileText?: string) => headline(id, value, "h2", { color: INK, fontSize: 40, lineHeight: 1.35, textAlign: "center" }, {
    tablet: { style: { fontSize: 34 } },
    mobile: { style: { fontSize: 27, lineHeight: 1.4 }, ...(mobileText ? { props: { text: mobileText } } : {}) },
  });
  const rule = (id: string) => node(id, "image", { src: `${ART}/rule.svg`, alt: "" }, undefined, { imageWidth: 24, textAlign: "center" }, { mobile: { style: { imageWidth: 56 } } });
  const heading = (id: string, label: string, title: string, mobileText?: string) => stack(`${id}_heading`, [eyebrow(`${id}_eyebrow`, label), h2(`${id}_title`, title, mobileText)], 14);

  return [
    // 1. 首屏：黑底金線同心圓，單欄置中；只有一個動作。
    section("hero", [
      eyebrow("hero_eyebrow", "PERSONAL BRAND · 12 WEEKS"),
      headline("hero_title", "12 週，把你的專業\n變成一個被記得的品牌", "h1", { color: INK, fontSize: 60, lineHeight: 1.28, textAlign: "center" }, {
        tablet: { style: { fontSize: 46 } },
        mobile: { style: { fontSize: 32, lineHeight: 1.35 }, props: { text: "12 週，把你的專業變成一個被記得的品牌" } },
      }),
      rule("hero_rule"),
      text("hero_lead", "一對一個人品牌陪跑計畫。從定位、作品集到第一場公開發表，顧問每週和你一起把想法做成看得見的成果。", "lead", { color: BODY, textAlign: "center", width: "min(100%, 640px)", margin: "0 auto" }),
      button("hero_cta", "查看陪跑方案", "#offer", gold),
      text("hero_note", "一對一進行・每週一次會談・結帳後安排第一次會談", "small", { color: MUTED, letterSpacing: 1, textAlign: "center" }, { mobile: { props: { text: "一對一進行・每週一次會談" } } }),
    ], { background: BLACK, color: BODY, maxWidth: 880, gap: 28, align: "center", paddingY: 152, paddingYTablet: 112, paddingYMobile: 56, props: { backgroundImage: `${ART}/hero-lines.svg`, backgroundPosition: "center" } }),

    // 2. 12 週後你會擁有：2×2 金線卡。
    section("outcome", [
      heading("outcome", "WHAT YOU'LL HAVE", "12 週後，你會擁有"),
      stack("outcome_panel", [
        node("outcome_list", "icon_list", { layout: "grid", columns: 2, numbered: false, accentColor: GOLD, items: [
          { icon: "compass", title: "一句說得清楚的定位", text: "別人問你做什麼時，30 秒內講清楚你幫誰、解決什麼問題。" },
          { icon: "gem", title: "一份會說話的作品集", text: "3 個代表案例整理成故事，讓潛在客戶一看就懂你的價值。" },
          { icon: "message", title: "可持續的內容節奏", text: "一套每週 2 小時就能維持的發文系統，不再三天打魚。" },
          { icon: "trophy", title: "第一場公開發表", text: "一場講座、一篇長文或一集訪談，讓你的名字被更多人看見。" },
        ] }, undefined, { color: INK, textAlign: "left" }),
      ], 0, { backgroundColor: CHARCOAL, borderColor: LINE, borderWidth: 1, padding: 48 }, { mobile: { style: { padding: 22 } } }),
    ], { background: BLACK, color: BODY, maxWidth: 1040, gap: 40, align: "center" }),

    // 3. 適合／不適合：高價方案先篩選對象。
    section("fit", [
      heading("fit", "IS THIS FOR YOU", "先確認，這是不是你需要的"),
      node("fit_compare", "fit_compare", {
        fitTitle: "適合你，如果你…",
        fitItems: ["已經有 3 年以上的專業經驗", "想接更好的案子，而不是更多案子", "願意每週固定投入 4–6 小時", "準備好讓更多人認識你"],
        notFitTitle: "先不要報名，如果你…",
        notFitItems: ["期待 12 週後立刻爆紅或保證收入", "還在找自己想做的方向", "沒辦法每週固定和顧問會談", "希望有人幫你代寫、代經營"],
        fitColor: GOLD, notFitColor: MUTED, cardColor: CHARCOAL,
      }, undefined, { color: INK, textAlign: "left" }),
    ], { background: CHARCOAL, color: BODY, maxWidth: 1040, gap: 40, align: "center" }),

    // 4. 陪跑流程：四個階段。
    section("process", [
      heading("process", "THE PROCESS", "12 週，分三個階段走"),
      node("process_steps", "agenda_timeline", { layout: "steps", accentColor: GOLD, cardColor: CHARCOAL, items: [
        { time: "第 1–4 週", title: "診斷與定位", text: "盤點經歷、作品與目標客群，寫下定位句、服務方案與價格策略，知道該對誰說話。", tag: "一對一會談＋工作表" },
        { time: "第 5–9 週", title: "內容系統", text: "把代表案例整理成作品集，建立每週可維持的內容節奏；顧問逐篇給回饋，直到你能自己運轉。", tag: "逐篇回饋" },
        { time: "第 10–12 週", title: "公開發表", text: "規劃並完成第一場公開發表，發表前一起彩排，結束後檢討下一步。", tag: "成果" },
      ] }, undefined, { color: INK, textAlign: "left" }),
    ], { background: BLACK, color: BODY, maxWidth: 1040, gap: 40, align: "center" }),

    // 5. 顧問介紹：大頭照＋經歷；數據金框，標示範本示意。
    section("consultant", [
      heading("consultant", "YOUR CONSULTANT", "陪你走這 12 週的人"),
      node("consultant_card", "speaker_profiles", { layout: "featured", photoShape: "portrait", accentColor: GOLD, gradientFrom: GOLD, gradientTo: CHARCOAL, items: [
        { photo: `${ART}/consultant.svg`, alt: "顧問沈亦凡照片（請替換為本人照片）", name: "沈亦凡", role: "個人品牌顧問（虛構人物）", bio: "曾在品牌顧問公司負責企業識別專案，後來發現最需要被整理的，往往是專業工作者自己。這幾年專注一對一陪跑，陪設計師、講師與顧問把專業說清楚，再讓對的人找到他們。", tags: "品牌策略,內容企劃,公開演講" },
      ] }, undefined, { color: INK, textAlign: "left" }),
      node("consultant_stats", "stats", { animate: true, framed: true, accentColor: GOLD, items: [
        { value: "10", suffix: "年", label: `品牌策略經驗（${SAMPLE}）` },
        { value: "180", suffix: "+", label: `陪跑過的專業工作者（${SAMPLE}）` },
        { value: "4.9", suffix: "/5", label: `學員滿意度（${SAMPLE}）` },
      ] }, undefined, { color: INK }),
    ], { background: CHARCOAL, color: BODY, maxWidth: 1040, gap: 44, align: "center" }),

    // 6. 學員案例：三張深色卡（範本示意）。
    section("cases", [
      heading("cases", "CASE STUDIES", "他們 12 週後的變化"),
      node("cases_cards", "content_cards", { columns: 3, accentColor: GOLD, cardColor: CHARCOAL, cardTextColor: INK, items: [
        { src: `${ART}/case-1.svg`, alt: "案例示意插圖：上升曲線", category: `接案設計師（${SAMPLE}）`, title: "從削價接案，到只接品牌專案", text: "重新定位服務方案後，詢問的客戶類型明顯改變，開始收到完整品牌識別的委託。" },
        { src: `${ART}/case-2.svg`, alt: "案例示意插圖：同心圓焦點", category: `企業講師（${SAMPLE}）`, title: "一句定位，讓邀約變精準", text: "把「什麼都能講」收斂成一個主題，企業內訓的邀約更容易談成。" },
        { src: `${ART}/case-3.svg`, alt: "案例示意插圖：堆疊方塊", category: `財務顧問（${SAMPLE}）`, title: "第一場講座，累積第一批名單", text: "用 12 週準備一場線上講座，講座後的諮詢預約成為新客戶的主要來源。" },
      ] }, undefined, { textAlign: "left" }),
      text("cases_note", `以上案例為${SAMPLE}內容，發布前請替換為經學員同意公開的真實案例。`, "small", { color: MUTED, textAlign: "center" }),
    ], { background: BLACK, color: BODY, maxWidth: 1120, gap: 36, align: "center" }),

    // 7. 方案內容（價值清單，純展示）＋白色報價卡（價格與結帳來自綁定商品）。
    section("plan", [
      heading("plan", "THE PROGRAM", "方案內容"),
      node("plan_deadline", "deadline_notice", { label: "本期申請截止", closedText: "本期已截止，歡迎留意下一期開放時間", accentColor: GOLD }, undefined, { color: INK, textAlign: "center" }),
      columns2("plan_split", [
        node("plan_stack", "value_stack", {
          title: "12 週陪跑包含",
          items: [
            { title: "12 次一對一會談", text: "每週 60 分鐘線上會談，會後附重點紀錄。", value: "NT$36,000" },
            { title: "定位與方案工作表", text: "定位句、服務方案與價格策略三份工作表。", value: "NT$6,000" },
            { title: "內容逐篇回饋", text: "第 5–9 週的作品集與貼文，顧問逐篇給修改建議。", value: "NT$12,000" },
            { title: "公開發表陪練", text: "講稿或長文結構審閱，發表前一次彩排。", value: "NT$8,000" },
            { title: "會談之間的訊息諮詢", text: "工作日內回覆，卡住時不用等到下次會談。", value: "NT$6,000" },
          ],
          totalLabel: "總價值", totalValue: "NT$68,000",
          note: `價值為${SAMPLE}參考，非售價承諾；實際售價以方案卡為準。`,
          accentColor: GOLD, cardColor: CHARCOAL, cardTextColor: INK,
        }, undefined, { textAlign: "left" }),
      ], conversionOfferCard(prefix, "offer", {
        title: "12 週個人品牌陪跑計畫",
        lines: ["一對一・每週 60 分鐘會談", "工作表、逐篇回饋與發表陪練", "結帳後 3 個工作天內安排第一次會談"],
        note: "付款在安全金流頁面完成；付款完成後，你會收到確認信與課前問卷連結。",
        titleColor: CARD_INK, noteColor: CARD_BODY, htmlId: "offer",
        style: { backgroundColor: CARD, borderColor: GOLD, borderWidth: 1, borderRadius: 4, padding: 40, shadow: "strong", color: CARD_INK },
        mobile: { style: { padding: 24 } },
      }), { ratio: "7:5", stackOn: "tablet", gap: 40, align: "start" }),
      node("plan_policy", "callout", { tone: "info", title: "退費與更換時段", text: "第一次會談後 48 小時內覺得不適合，可來信申請全額退費；之後依未進行的會談次數比例退費。\n\n以上為範本文字，請依你實際的退費政策修改，並與結帳頁的退款政策一致。" }, undefined, { textAlign: "left" }),
    ], { background: BLACK, color: BODY, maxWidth: 1080, gap: 32, align: "center", props: { backgroundImage: `${ART}/hero-lines.svg`, backgroundPosition: "bottom" } }),

    // 8. FAQ＋最後 CTA。
    section("faq", [
      heading("faq", "FAQ", "申請前的常見問題"),
      node("faq_list", "faq", { items: [
        { question: "會談是線上還是實體？", answer: "全程線上視訊進行，會談時間在第一次會談時一起排定，之後每週固定。" },
        { question: "如果某一週沒辦法會談？", answer: "提前 24 小時告知即可改期；整個陪跑期間可改期 2 次，不影響總次數。" },
        { question: "陪跑能保證接案量或收入嗎？", answer: "不能。我們陪你把定位、作品集與發表做出來，成效取決於你的專業與執行，任何保證收入的說法都請保持警覺。" },
        { question: "我還沒有作品集，可以參加嗎？", answer: "可以，但需要有實際的專業經驗。第 5–9 週會一起把過去的經驗整理成案例。" },
        { question: "可以開立公司發票嗎？", answer: "可以，請在結帳時填寫統一編號與公司抬頭。" },
      ] }, undefined, { textAlign: "left", color: INK }),
      button("faq_cta", "查看陪跑方案", "#offer", gold),
    ], { background: CHARCOAL, color: BODY, maxWidth: 800, gap: 36, align: "center" }),

    section("footer", [
      rule("footer_rule"),
      text("footer_text", "© 沈亦凡品牌工作室（虛構品牌）｜申請與方案問題，請來信洽詢。", "small", { color: MUTED, textAlign: "center" }),
    ], { background: BLACK, color: MUTED, maxWidth: 960, paddingY: 48, paddingYTablet: 40, paddingYMobile: 32, gap: 16, align: "center" }),
  ];
}

export const template: ConversionTemplateDefinition = {
  id: "sales-coaching-luxe",
  kind: "sales",
  number: 3,
  name: "高價陪跑方案頁（黑金）",
  description: "黑底金線的一對一陪跑方案頁：成果、適合／不適合、四階段流程、顧問與案例，最後是價值清單＋白色報價卡與退費說明。",
  category: "顧問／陪跑",
  purposes: ["sales"],
  styles: ["luxe"],
  preview: { eyebrow: "銷售頁", headline: "12 週，把你的專業變成一個被記得的品牌", summary: "黑金陪跑方案＋白色報價卡", palette: [BLACK, GOLD, INK], sectionCount: 9 },
  theme: { typography: { headingFont: "serif-tc", bodyFont: "sans-tc", bodySize: 17, bodyLineHeight: 1.8, textColor: BODY, headingColor: INK, linkColor: GOLD }, background: { color: BLACK } },
  settings: { scrollReveal: "fade", stickyCta: { enabled: true, label: "查看陪跑方案", target: "offer", showDate: false, devices: "mobile_tablet", buttonColor: GOLD, buttonTextColor: BLACK, backgroundColor: CHARCOAL } },
  build,
  thankYou: {
    name: "黑金陪跑・訂單感謝頁",
    description: "說明付款確認信、課前問卷與第一次會談的預約方式。",
    tokens: { background: BLACK, surface: CHARCOAL, ink: INK, body: BODY, accent: GOLD, onAccent: BLACK, line: LINE, footerBackground: "#050505", footerText: MUTED, radius: 2 },
    eyebrow: "已收到你的申請與訂單",
    title: "歡迎加入，接下來 12 週我們一起走",
    intro: "付款完成後，你會收到一封確認信，裡面有課前問卷與預約第一次會談的連結。如果 10 分鐘內沒看到，請檢查促銷內容或垃圾郵件匣。",
    card: { title: "預約第一次會談", text: "12 週個人品牌陪跑計畫：請先完成課前問卷，再從確認信中的連結選擇第一次會談時間。顧問會在會談前讀完你的問卷。", buttonLabel: "看看接下來的步驟", buttonHref: "#ty-steps" },
    steps: [
      { icon: "message", title: "收確認信", text: "確認信寄到結帳時填寫的 Email，請把寄件者加入通訊錄。" },
      { icon: "book", title: "填寫課前問卷", text: "約 20 分鐘：你的經歷、作品與目標客群，寫得越具體越好。" },
      { icon: "clock", title: "預約第一次會談", text: "從確認信的連結選擇時段，之後每週同一時間會談。" },
    ],
    faq: [
      { question: "發票什麼時候會寄出？", answer: "電子發票會在付款完成後寄到你的 Email；公司發票請確認結帳時已填寫統一編號。" },
      { question: "想申請退費怎麼辦？", answer: "請依方案頁的退費說明來信，並附上訂單編號，我們會在工作天內回覆。" },
      { question: "要怎麼聯絡顧問？", answer: "第一次會談前請回覆確認信；會談開始後，可使用會談中提供的訊息管道。" },
    ],
    footer: "© 沈亦凡品牌工作室（虛構品牌）｜申請與方案問題，請來信洽詢。",
  },
};
