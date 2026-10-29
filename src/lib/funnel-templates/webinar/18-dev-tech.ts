import { webinarTemplateKit, type WebinarTemplateDefinition } from "./types";

/**
 * 範本 18：程式開發者技術講座報名頁（specs/18-dev-tech.md）。
 * 深色編輯器風：深藍黑底＋細格線、1px 邊框卡片、程式碼框就是主視覺；資訊密度高、少行銷語言、不放動畫。
 * 程式碼片段為原創示意碼；講者為虛構，照片是 public/funnel-illustrations/webinar/18/ 的替換佔位圖。
 */
const ART = "/funnel-illustrations/webinar/18";
const BG = "#0b1220";
const SURFACE = "#111a2e";
const BORDER = "#1e293b";
const INK = "#e6edf7";
const BODY = "#b6c2d6";
const PRIMARY = "#3ddc97";
const ACCENT = "#7aa2ff";

const SCHEMA_CODE = `import { z } from "zod";

// 一份 schema，同時是驗證規則，也是型別的來源
export const OrderInput = z.object({
  customerId: z.string().uuid(),
  items: z.array(z.object({
    sku: z.string().min(1),
    quantity: z.number().int().positive(),
  })).nonempty(),
  note: z.string().max(200).optional(),
});

export type OrderInput = z.infer<typeof OrderInput>;`;

const HANDLER_CODE = `type Result<T> =
  | { ok: true; data: T }
  | { ok: false; error: string };

// 錯誤也是型別的一部分：呼叫端一定要處理 ok === false
export function parseOrder(body: unknown): Result<OrderInput> {
  const parsed = OrderInput.safeParse(body);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "格式錯誤" };
  }
  return { ok: true, data: parsed.data };
}`;

