import { WEBINAR_TEMPLATE_SAMPLE_MARK, webinarTemplateKit, type WebinarTemplateDefinition } from "./types";

/**
 * 範本 19：烘焙手作插畫風報名頁（specs/19-baking-craft.md）。
 * 奶油色底、暖棕文字、手寫感標題；插畫是主角（2px 棕色描邊＋平塗），卡片像食譜卡。
 * 插畫都在 public/funnel-illustrations/webinar/19/（原創）；講者與學員作品為虛構示意。
 */
const ART = "/funnel-illustrations/webinar/19";
const BG = "#fff7ee";
const BUTTER_LIGHT = "#fdf0dc";
const PAPER = "#fffdf8";
const INK = "#4a2c1d";
const BODY = "#6b4a3a";
const PRIMARY = "#b8492a";
/** Deeper bake colour for small accent text on mint and butter (the primary is just under 4.5:1 there). */
const PRIMARY_DEEP = "#963a1f";
const MINT = "#cfe8d9";

function build(prefix: string) {
  const { node, section, headline, text, button, form } = webinarTemplateKit(prefix);
  const primaryButton = { backgroundColor: PRIMARY, color: "#ffffff", borderRadius: 300, padding: "16px 36px" } as const;
  const title = (id: string, eyebrow: string, value: string, subtitle = "", accent = PRIMARY) => node(id, "section_title", { eyebrow, title: value, subtitle, level: "h2", decoration: "none", accentColor: accent }, undefined, { color: INK, textAlign: "center" });
  const recipeCard = { backgroundColor: PAPER, borderColor: INK, borderWidth: 2, borderRadius: 20 } as const;

  return [
    // 1. 首屏：桌機插畫在左右兩側、內容置中 680px；平板與手機改成標題上方的一組插畫。
    node("hero", "section", { backgroundImage: `${ART}/hero-backdrop.svg`, backgroundPosition: "center" }, [
      node("hero_row", "row", { maxWidth: 680, gap: 22 }, [
        node("hero_art", "image", { src: `${ART}/hero-cluster.svg`, alt: "戚風蛋糕、雞蛋與打蛋器的手繪插畫" }, undefined, { imageWidth: 100 }, { desktop: { visible: false }, tablet: { visible: true, style: { imageWidth: 70 } }, mobile: { visible: true } }),
        text("hero_eyebrow", "免費線上直播示範｜60 分鐘", "eyebrow", { color: PRIMARY, letterSpacing: 3 }),
        headline("hero_title", "第一次做戚風也不塌：\n跟著直播一步一步烤出來", "h1", { fontSize: 50, lineHeight: 1.3, color: INK }, { tablet: { style: { fontSize: 42 } }, mobile: { style: { fontSize: 30, lineHeight: 1.35 }, props: { text: "第一次做戚風也不塌：跟著直播一步一步烤出來" } } }),
        text("hero_lead", "60 分鐘示範，從打發蛋白到倒扣放涼，\n附一張可以貼在冰箱上的零失敗檢查表。", "lead", { color: BODY }, { mobile: { visible: false } }),
        node("hero_facts", "event_facts", { layout: "row", formatLabel: "線上直播", priceLabel: "免費", accentColor: PRIMARY, align: "center" }, undefined, { color: INK, textAlign: "left" }, { mobile: { style: { fontSize: 18 } } }),
        button("hero_cta", "免費報名示範直播", "#register", { ...primaryButton, fontSize: 18 }),
      ]),
    ], { padding: "120px 32px 104px", backgroundColor: BG, color: BODY, textAlign: "center" }, {
      tablet: { style: { padding: "56px 28px 72px" }, props: { backgroundImage: "" } },
      mobile: { style: { padding: "24px 20px 48px" }, props: { backgroundImage: "" } },
    }),
    // 2. 波浪分隔
    node("wave", "shape_divider", { shape: "wave", position: "bottom", height: 72 }, undefined, { color: BUTTER_LIGHT, backgroundColor: BG }, { mobile: { props: { height: 36 } } }),
    // 3. 為什麼常失敗（3 張插畫卡）
    section("fails", [
      title("fails_title", "WHY IT FAILS", "戚風會塌的三個原因", "不是你手殘，是這三個步驟沒人說清楚。", PRIMARY_DEEP),
      node("fails_cards", "image_cards", { columns: 3, aspect: "1:1", corners: false, accentColor: PRIMARY, items: [
        { src: `${ART}/fail-meringue.svg`, alt: "插畫：蛋白打發不足，蛋白霜塌軟", title: "蛋白打發不足", text: "看起來很蓬，其實還沒到勾起來有小彎角的程度。" },
        { src: `${ART}/fail-folding.svg`, alt: "插畫：攪拌過度造成消泡", title: "攪拌時消泡", text: "畫圈攪拌會把氣泡壓破，要用切拌的手勢。" },
        { src: `${ART}/fail-cooling.svg`, alt: "插畫：出爐後要立刻倒扣放涼", title: "出爐沒有倒扣", text: "戚風靠倒扣撐住結構，正放就會慢慢回縮。" },
      ] }, undefined, { color: INK, textAlign: "left" }),
    ], { background: BUTTER_LIGHT, color: BODY, maxWidth: 1080, gap: 48, paddingY: 72 }),
    // 4. 直播會示範（5 步，3＋2，最後一列置左）
    section("steps", [
      title("steps_title", "LIVE DEMO", "直播會示範的 5 個步驟"),
      node("steps_list", "agenda_timeline", { layout: "cards", accentColor: PRIMARY, cardColor: PAPER, items: [
        { time: "STEP 01", title: "分蛋", text: "蛋黃蛋白分乾淨，蛋白盆不能沾到油和水。" },
        { time: "STEP 02", title: "蛋黃糊", text: "油、牛奶、麵粉的順序，拌到滑順沒有顆粒。" },
        { time: "STEP 03", title: "打發蛋白", text: "砂糖分三次加，打到勾起來有小彎角。" },
        { time: "STEP 04", title: "混合", text: "先取三分之一蛋白霜犧牲，再切拌回去。" },
        { time: "STEP 05", title: "烘烤與倒扣", text: "溫度、時間與判斷熟度，出爐立刻倒扣。" },
      ] }, undefined, { color: INK, textAlign: "left" }),
    ], { background: BG, color: BODY, maxWidth: 1080, gap: 48 }),
    // 5. 準備材料清單（食譜紙卡）
    section("materials", [
      node("materials_card", "content_box", { gap: 18 }, [
        text("materials_eyebrow", "RECIPE CARD", "eyebrow", { color: PRIMARY_DEEP, letterSpacing: 3 }),
        headline("materials_title", "準備材料（6 吋戚風）", "h3", { color: INK, fontSize: 26 }, { mobile: { style: { fontSize: 22 } } }),
        node("materials_list", "bulleted_list", { items: ["6 吋中空戚風模（不要用不沾模）", "雞蛋 4 顆（冷藏蛋即可）", "低筋麵粉 70g", "細砂糖 60g（蛋白用 45g、蛋黃用 15g）", "植物油 40g、牛奶 50g", "檸檬汁或白醋幾滴"] }, undefined, { color: BODY }),
        text("materials_note", "配方為示意，商家可替換成自己的配方。直播前一天把材料放在桌上，跟著做最順。", "small", { color: BODY }),
      ], { ...recipeCard, padding: 40, color: BODY, textAlign: "left" }, { mobile: { style: { padding: 24 } } }),
    ], { background: MINT, color: BODY, maxWidth: 560, gap: 32, paddingY: 88 }),
    // 6. 適合／不適合
    section("fit", [
      title("fit_title", "IS IT FOR YOU", "這場直播適合誰"),
      node("fit_compare", "fit_compare", { fitTitle: "適合你，如果你是…", fitItems: ["烘焙新手，第一次做戚風", "戚風失敗過、想知道問題在哪", "想和孩子一起做點心的家長"], notFitTitle: "可能不適合，如果你…", notFitItems: ["已經能穩定做出戚風，想學進階裝飾"], cardColor: PAPER, fitColor: "#2f6b4f", notFitColor: PRIMARY }, undefined, { color: INK, textAlign: "left" }),
    ], { background: BG, color: BODY, maxWidth: 880, gap: 40 }),
    // 7. 學員作品（等高格狀）
    section("works", [
      title("works_title", "FROM OUR STUDENTS", "學員第一次烤出來的戚風", `${WEBINAR_TEMPLATE_SAMPLE_MARK}插畫，請替換成學員授權的作品照片。`, PRIMARY_DEEP),
      node("works_gallery", "image_gallery", { layout: "grid", columns: 3, items: [
        { src: `${ART}/work-1.svg`, alt: "學員作品佔位：原味戚風（範本示意）", caption: `原味戚風｜${WEBINAR_TEMPLATE_SAMPLE_MARK}` },
        { src: `${ART}/work-2.svg`, alt: "學員作品佔位：紅茶戚風（範本示意）", caption: `紅茶戚風｜${WEBINAR_TEMPLATE_SAMPLE_MARK}` },
        { src: `${ART}/work-3.svg`, alt: "學員作品佔位：抹茶戚風（範本示意）", caption: `抹茶戚風｜${WEBINAR_TEMPLATE_SAMPLE_MARK}` },
        { src: `${ART}/work-4.svg`, alt: "學員作品佔位：蜂蜜戚風（範本示意）", caption: `蜂蜜戚風｜${WEBINAR_TEMPLATE_SAMPLE_MARK}` },
        { src: `${ART}/work-5.svg`, alt: "學員作品佔位：檸檬戚風（範本示意）", caption: `檸檬戚風｜${WEBINAR_TEMPLATE_SAMPLE_MARK}` },
        { src: `${ART}/work-6.svg`, alt: "學員作品佔位：可可戚風（範本示意）", caption: `可可戚風｜${WEBINAR_TEMPLATE_SAMPLE_MARK}` },
      ] }, undefined, { color: BODY, textAlign: "left" }),
    ], { background: BUTTER_LIGHT, color: BODY, maxWidth: 1080, gap: 40 }),
    // 8. 講者（插畫頭像）
    section("speaker", [
      node("speaker_card", "speaker_profiles", { layout: "featured", photoShape: "circle", accentColor: PRIMARY, items: [
        { photo: `${ART}/baker.svg`, alt: "蘇小麥的插畫頭像（可替換為照片）", name: "蘇小麥", role: "烘焙教室「麥田小廚房」主理人", tags: "家庭烘焙,戚風,親子課", bio: "從家裡的小烤箱開始做蛋糕，現在每個月帶親子烘焙課（範本示意經歷）。最常被說的一句話是：「原來失敗的原因這麼簡單。」" },
      ] }, undefined, { color: INK, textAlign: "left" }),
    ], { background: BG, color: BODY, maxWidth: 920 }),
    // 9. 報名表
    section("register", [
      title("register_title", "SAVE YOUR SPOT", "一起烤出第一個不塌的戚風", "報名後寄送直播連結和零失敗檢查表。", PRIMARY_DEEP),
      form("register_form", {
        fields: [
          { name: "name", label: "姓名", placeholder: "王小明", required: true },
          { name: "email", label: "Email", type: "email", placeholder: "name@example.com", required: true, helpText: "直播連結與檢查表會寄到這裡" },
        ],
        submitLabel: "免費報名示範直播",
        submitStyle: { ...primaryButton, fontSize: 18 },
        note: "免費參加・可隨時取消訂閱",
        htmlId: "register",
        style: { ...recipeCard, padding: 36, color: INK, textAlign: "left", width: 100 },
        mobile: { style: { padding: 16 } },
      }),
    ], { background: MINT, color: BODY, maxWidth: 520, gap: 32, align: "center" }),
    // 10. FAQ
    section("faq", [
      title("faq_title", "Q&A", "常見問題"),
      node("faq_list", "faq", { items: [
        { question: "沒有烤箱可以嗎？", answer: "可以先看直播學觀念；實際烤戚風需要可以設定溫度的烤箱，小烤箱也能做 4 吋。" },
        { question: "要先準備材料嗎？", answer: "建議照材料清單準備，跟著直播一起做；只想先看也沒問題。" },
        { question: "有回放嗎？", answer: "依主辦單位的回放設定，報名者會收到回放連結與開放期限。" },
        { question: "可以用氣炸鍋嗎？", answer: "氣炸鍋受熱不均，戚風容易表面焦、內部不熟，直播會說明替代做法。" },
      ] }, undefined, { color: BODY, textAlign: "left" }),
    ], { background: BG, color: BODY, maxWidth: 760, gap: 40 }),
  ];
}

export const template: WebinarTemplateDefinition = {
  id: "webinar-baking-craft",
  number: 19,
  name: "烘焙手作插畫風",
  description: "奶油色與手繪插畫的溫暖報名頁：插畫環繞的首屏、食譜紙卡材料清單、5 步示範與學員作品，不需要專業照片也有品牌感。",
  category: "生活手作",
  purposes: ["webinar"],
  styles: ["warm"],
  preview: { eyebrow: "Webinar", headline: "第一次做戚風也不塌", summary: "手繪插畫首屏＋食譜卡材料清單", palette: [BG, PRIMARY, MINT], sectionCount: 10 },
  theme: { typography: { headingFont: "wenkai-tc", bodyFont: "sans-tc", bodySize: 17, bodyLineHeight: 1.8, textColor: BODY, headingColor: INK, linkColor: PRIMARY }, background: { color: BG } },
  settings: {
    eventTitle: "新手也不失敗的戚風蛋糕：線上直播示範＋零失敗檢查表",
    scrollReveal: "rise",
    stickyCta: { enabled: true, label: "免費報名直播", showDate: true, devices: "mobile_tablet", buttonColor: PRIMARY, buttonTextColor: "#ffffff", backgroundColor: PAPER },
  },
  build,
};
