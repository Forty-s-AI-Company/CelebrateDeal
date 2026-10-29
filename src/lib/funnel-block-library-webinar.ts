import type { FunnelBlockCategory, FunnelNode } from "@/lib/funnel-page-document";
import { webinarTemplateKit } from "@/lib/funnel-templates/webinar/types";

/**
 * 「講座報名」版型區塊：C-05 三種首屏（split／stacked／overlay）與 webinar 元件的
 * 常用組合。中性配色（白底、深藍字、靛藍主色），對比皆達 WCAG AA；日期一律來自
 * 漏斗的講座排程，區塊內沒有寫死的時間。
 */
const INK = "#0f172a";
const BODY = "#334155";
const PRIMARY = "#4338ca";
const SURFACE = "#f5f7ff";
const NIGHT = "#111827";
const NIGHT_TEXT = "#e5e7eb";

type WebinarBlock = { id: string; category: FunnelBlockCategory; label: string; description: string; factory: (instanceId: string) => FunnelNode };

const primary = { backgroundColor: PRIMARY, color: "#ffffff", borderRadius: 10 } as const;
const signupFields = [
  { name: "name", label: "姓名", placeholder: "王小明", required: true },
  { name: "email", label: "Email", type: "email" as const, placeholder: "name@example.com", required: true },
];

function heroStacked(id: string): FunnelNode {
  const { node, section, headline, text, form } = webinarTemplateKit(id);
  return section("hero", [
    text("eyebrow", "免費線上講座", "eyebrow", { color: PRIMARY }),
    headline("title", "用一句話說清楚這場講座的成果", "h1", { color: INK }),
    text("lead", "補一句說明：誰適合參加、看完能帶走什麼。", "lead"),
    node("facts", "event_facts", { layout: "row", formatLabel: "線上直播", priceLabel: "免費", accentColor: PRIMARY, align: "center" }),
    form("form", { title: "保留我的席位", fields: signupFields, submitLabel: "免費報名", submitStyle: primary, note: "報名後寄送講座連結。", style: { backgroundColor: SURFACE, padding: 28, borderRadius: 16, textAlign: "left", color: INK }, mobile: { style: { padding: 20 } } }),
  ], { background: "#ffffff", color: BODY, maxWidth: 640, gap: 20, align: "center", paddingY: 72, paddingYMobile: 40 });
}

function heroSplit(id: string): FunnelNode {
  const { node, section, columns2, headline, text, form } = webinarTemplateKit(id);
  return section("hero", [columns2("columns", [
    text("eyebrow", "線上講座", "eyebrow", { color: "#c7d2fe" }),
    headline("title", "左側放標題與活動資訊，右側直接報名", "h1", { color: "#ffffff" }),
    text("lead", "平板與手機會改成上下堆疊，表單緊接在活動資訊之後。", "lead", { color: NIGHT_TEXT }),
    node("facts", "event_facts", { layout: "row", formatLabel: "線上直播", priceLabel: "免費", accentColor: "#a5b4fc" }, undefined, { color: "#ffffff" }),
  ], [
    form("form", { title: "立即報名", fields: signupFields, submitLabel: "保留席位", submitStyle: primary, note: "我們只用這些資料寄送講座通知。", style: { backgroundColor: "#ffffff", color: INK, padding: 28, borderRadius: 16, shadow: "medium" }, mobile: { style: { padding: 20 } } }),
  ], { ratio: "7:5", stackOn: "tablet", gap: 48, align: "center" })], { background: NIGHT, color: NIGHT_TEXT, maxWidth: 1160, paddingY: 88, paddingYMobile: 48 });
}

