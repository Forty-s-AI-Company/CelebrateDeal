import { WEBINAR_TEMPLATE_SAMPLE_MARK, webinarTemplateKit, type WebinarTemplateDefinition } from "./types";

/**
 * 範本 03：設計工作坊標準講座長頁（specs/03-design-workshop.md）。
 * 紙色底＋方格紙首屏，黑色 2px 粗框、橘色按鈕與藍色重點的手作設計感；
 * 首屏右側是自製的傾斜圖卡拼貼。長頁以紙色與白色交替：適合誰、學到什麼、議程、講者、作品、準備、報名、FAQ。
 */
const ART = "/funnel-illustrations/webinar/03";
const PAPER = "#faf7f2";
const WHITE = "#ffffff";
const INK = "#1d1d1f";
const BODY = "#3f3f46";
const PRIMARY = "#ff5b2e";
const ACCENT = "#2456e8";
const HIGHLIGHT = "#ffe9d6";

function build(prefix: string) {
  const { node, section, columns2, stack, text, button, form } = webinarTemplateKit(prefix);
  /** 橘色按鈕底對紙色只有 2.9:1，所以一律加 2px 墨色邊框（spec §5）。 */
  const cta = { backgroundColor: PRIMARY, color: INK, borderColor: INK, borderWidth: 2, borderRadius: 12, fontSize: 18 } as const;
  const boxed = { borderColor: INK, borderWidth: 2, borderRadius: 16 } as const;
  const title = (id: string, eyebrow: string, value: string, options: { align?: "left" | "center"; level?: "h1" | "h2"; subtitle?: string; mobileTitle?: string } = {}) =>
    node(id, "section_title", { eyebrow, title: value, subtitle: options.subtitle ?? "", level: options.level ?? "h2", decoration: "line", accentColor: ACCENT }, undefined, { color: INK, ...(options.align ? { textAlign: options.align } : {}) }, options.mobileTitle ? { mobile: { props: { title: options.mobileTitle } } } : {});
  /** 粗框卡片容器：裡面放 icon_list 格狀。 */
  const panel = (id: string, list: ReturnType<typeof node>, background: string) => stack(id, [list], 0, { ...boxed, backgroundColor: background, padding: 36 }, { mobile: { style: { padding: 22 } } });
  return [
    // 1. 首屏：左文右拼貼插圖（手機：文→CTA→圖）。
    section("hero", [
      columns2("hero_split", [
        title("hero_title", "線上實作工作坊｜2 小時｜附練習檔", "不靠天分，\n用 *4 個排版規則*\n做出好看的社群圖卡", { level: "h1", mobileTitle: "不靠天分，用 *4 個排版規則*做出好看的社群圖卡" }),
        text("hero_lead", "從字級、對齊、留白到配色，邊看邊做；\n結束時，你會完成 3 張自己的圖卡。", "lead", { color: BODY }, { mobile: { props: { text: "從字級、對齊、留白到配色邊看邊做，結束時完成 3 張自己的圖卡。" } } }),
        node("hero_facts", "event_facts", { layout: "row", formatLabel: "線上實作", priceLabel: "免費", showDuration: false, accentColor: ACCENT }, undefined, { color: INK }),
        button("hero_cta", "報名工作坊", "#register", { ...cta, padding: "16px 36px", width: "fit-content" }, { mobile: { style: { width: "100%" } } }),
        button("hero_agenda", "先看議程 ↓", "#agenda", { backgroundColor: "transparent", color: ACCENT, padding: "8px 0", fontSize: 17, width: "fit-content" }),
      ], [
        node("hero_art", "image", { src: `${ART}/collage.svg`, alt: "三張傾斜的社群圖卡拼貼示意：字級、留白與對齊格線" }, undefined, { imageWidth: 100 }),
      ], { ratio: "1:1", stackOn: "tablet", gap: 48, align: "center" }),
    ], { background: PAPER, color: BODY, maxWidth: 1120, paddingY: 88, paddingYMobile: 40, props: { backgroundImage: `${ART}/graph-paper.svg`, backgroundPosition: "top" } }),

    // 2. 適合誰（4 張白底粗框卡）。
    section("fit", [
      title("fit_title", "WHO IS IT FOR", "這堂工作坊，為這些人設計"),
      panel("fit_panel", node("fit_list", "icon_list", { layout: "grid", columns: 2, numbered: false, accentColor: ACCENT, items: [
        { icon: "star", title: "小店老闆", text: "想自己做活動圖，不想每次都外包。" },
        { icon: "message", title: "社群小編", text: "每天要出圖，希望又快又有一致感。" },
        { icon: "chart", title: "上班族", text: "簡報和提案想看起來更專業。" },
        { icon: "lightbulb", title: "設計新手", text: "會用工具，但總覺得哪裡怪怪的。" },
      ] }, undefined, { color: BODY, textAlign: "left" }), WHITE),
    ], { background: WHITE, color: BODY, maxWidth: 1120, gap: 40 }),

    // 3. 你將學到（成果導向，2×2 螢光底卡片）。
    section("learn", [
      title("learn_title", "WHAT YOU WILL LEARN", "結束時，你*能夠*…"),
      panel("learn_panel", node("learn_list", "icon_list", { layout: "grid", columns: 2, numbered: true, accentColor: ACCENT, items: [
        { icon: "target", title: "用 3 種字級建立層次", text: "所以重點一眼就被看見，不再每行字都一樣大。" },
        { icon: "compass", title: "用格線對齊元素", text: "所以版面看起來整齊，修改時也不會越改越亂。" },
        { icon: "spark", title: "用留白控制閱讀順序", text: "所以讀者的視線會照你安排的路線走。" },
        { icon: "gem", title: "用 60-30-10 配色法挑色", text: "所以顏色不打架，品牌感自然出現。" },
      ] }, undefined, { color: BODY, textAlign: "left" }), HIGHLIGHT),
    ], { background: PAPER, color: BODY, maxWidth: 1120, gap: 40 }),

    // 4. 議程時間軸（錨點 #agenda）。
    section("agenda", [
      title("agenda_title", "AGENDA", "2 小時怎麼進行", { subtitle: "每個規則都是「講解 5 分鐘＋實作 15 分鐘」，邊做邊問。" }),
      node("agenda_timeline", "agenda_timeline", { layout: "vertical", accentColor: ACCENT, items: [
        { time: "0:00", title: "開場與暖身", text: "看 3 張改造前後的圖卡，找出差在哪裡。" },
        { time: "0:10", title: "規則一：字級", text: "用 3 種字級做出標題、重點與補充的層次。" },
        { time: "0:30", title: "規則二：對齊", text: "打開格線，讓每個元素都有依靠。" },
        { time: "0:50", title: "規則三：留白", text: "刪掉一半元素，畫面反而更好看的原因。" },
        { time: "1:10", title: "規則四：配色", text: "60-30-10 配色法，從品牌色推出整套顏色。" },
        { time: "1:30", title: "作品點評與 Q&A", text: "現場挑選學員作品點評，回答你的問題。" },
      ] }, undefined, { color: BODY }),
    ], { background: WHITE, color: BODY, maxWidth: 820, gap: 40, htmlId: "agenda" }),

    // 5. 講者
    section("speaker", [
      title("speaker_title", "YOUR INSTRUCTOR", "帶你做的人"),
      node("speaker_card", "speaker_profiles", { layout: "featured", photoShape: "portrait", accentColor: ACCENT, items: [
        { photo: `${ART}/speaker.svg`, alt: "講者照片（請替換）", name: "許晴", role: "品牌設計師・「晴天排版室」主理人", bio: `做了 10 年品牌與社群設計，教過 3,000 位非設計背景的學員（${WEBINAR_TEMPLATE_SAMPLE_MARK}數據）。相信好看不是天分，而是可以拆解、可以練習的規則。`, tags: "品牌設計,社群圖卡,設計教學" },
      ] }, undefined, { color: BODY }),
    ], { background: PAPER, color: BODY, maxWidth: 1000, gap: 40 }),

    // 6. 學員作品與評價
    section("works", [
      title("works_title", "STUDENT WORKS", "上一梯學員的作品", { align: "center", subtitle: "以下為範本示意作品，請替換為經學員同意公開的作品。" }),
      node("works_gallery", "image_gallery", { layout: "masonry", columns: 3, items: [
        { src: `${ART}/work-1.svg`, alt: "週末市集活動圖卡（範本示意作品）", caption: "週末市集（範本示意）" },
        { src: `${ART}/work-2.svg`, alt: "新品上架圖卡（範本示意作品）", caption: "新品上架（範本示意）" },
        { src: `${ART}/work-3.svg`, alt: "咖啡日常圖卡（範本示意作品）", caption: "咖啡日常（範本示意）" },
        { src: `${ART}/work-4.svg`, alt: "讀書會招募圖卡（範本示意作品）", caption: "讀書會招募（範本示意）" },
        { src: `${ART}/work-5.svg`, alt: "早鳥優惠圖卡（範本示意作品）", caption: "早鳥優惠（範本示意）" },
        { src: `${ART}/work-6.svg`, alt: "手作課程圖卡（範本示意作品）", caption: "手作課程（範本示意）" },
      ] }),
      node("works_reviews", "testimonial_wall", { layout: "grid", columns: 3, autoplay: false, showRating: false, cardColor: WHITE, cardTextColor: BODY, accentColor: ACCENT, items: [
        { name: "學員 A｜甜點店老闆", title: WEBINAR_TEMPLATE_SAMPLE_MARK, text: "原來只要把字級分成 3 種，菜單海報馬上清楚很多。" },
        { name: "學員 B｜社群小編", title: WEBINAR_TEMPLATE_SAMPLE_MARK, text: "現在做一張圖從 1 小時變 20 分鐘，主管也說風格更一致了。" },
        { name: "學員 C｜業務專員", title: WEBINAR_TEMPLATE_SAMPLE_MARK, text: "簡報終於不再塞滿字，客戶開始會停下來看重點。" },
      ] }, undefined, { textAlign: "left" }),
    ], { background: WHITE, color: BODY, maxWidth: 1120, gap: 40, align: "center" }),

    // 7. 參加前準備（含加入行事曆）。
    section("prepare", [
      title("prepare_title", "BEFORE WE START", "參加前，準備這 3 件事", { align: "center" }),
      panel("prepare_panel", node("prepare_list", "icon_list", { layout: "grid", columns: 3, numbered: true, accentColor: ACCENT, items: [
        { icon: "check", title: "一台電腦", text: "手機也能看直播，但實作建議用電腦。" },
        { icon: "spark", title: "任一免費設計工具", text: "任何你習慣的免費線上設計工具都可以。" },
        { icon: "clock", title: "把時間留下來", text: "加入行事曆，開始前會收到提醒信。" },
      ] }, undefined, { color: BODY, textAlign: "left" }), WHITE),
      node("prepare_add", "add_to_calendar", { googleLabel: "加入 Google 日曆", icsLabel: "下載行事曆檔", pendingText: "講座時間公布後即可加入行事曆。", align: "center", accentColor: ACCENT }),
    ], { background: PAPER, color: BODY, maxWidth: 1120, gap: 36, align: "center" }),

    // 8. 報名表（錨點 #register，置中粗框卡）。
    section("register", [
      title("register_title", "SAVE YOUR SEAT", "保留你的工作坊名額", { align: "center" }),
      text("register_date", "{{webinar.startAt}}｜線上實作工作坊", "lead", { color: BODY }),
      form("register_form", {
        title: "免費報名工作坊",
        fields: [
          { name: "name", label: "姓名", placeholder: "王小明", required: true },
          { name: "email", label: "Email", type: "email", placeholder: "name@example.com", required: true, helpText: "工作坊連結與練習檔會寄到這個信箱" },
        ],
        submitLabel: "免費報名",
        submitStyle: cta,
        note: "報名後寄送直播連結與練習檔，可隨時取消訂閱。",
        htmlId: "register",
        style: { ...boxed, backgroundColor: WHITE, color: INK, padding: 36, textAlign: "left", width: "min(100%, 560px)", margin: "0 auto", shadow: "medium" },
        mobile: { style: { padding: 16 } },
      }),
    ], { background: HIGHLIGHT, color: BODY, maxWidth: 720, gap: 32, align: "center" }),

    // 9. FAQ
    section("faq", [
      title("faq_title", "FAQ", "常見問題", { align: "center" }),
      node("faq_list", "faq", { items: [
        { question: "一定要用電腦嗎？", answer: "建議用電腦實作；只用手機也能觀看直播與講解。" },
        { question: "有回放嗎？", answer: "依主辦單位的回放設定，報名者會在信中收到回放資訊。" },
        { question: "練習檔怎麼拿？", answer: "報名成功信與工作坊開始前的提醒信都會附上下載連結。" },
        { question: "完全沒有設計基礎可以嗎？", answer: "可以，這堂課就是為非設計背景的人設計的，每一步都有示範。" },
        { question: "可以開發票嗎？", answer: "本場免費；付費課程的發票依主辦單位的設定開立。" },
      ] }, undefined, { color: BODY, textAlign: "left" }),
    ], { background: WHITE, color: BODY, maxWidth: 720, gap: 32 }),
  ];
}

export const template: WebinarTemplateDefinition = {
  id: "webinar-design-workshop",
  number: 3,
  name: "設計工作坊標準講座長頁",
  description: "紙色方格底、粗框橘色按鈕的工作坊長頁：適合誰、學到什麼、議程時間軸、講者、作品與報名表。",
  category: "實作工作坊",
  purposes: ["webinar"],
  styles: ["natural"],
  preview: { eyebrow: "Workshop", headline: "用 4 個排版規則做出好看的社群圖卡", summary: "方格紙首屏＋議程時間軸長頁", palette: [PAPER, PRIMARY, ACCENT], sectionCount: 9 },
  theme: { typography: { headingFont: "sans-tc", bodyFont: "sans-tc", bodySize: 18, bodyLineHeight: 1.75, textColor: BODY, headingColor: INK, linkColor: ACCENT }, background: { color: PAPER } },
  settings: { eventTitle: "零基礎也能做出好看的社群圖卡：2 小時排版實作工作坊", scrollReveal: "rise", stickyCta: { enabled: true, label: "報名工作坊", showDate: true, devices: "mobile_tablet", buttonColor: PRIMARY, buttonTextColor: INK, backgroundColor: WHITE } },
  build,
};
