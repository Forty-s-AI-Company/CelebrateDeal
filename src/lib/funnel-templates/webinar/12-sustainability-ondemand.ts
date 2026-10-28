import { WEBINAR_TEMPLATE_SAMPLE_MARK, webinarTemplateKit, type WebinarTemplateDefinition } from "./types";

/**
 * specs/12：永續主題隨選／回放狀態報名頁。同一頁在開場前、直播中、回放期、已結束都能繼續收名單：
 * 首屏的狀態膠囊、引言與按鈕、回放章節、頁尾文案都由 C-15 依漏斗排程切換；H1 與報名表共用。
 */
const ART = "/funnel-illustrations/webinar/12";
const BG = "#f3f6ef";
const CARD = "#ffffff";
const INK = "#1e3323";
const BODY = "#3e5442";
const MUTED = "#5f7262";
const PRIMARY = "#2e6b3f";
const ACCENT = "#4d6b1f";
const LIME = "#c8d96f";
const FOOTER_BODY = "#dfe8d9";

type State = "upcoming" | "live" | "replay" | "ended";

function build(prefix: string) {
  const { node, section, columns2, headline, text, button, form } = webinarTemplateKit(prefix);
  const primaryButton = { backgroundColor: PRIMARY, color: "#ffffff", borderRadius: 10, padding: "16px 32px", fontSize: 18 } as const;
  const h2 = (id: string, value: string, extra = {}) => headline(id, value, "h2", { color: INK, fontSize: 32, lineHeight: 1.3, ...extra }, { mobile: { style: { fontSize: 24 } } });
  const eyebrow = (id: string, value: string, color = ACCENT) => text(id, value, "eyebrow", { color, letterSpacing: 2 });
  /** C-15 子內容盒：只在指定狀態顯示。 */
  const when = (id: string, state: State, children: ReturnType<typeof text>[], gap = 20) => node(id, "content_box", { gap, webinarState: state }, children, { padding: 0 });
  const pill = (id: string, label: string) => text(id, label, "small", { backgroundColor: LIME, color: INK, borderRadius: 100, padding: "6px 16px", width: "fit-content", letterSpacing: 1 });

  const HERO: Record<State, { pill: string; lead: string; cta: string }> = {
    upcoming: { pill: "● 即將開播｜免費線上講座", lead: "從包材、冷氣到物流，循環經濟顧問帶你算出每個月省得下來的錢與碳。不用寫報告，也不用大筆投資。", cta: "免費報名直播" },
    live: { pill: "● 直播進行中", lead: "直播正在進行。留下 Email，馬上收到直播連結，現在加入還來得及。", cta: "立即進入直播" },
    replay: { pill: "● 回放開放中", lead: "錯過直播也沒關係。回放限時開放，留下 Email 就能立即觀看完整內容與章節重點。", cta: "立即觀看回放（開放至 {{webinar.replayEndsAt}}）" },
    ended: { pill: "● 本場已結束", lead: "這一場已經結束。留下 Email，下一場開放報名時第一個通知你。", cta: "通知我下一場" },
  };
  /** C-15 內容盒：膠囊、引言與按鈕依狀態切換；H1 與活動資訊列不放進來，只寫一次。 */
  const stateBlock = (id: string, parts: (state: State) => ReturnType<typeof text>[]) =>
    node(id, "webinar_state", {}, (["upcoming", "live", "replay", "ended"] as const).map((state) => when(`${id}_${state}`, state, parts(state), 20)));

  return [
    // 1. 首屏：左欄 = 狀態膠囊（依狀態）、H1（共用）、引言與 CTA（依狀態）、活動資訊列（共用）；右側插畫與報名表。
    section("hero", [
      columns2("hero_columns", [
        stateBlock("hero_pill", (state) => [pill(`hero_pilltext_${state}`, HERO[state].pill)]),
        headline("hero_title", "小店也能做的減碳：\n明天就能開始的 6 個作法", "h1", { color: INK, fontSize: 44, lineHeight: 1.3 }, {
          tablet: { style: { fontSize: 38 } },
          mobile: { style: { fontSize: 28 }, props: { text: "小店也能做的減碳：明天就能開始的 6 個作法" } },
        }),
        stateBlock("hero_action", (state) => [
          text(`hero_lead_${state}`, HERO[state].lead, "lead", { color: BODY }),
          button(`hero_cta_${state}`, HERO[state].cta, "#register", primaryButton),
        ]),
        node("hero_facts", "event_facts", { layout: "row", formatLabel: "線上直播＋回放", priceLabel: "免費", showDuration: true, accentColor: PRIMARY }, undefined, { color: BODY }),
      ], [
        node("hero_image", "image", { src: `${ART}/hero-shop.svg`, alt: "綠意環繞的小店門面插畫" }, undefined, { imageWidth: 100, borderRadius: 16 }, { mobile: { visible: false } }),
        form("hero_form", {
          title: "留下 Email，取得講座連結",
          fields: [
            { name: "name", label: "姓名", placeholder: "王小明", required: true },
            { name: "email", label: "Email", type: "email", placeholder: "name@example.com", required: true },
          ],
          submitLabel: "免費取得連結",
          submitStyle: { backgroundColor: PRIMARY, color: "#ffffff", borderRadius: 10, fontSize: 18 },
          note: "開播前寄直播連結；直播後寄回放或下一場通知。可隨時取消訂閱。",
          htmlId: "register",
          style: { backgroundColor: CARD, padding: 28, borderRadius: 16, color: INK, textAlign: "left", width: 100, shadow: "medium" },
          mobile: { style: { padding: 20 } },
        }),
      ], { ratio: "1:1", gap: 56, stackOn: "tablet", align: "center" }),
    ], { background: BG, color: BODY, maxWidth: 1120, paddingY: 88, paddingYTablet: 64, paddingYMobile: 40 }),

    // 2. 6 個作法。
    section("actions", [
      eyebrow("actions_eyebrow", "講座內容"),
      h2("actions_title", "6 個不用大投資的減碳作法"),
      node("actions_list", "agenda_timeline", { layout: "cards", accentColor: PRIMARY, cardColor: BG, items: [
        { time: "作法 01", title: "包材減量", text: "重新設計出貨尺寸，少一層填充，也少一筆耗材費。" },
        { time: "作法 02", title: "冷氣溫度管理", text: "設定溫度與開關時段，夏天電費最有感的一步。" },
        { time: "作法 03", title: "照明換裝", text: "汰換老舊燈具，用回收年限算出值不值得換。" },
        { time: "作法 04", title: "在地採購", text: "縮短進貨距離，同時建立和在地供應商的關係。" },
        { time: "作法 05", title: "物流合併", text: "和鄰近店家共同配送，減少空車與零散出貨。" },
        { time: "作法 06", title: "顧客自備容器", text: "用小折扣鼓勵自備，讓顧客一起參與。" },
      ] }, undefined, { color: BODY, textAlign: "left", width: 100 }),
    ], { background: CARD, color: BODY, maxWidth: 1120, gap: 24, align: "center" }),

    // 3. 數據（標示資料來源）＋ 4. 回放章節（只在回放期顯示）。
    section("impact", [
      eyebrow("impact_eyebrow", "做了會怎樣"),
      h2("impact_title", "小改變，帳單上看得見"),
      node("impact_stats", "stats", { animate: true, accentColor: PRIMARY, items: [
        { value: "18", suffix: "%", label: "包材成本可節省比例（範本示意）" },
        { value: "1200", suffix: "元", label: "每月電費節省參考值（範本示意）" },
        { value: "320", suffix: "家", label: "參與店家數（範本示意）" },
      ] }, undefined, { color: INK }),
      text("impact_source", `數據為${WEBINAR_TEMPLATE_SAMPLE_MARK}。發布前請替換為實際數字，並註明資料來源與統計期間。`, "small", { color: MUTED, textAlign: "center" }),
      node("impact_replay", "webinar_state", {}, [
        when("impact_replay_box", "replay", [
          h2("impact_replay_title", "回放章節：直接跳到你需要的段落", { fontSize: 26, textAlign: "left" }),
          node("impact_replay_chapters", "agenda_timeline", { layout: "steps", accentColor: PRIMARY, cardColor: BG, items: [
            { time: "00:00", title: "開場：小店的碳從哪裡來" },
            { time: "08:30", title: "包材減量與出貨尺寸" },
            { time: "21:10", title: "冷氣、照明與電費試算" },
            { time: "36:40", title: "在地採購與物流合併" },
            { time: "49:20", title: "顧客自備容器與溝通" },
            { time: "55:00", title: "Q&A 與下一步" },
          ] }, undefined, { color: BODY, textAlign: "left" }),
        ], 24),
      ]),
    ], { background: BG, color: BODY, maxWidth: 1000, gap: 24, align: "center" }),

    // 5. 講者與主辦。
    section("speakers", [
      eyebrow("speakers_eyebrow", "講者與主辦"),
      h2("speakers_title", "實際陪小店做過減碳的人"),
      node("speakers_grid", "speaker_profiles", { layout: "grid", columns: 2, photoShape: "circle", accentColor: PRIMARY, gradientFrom: PRIMARY, gradientTo: LIME, items: [
        { photo: `${ART}/speaker.svg`, alt: "講者蔡宗翰的照片（請替換）", name: "蔡宗翰", role: "循環經濟顧問", bio: "輔導餐飲、零售與選物店導入減碳作法，擅長把永續目標換算成每個月看得懂的成本。", tags: "循環經濟,店家輔導" },
        { photo: `${ART}/org.svg`, alt: "綠色小店聯盟示意字標（請替換）", name: "綠色小店聯盟", role: "主辦單位（虛構）", bio: "由在地小店組成的互助社群，分享共同採購、共同配送與減塑經驗。", tags: "店家社群,共同配送" },
      ] }, undefined, { color: BODY, textAlign: "left" }),
    ], { background: CARD, color: BODY, maxWidth: 1000, gap: 24, align: "center" }),

    // 6. 延伸閱讀。
    section("reading", [
      eyebrow("reading_eyebrow", "延伸閱讀"),
      h2("reading_title", "看講座之前，可以先讀這些"),
      node("reading_cards", "content_cards", { columns: 3, accentColor: ACCENT, cardColor: CARD, cardTextColor: INK, items: [
        { src: `${ART}/thumb-bag.svg`, alt: "牛皮紙袋插圖", category: "包材", title: "出貨箱少一號，一年能省多少？", text: "用三個問題檢查你的出貨尺寸。", href: "#register", linkLabel: "閱讀文章" },
        { src: `${ART}/thumb-bulb.svg`, alt: "省電燈泡插圖", category: "電費", title: "換燈之前，先算回收年限", text: "一張表看懂哪些燈值得先換。", href: "#register", linkLabel: "閱讀文章" },
        { src: `${ART}/thumb-truck.svg`, alt: "共同配送貨車插圖", category: "物流", title: "和隔壁店一起出貨的 4 個條件", text: "共同配送前要先談好的事。", href: "#register", linkLabel: "閱讀文章" },
      ] }, undefined, { color: BODY, textAlign: "left" }),
    ], { background: BG, color: BODY, maxWidth: 1120, gap: 24, align: "center" }),

    // 8. FAQ。
    section("faq", [
      h2("faq_title", "常見問題", { textAlign: "center" }),
      node("faq_list", "faq", { items: [
        { question: "回放看到什麼時候？", answer: "回放開放期間依主辦單位的設定，報名後會在信中附上觀看期限。" },
        { question: "需要先有永續報告嗎？", answer: "不需要。講座從店裡每天的支出開始談，沒有任何報告也能直接套用。" },
        { question: "可以用於員工訓練嗎？", answer: "可以。歡迎和店內夥伴一起觀看，回放也適合當作新人訓練教材。" },
        { question: "下一場什麼時候？", answer: "場次公布後會先通知已報名的人。本場結束後留下 Email，也會收到下一場通知。" },
      ] }, undefined, { textAlign: "left", color: BODY }),
    ], { background: CARD, color: BODY, maxWidth: 760, gap: 24 }),

    // 7. 頁尾 CTA（文案依狀態改變，捲回首屏報名表）。
    section("footer_cta", [
      node("footer_state", "webinar_state", {}, [
        when("footer_upcoming", "upcoming", [
          headline("footer_upcoming_title", "下一個減碳的人，可以是你的店", "h2", { color: "#ffffff", fontSize: 32 }, { mobile: { style: { fontSize: 24 } } }),
          text("footer_upcoming_date", "{{webinar.startAt}}｜線上直播，提供回放", undefined, { color: FOOTER_BODY }),
          node("footer_upcoming_calendar", "add_to_calendar", { align: "center", accentColor: LIME }, undefined, { color: FOOTER_BODY }),
          button("footer_upcoming_cta", "免費報名直播", "#register", { ...primaryButton, backgroundColor: LIME, color: INK }),
        ]),
        when("footer_live", "live", [
          headline("footer_live_title", "直播正在進行", "h2", { color: "#ffffff", fontSize: 32 }, { mobile: { style: { fontSize: 24 } } }),
          button("footer_live_cta", "立即進入直播", "#register", { ...primaryButton, backgroundColor: LIME, color: INK }),
        ]),
        when("footer_replay", "replay", [
          headline("footer_replay_title", "回放限時開放中", "h2", { color: "#ffffff", fontSize: 32 }, { mobile: { style: { fontSize: 24 } } }),
          button("footer_replay_cta", "立即觀看回放", "#register", { ...primaryButton, backgroundColor: LIME, color: INK }),
        ]),
        when("footer_ended", "ended", [
          headline("footer_ended_title", "下一場開放時，第一個通知你", "h2", { color: "#ffffff", fontSize: 32 }, { mobile: { style: { fontSize: 24 } } }),
          button("footer_ended_cta", "通知我下一場", "#register", { ...primaryButton, backgroundColor: LIME, color: INK }),
        ]),
      ]),
      text("footer_note", "主辦：綠色小店聯盟（範本示意）", "small", { color: FOOTER_BODY }),
    ], {
      background: INK, color: FOOTER_BODY, maxWidth: 720, gap: 24, align: "center", paddingY: 104, paddingYMobile: 64,
      props: { backgroundImage: `${ART}/leaf-lines.svg`, backgroundPosition: "center" },
    }),
  ];
}

export const template: WebinarTemplateDefinition = {
  id: "webinar-sustainability-ondemand",
  number: 12,
  name: "永續隨選回放報名頁",
  description: "同一頁依開場前、直播中、回放期、已結束自動切換狀態與按鈕，適合長期投放的永續、ESG 與公共教育講座。",
  category: "永續講座",
  purposes: ["webinar"],
  styles: ["natural"],
  preview: { eyebrow: "On-demand", headline: "小店也能做的減碳", summary: "依狀態切換的首屏＋回放章節", palette: [BG, PRIMARY, LIME], sectionCount: 7 },
  theme: { typography: { headingFont: "sans-tc", bodyFont: "sans-tc", bodySize: 17, bodyLineHeight: 1.8, textColor: BODY, headingColor: INK, linkColor: PRIMARY }, background: { color: BG } },
  settings: { eventTitle: "小店也能做的減碳：從包材到電費的 6 個實際作法", scrollReveal: "fade", stickyCta: { enabled: true, label: "免費取得連結", showDate: true, devices: "mobile_tablet", buttonColor: PRIMARY, buttonTextColor: "#ffffff" } },
  build,
};