function build(prefix: string) {
  const { node, section, columns2, stack, headline, text, button, form } = webinarTemplateKit(prefix);
  const primaryButton = { backgroundColor: PRIMARY, color: BG, borderRadius: 6 } as const;
  const card = { backgroundColor: SURFACE, borderColor: BORDER, borderWidth: 1, borderRadius: 6, padding: 28 } as const;
  const title = (id: string, eyebrow: string, value: string, subtitle = "") => stack(id, [
    text(`${id}_eyebrow`, eyebrow, undefined, { color: PRIMARY, fontSize: 15, letterSpacing: 1 }),
    headline(`${id}_text`, value, "h2", { color: INK, fontSize: 32 }, { tablet: { style: { fontSize: 30 } }, mobile: { style: { fontSize: 24 } } }),
    ...(subtitle ? [text(`${id}_subtitle`, subtitle, undefined, { color: BODY })] : []),
  ], 10);
  const listCard = (id: string, heading: string, items: string[]) => stack(id, [
    headline(`${id}_title`, heading, "h3", { color: INK, fontSize: 20 }),
    node(`${id}_list`, "bulleted_list", { items }, undefined, { color: BODY }),
  ], 14, card, { mobile: { style: { padding: 22 } } });

  return [
    // 1. 首屏：左文字＋右程式碼框（平板起上下堆疊，程式碼框只在框內水平捲動）。
    section("hero", [
      // H1 跨全寬（桌機 2 行）；下方左欄是說明與報名、右欄是程式碼框。
      text("hero_eyebrow", "// live coding · 120 min · free", undefined, { color: PRIMARY, fontSize: 15, letterSpacing: 1 }),
      headline("hero_title", "讓型別替你抓 bug：\n用 TypeScript 寫出好維護的 API", "h1", { fontSize: 46, lineHeight: 1.25, color: INK }, { tablet: { style: { fontSize: 40 } }, mobile: { style: { fontSize: 28, lineHeight: 1.35 }, props: { text: "讓型別替你抓 bug：\n用 TypeScript\n寫出好維護的 API" } } }),
      columns2("hero_columns", [
        text("hero_lead", "從零開始寫一個訂單 API，示範用型別描述資料、驗證輸入、處理錯誤，全程實機操作。", "lead", { color: BODY }),
        text("hero_tags", "TypeScript  ·  Node.js  ·  Zod  ·  REST", undefined, { color: ACCENT, fontSize: 15, letterSpacing: 1 }),
        node("hero_facts", "event_facts", { layout: "row", formatLabel: "線上直播", priceLabel: "免費", accentColor: PRIMARY }, undefined, { color: INK, padding: "16px 20px", borderColor: BORDER, borderWidth: 1, borderRadius: 6 }),
        button("hero_cta", "報名直播 →", "#register", { ...primaryButton, fontSize: 18 }),
      ], [
        node("hero_code", "code_snippet", { code: SCHEMA_CODE, language: "typescript", filename: "src/orders/schema.ts", showLineNumbers: true, showCopy: true }),
      ], { ratio: "1:1", stackOn: "tablet", gap: 56, align: "start" }),
    ], { background: BG, color: BODY, maxWidth: 1160, gap: 24, paddingY: 96, paddingYTablet: 64, paddingYMobile: 36, props: { backgroundImage: `${ART}/grid.svg`, backgroundPosition: "top" } }),
    // 2. 先備知識
    section("prereq", [
      title("prereq_title", "// prerequisites", "開始之前，你只需要這些"),
      node("prereq_columns", "columns_2", { ratio: "1:1", gap: 24 }, [
        listCard("prereq_need", "> 你需要", ["寫過 JavaScript（變數、函式、async/await）", "知道什麼是 HTTP API 與 JSON", "電腦已安裝 Node.js LTS 與編輯器"]),
        listCard("prereq_skip", "> 你不需要", ["TypeScript 經驗：從第一行型別講起", "資料庫：示範用記憶體儲存", "任何付費工具或雲端帳號"]),
      ]),
    ], { background: BG, color: BODY, maxWidth: 1160, gap: 36, paddingY: 80, paddingYTablet: 64, paddingYMobile: 48 }),
    // 3. 直播會寫什麼（議程＋時間碼）
    section("agenda", [
      title("agenda_title", "// agenda", "直播會寫什麼", "時間碼為開播後經過的時間。"),
      node("agenda_list", "agenda_timeline", { layout: "vertical", accentColor: PRIMARY, items: [
        { time: "00:00", title: "專案初始化", text: "建立 Node.js 專案、設定 tsconfig 與嚴格模式。", tag: "setup" },
        { time: "00:20", title: "定義型別與 schema", text: "用一份 schema 同時產生驗證規則與 TypeScript 型別。", tag: "types" },
        { time: "00:50", title: "輸入驗證與錯誤處理", text: "把錯誤變成回傳型別的一部分，讓呼叫端不會漏接。", tag: "errors" },
        { time: "01:20", title: "測試", text: "為成功與失敗兩條路徑寫測試，跑一次型別檢查。", tag: "test" },
        { time: "01:45", title: "Q&A", text: "回答直播留言與報名時收到的問題。", tag: "live" },
      ] }, undefined, { color: INK, width: "min(880px, 100%)" }),
    ], { background: SURFACE, color: BODY, maxWidth: 1160, gap: 36, paddingY: 80, paddingYTablet: 64, paddingYMobile: 48 }),
    // 4. 你會帶走（2×2）
    section("takeaways", [
      title("takeaways_title", "// takeaways", "直播結束後，你會帶走"),
      columns2("takeaways_columns", [
        node("takeaways_left", "icon_list", { layout: "list", numbered: false, accentColor: PRIMARY, items: [
          { icon: "book", title: "GitHub 範例 repo", text: "直播寫的每一行程式碼，依段落分好 commit。" },
          { icon: "check", title: "型別檢查清單", text: "上線前檢查 API 型別的 12 個項目。" },
        ] }, undefined, { color: INK }),
      ], [
        node("takeaways_right", "icon_list", { layout: "list", numbered: false, accentColor: PRIMARY, items: [
          { icon: "play", title: "完整錄影", text: "依主辦單位設定開放回放，可以跟著暫停實作。" },
          { icon: "message", title: "Q&A 整理", text: "直播中的問題與回答，整理成一份文件。" },
        ] }, undefined, { color: INK }),
      ], { ratio: "1:1", gap: 40 }),
    ], { background: BG, color: BODY, maxWidth: 1160, gap: 36, paddingY: 80, paddingYTablet: 64, paddingYMobile: 48 }),
    // 5. 程式碼預覽（第二段片段）
    section("preview", [
      title("preview_title", "// preview", "直播中會寫到的一段程式碼", "錯誤處理不靠 try/catch 到處包，而是讓型別逼你處理。"),
      node("preview_code", "code_snippet", { code: HANDLER_CODE, language: "typescript", filename: "src/orders/parse-order.ts", showLineNumbers: true, showCopy: true }, undefined, { width: "min(880px, 100%)" }),
    ], { background: BG, color: BODY, maxWidth: 1160, gap: 32, paddingY: 0, paddingYTablet: 0, paddingYMobile: 0 }),
    // 6. 講者
    section("speaker", [
      title("speaker_title", "// speaker", "講者"),
      node("speaker_card", "speaker_profiles", { layout: "featured", photoShape: "square", accentColor: ACCENT, items: [
        { photo: `${ART}/speaker.svg`, alt: "謝承恩的照片（請替換為講者照片）", name: "謝承恩", role: "資深後端工程師｜技術部落格「型別筆記」作者", tags: "TypeScript,API 設計,測試", bio: "寫後端十年，維護過每天上百萬次請求的訂單系統（範本示意經歷）。部落格專寫型別驅動開發，相信好的型別就是最不會過期的文件。", href: "https://github.com/", linkLabel: "GitHub／部落格" },
      ] }, undefined, { color: INK }),
    ], { background: BG, color: BODY, maxWidth: 1160, gap: 36, paddingY: 80, paddingYTablet: 64, paddingYMobile: 48 }),
    // 7. 報名表（極簡：Email＋姓名）
    section("register", [
      title("register_title", "// register", "報名直播", "免費參加。報名後寄送直播連結與範例 repo。"),
      form("register_form", {
        fields: [
          { name: "email", label: "Email", type: "email", placeholder: "you@example.com", required: true, helpText: "直播連結與 repo 會寄到這裡" },
          { name: "name", label: "姓名", placeholder: "怎麼稱呼你", required: true },
        ],
        submitLabel: "報名直播",
        submitStyle: { ...primaryButton, fontSize: 18 },
        note: "不寄行銷信。直播結束後只寄一封回放與資料連結。",
        htmlId: "register",
        style: { ...card, padding: 32, color: INK, width: "min(560px, 100%)" },
        mobile: { style: { padding: 16 } },
      }),
    ], { background: SURFACE, color: BODY, maxWidth: 1160, gap: 32, paddingY: 80, paddingYTablet: 64, paddingYMobile: 48 }),
    // 8. FAQ
    section("faq", [
      title("faq_title", "// faq", "常見問題"),
      node("faq_list", "faq", { items: [
        { question: "會提供 repo 嗎？", answer: "會。報名者會收到 GitHub 範例 repo，每個段落一個 commit，可以從任一段開始跟。" },
        { question: "需要 TypeScript 經驗嗎？", answer: "不需要。會寫 JavaScript 就跟得上，直播從第一個型別開始講。" },
        { question: "會錄影嗎？", answer: "會錄影；回放是否開放、開放多久，依主辦單位的設定。" },
        { question: "用什麼編輯器？", answer: "示範用 VS Code，但任何支援 TypeScript 的編輯器都可以。" },
      ] }, undefined, { color: BODY, width: "min(760px, 100%)" }),
    ], { background: BG, color: BODY, maxWidth: 1160, gap: 32, paddingY: 80, paddingYTablet: 64, paddingYMobile: 48 }),
  ];
}

export const template: WebinarTemplateDefinition = {
  id: "webinar-dev-tech",
  number: 18,
  name: "程式開發者技術講座",
  description: "深色編輯器風的技術講座報名頁：首屏就是程式碼框，先備知識、時間碼議程與程式碼預覽一目了然，表單只要 Email 與姓名。",
  category: "程式與技術",
  purposes: ["webinar"],
  styles: ["professional"],
  preview: { eyebrow: "Webinar", headline: "讓型別替你抓 bug：用 TypeScript 寫出好維護的 API", summary: "程式碼首屏＋時間碼議程", palette: [BG, PRIMARY, SURFACE], sectionCount: 8 },
  theme: { typography: { headingFont: "display-latin", bodyFont: "sans-tc", bodySize: 17, bodyLineHeight: 1.75, textColor: BODY, headingColor: INK, linkColor: ACCENT }, background: { color: BG } },
  settings: {
    eventTitle: "用 TypeScript 寫出好維護的 API：型別驅動開發實戰直播",
    stickyCta: { enabled: true, label: "報名直播", showDate: true, devices: "mobile_tablet", buttonColor: PRIMARY, buttonTextColor: BG, backgroundColor: SURFACE },
  },
  build,
};