function heroOverlay(id: string): FunnelNode {
  const { node, section, headline, text, form } = webinarTemplateKit(id);
  return section("hero", [
    headline("title", "倒數主導的首屏：時間到就開播", "h1", { color: "#ffffff" }),
    text("lead", "倒數綁定漏斗的開播時間；開播後自動換成「直播進行中」。", "lead", { color: NIGHT_TEXT }),
    node("countdown", "countdown", { variant: "blocks", source: "webinar_start", label: "距離開播", accentColor: "#a5b4fc", numberColor: "#ffffff" }, undefined, { color: "#ffffff" }),
    node("facts", "event_facts", { layout: "row", formatLabel: "線上直播", priceLabel: "免費", accentColor: "#a5b4fc", align: "center" }, undefined, { color: "#ffffff" }),
    form("form", { fields: signupFields, submitLabel: "保留席位", submitStyle: primary, style: { backgroundColor: "#ffffff", color: INK, padding: 24, borderRadius: 16, textAlign: "left" } }),
  ], { background: "#1e1b4b", color: NIGHT_TEXT, maxWidth: 760, gap: 24, align: "center", paddingY: 88, paddingYMobile: 48 });
}

function speakers(id: string): FunnelNode {
  const { node, section, headline } = webinarTemplateKit(id);
  return section("speakers", [
    headline("title", "講者介紹", "h2", { color: INK }),
    node("cards", "speaker_profiles", { layout: "grid", columns: 3, accentColor: PRIMARY, items: [
      { name: "講者一", role: "職稱｜專長", bio: "2–3 行具體成果。" },
      { name: "講者二", role: "職稱｜專長", bio: "2–3 行具體成果。" },
      { name: "講者三", role: "職稱｜專長", bio: "2–3 行具體成果。" },
    ] }),
  ], { background: "#ffffff", color: BODY });
}

function agenda(id: string): FunnelNode {
  const { node, section, headline } = webinarTemplateKit(id);
  return section("agenda", [
    headline("title", "講座議程", "h2", { color: INK }),
    node("timeline", "agenda_timeline", { layout: "vertical", accentColor: PRIMARY, items: [
      { time: "20:00", title: "開場與今日目標", text: "說明這場講座能帶走什麼。" },
      { time: "20:15", title: "主題一", text: "第一段內容的重點。" },
      { time: "20:50", title: "主題二", text: "第二段內容的重點。" },
      { time: "21:15", title: "問答時間", text: "現場回答大家的問題。" },
    ] }),
  ], { background: SURFACE, color: BODY, maxWidth: 760 });
}

function fit(id: string): FunnelNode {
  const { node, section, headline } = webinarTemplateKit(id);
  return section("fit", [
    headline("title", "這場講座適合你嗎？", "h2", { color: INK }),
    node("compare", "fit_compare", { fitItems: ["想快速上手、沒有相關背景", "願意花 90 分鐘跟著做"], notFitItems: ["已經熟悉進階技巧", "只想找現成的模板"], cardColor: "#ffffff" }, undefined, { textAlign: "left" }),
  ], { background: SURFACE, color: BODY, maxWidth: 960, align: "center" });
}

function valueStack(id: string): FunnelNode {
  const { node, section } = webinarTemplateKit(id);
  return section("value", [
    node("stack", "value_stack", { title: "報名就能獲得", accentColor: PRIMARY, cardColor: "#ffffff", items: [
      { title: "講座完整內容", text: "90 分鐘直播與問答", value: "參考價值" },
      { title: "講義與檢查清單", text: "會後寄送", value: "參考價值" },
    ], offerLabel: "本場免費" }, undefined, { color: BODY }),
  ], { background: SURFACE, color: BODY, maxWidth: 640 });
}

function thankYou(id: string): FunnelNode {
  const { node, section, headline, text } = webinarTemplateKit(id);
  return section("thanks", [
    headline("title", "報名完成！", "h1", { color: INK }),
    text("lead", "我們已寄出確認信。把講座加入行事曆，開播前不會錯過。", "lead"),
    node("facts", "event_facts", { layout: "card", title: "{{webinar.title}}", formatLabel: "線上直播", accentColor: PRIMARY }, undefined, { textAlign: "left" }),
    node("calendar", "add_to_calendar", { accentColor: PRIMARY, align: "center" }),
  ], { background: "#ffffff", color: BODY, maxWidth: 640, gap: 24, align: "center" });
}

function stateHero(id: string): FunnelNode {
  const { node, section, stack, headline, text, button } = webinarTemplateKit(id);
  const state = (key: string, title: string, body: string, label: string) => stack(`box_${key}`, [headline(`title_${key}`, title, "h2", { color: INK }), text(`text_${key}`, body, "lead"), button(`button_${key}`, label, "#register", primary)], 16, {}, {});
  const boxes = [
    state("upcoming", "免費報名直播", "開播時間：{{webinar.startAt}}", "立即報名"),
    state("live", "直播進行中", "現在進場還來得及。", "立即進入直播"),
    state("replay", "立即觀看回放", "回放限時開放。", "看回放"),
    state("ended", "本場已結束", "留下資料，下一場開放時第一個通知你。", "加入候補名單"),
  ].map((box, index) => ({ ...box, props: { ...box.props, webinarState: ["upcoming", "live", "replay", "ended"][index] } }));
  return section("state", [node("switch", "webinar_state", {}, boxes)], { background: "#ffffff", color: BODY, maxWidth: 760, align: "center" });
}

function schedule(id: string): FunnelNode {
  const { node, section, headline } = webinarTemplateKit(id);
  return section("schedule", [
    headline("title", "系列課場次", "h2", { color: INK }),
    node("list", "session_schedule", { accentColor: PRIMARY, items: [{ title: "第 1 堂：主題" }, { title: "第 2 堂：主題" }, { title: "第 3 堂：主題" }] }),
  ], { background: SURFACE, color: BODY, maxWidth: 880 });
}

function notice(id: string): FunnelNode {
  const { node, section } = webinarTemplateKit(id);
  return section("notice", [node("callout", "callout", { tone: "compliance", title: "講座聲明", text: "本講座內容為教育分享，不構成任何投資、醫療或法律建議。" })], { background: "#ffffff", color: BODY, maxWidth: 760, paddingY: 48, paddingYMobile: 32 });
}

export const WEBINAR_BLOCKS: readonly WebinarBlock[] = [
  { id: "webinar-hero-stacked", category: "webinar_sections", label: "首屏：標題＋表單（單欄）", description: "eyebrow、標題、活動資訊列與報名表，手機首屏看得到第一個欄位。", factory: heroStacked },
  { id: "webinar-hero-split", category: "webinar_sections", label: "首屏：左文案右表單", description: "深色雙欄首屏，平板與手機改成上下堆疊。", factory: heroSplit },
  { id: "webinar-hero-overlay", category: "webinar_sections", label: "首屏：倒數＋表單卡", description: "大倒數綁定開播時間，下方活動資訊與表單卡。", factory: heroOverlay },
  { id: "webinar-state-hero", category: "webinar_sections", label: "依活動狀態切換的首屏", description: "開場前、直播中、回放期、已結束各一組文案與按鈕。", factory: stateHero },
  { id: "webinar-speakers", category: "webinar_sections", label: "講者卡（三欄）", description: "照片或首字漸層頭像、職稱、成就標籤與簡介。", factory: speakers },
  { id: "webinar-agenda", category: "webinar_sections", label: "議程時間軸", description: "左時間右內容，手機時間移到標題上方。", factory: agenda },
  { id: "webinar-fit", category: "webinar_sections", label: "適合／不適合", description: "兩欄對照，有圖示與標題，不只靠顏色區分。", factory: fit },
  { id: "webinar-value-stack", category: "webinar_sections", label: "價值清單", description: "純展示的參考價值與「本場免費」，不影響任何金額。", factory: valueStack },
  { id: "webinar-session-schedule", category: "webinar_sections", label: "系列課場次表", description: "狀態依日期自動顯示，不能手動標示額滿。", factory: schedule },
  { id: "webinar-thank-you", category: "webinar_sections", label: "報名完成＋加入行事曆", description: "活動資訊卡與 Google 日曆／.ics 按鈕。", factory: thankYou },
  { id: "webinar-notice", category: "webinar_sections", label: "合規聲明提示框", description: "投資、醫療衛教等講座的聲明文字。", factory: notice },
];
