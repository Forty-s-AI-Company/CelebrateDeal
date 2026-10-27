import { compileFunnelCustomCss } from "@/lib/funnel-custom-css";

/**
 * 「自訂程式碼」元件（沿用 `raw_html` 節點型別）與頁面自訂 CSS 的共用規則。
 *
 * 安全模型：商家的 HTML／CSS／JS 只在 `srcdoc` iframe 內、以不透明來源執行
 * （sandbox 絕不含 allow-same-origin、allow-top-navigation*、allow-forms、
 * allow-modals），所以碰不到平台網域的 Cookie、後台或其他租戶。沒有 JS 的
 * 節點維持原本「完全不執行腳本」的沙箱（sandbox=""）。
 *
 * 這個檔案只有純函式，伺服器（儲存、發布、緊急開關）與瀏覽器（渲染）共用。
 */

/** 每個欄位的 UTF-8 位元組上限；由伺服器端 schema 強制。 */
export const FUNNEL_CUSTOM_CODE_LIMITS = { html: 50_000, css: 20_000, js: 50_000 } as const;
export type FunnelCustomCodeField = keyof typeof FUNNEL_CUSTOM_CODE_LIMITS;
export const FUNNEL_CUSTOM_CODE_FIELDS = ["html", "css", "js"] as const satisfies readonly FunnelCustomCodeField[];

/** iframe 自動高度訊息。上下限之外的值一律忽略（不是夾住）。 */
export const FUNNEL_CUSTOM_CODE_HEIGHT_MESSAGE = "celebratedeal:custom-code-height";
export const FUNNEL_CUSTOM_CODE_MIN_HEIGHT = 0;
export const FUNNEL_CUSTOM_CODE_MAX_HEIGHT = 20_000;
export const FUNNEL_CUSTOM_CODE_DEFAULT_HEIGHT = 160;

export function utf8ByteLength(value: string): number {
  return new TextEncoder().encode(value).length;
}

export type FunnelCustomCode = { html: string; css: string; js: string };

function stringValue(value: unknown): string {
  return typeof value === "string" ? value : "";
}

/**
 * 只讀節點的「基礎」props：程式碼不支援桌機／手機覆寫，覆寫裡即使有同名欄位
 * 也不會被渲染。舊資料只有 `html`（更早期為 `content`）。
 */
export function funnelCustomCodeOf(props: Record<string, unknown>): FunnelCustomCode {
  return { html: stringValue(props.html) || stringValue(props.content), css: stringValue(props.css), js: stringValue(props.js) };
}

export function hasFunnelCustomScript(code: FunnelCustomCode): boolean {
  return code.js.trim().length > 0;
}

/** 渲染模式：static＝完全不執行腳本；script＝商家 JS 在不透明來源執行。 */
export type FunnelCustomCodeMode = "static" | "script";

/**
 * sandbox 屬性值。popups 只在公開頁（同時送出 COOP: same-origin）開啟，
 * 讓彈出的分頁與原頁面切斷 opener，避免 reverse tabnabbing。
 */
export function funnelCustomCodeSandbox(mode: FunnelCustomCodeMode, options: { popups?: boolean } = {}): string {
  if (mode === "static") return "";
  return options.popups ? "allow-scripts allow-popups allow-popups-to-escape-sandbox" : "allow-scripts";
}

/**
 * iframe 內的 meta CSP。srcdoc 會「另外」繼承父頁的 CSP（兩者都必須允許），
 * 這裡只會比父頁更嚴格：connect-src、form-action、base-uri、object-src 一律關閉。
 */
export function funnelCustomCodeCsp(mode: FunnelCustomCodeMode): string {
  return [
    "default-src 'none'",
    mode === "script" ? "script-src 'unsafe-inline' https:" : "script-src 'none'",
    "style-src 'unsafe-inline' https:",
    "img-src https: data:",
    "font-src https:",
    "media-src https:",
    "frame-src https:",
    "connect-src 'none'",
    "form-action 'none'",
    "base-uri 'none'",
    "object-src 'none'",
    "worker-src 'none'",
    "manifest-src 'none'",
  ].join("; ");
}

/**
 * 平台自己的高度回報腳本，放在商家程式碼之前。只送出一個數字；父頁另外
 * 驗證 event.source 與數值範圍，不信任這裡的任何內容。
 */
export const FUNNEL_CUSTOM_CODE_HEIGHT_REPORTER = `(function(){var p=window.parent,l=-1;function s(){var e=document.documentElement;if(!e)return;var h=Math.ceil(e.getBoundingClientRect().height);if(h===l)return;l=h;try{p.postMessage({type:${JSON.stringify(FUNNEL_CUSTOM_CODE_HEIGHT_MESSAGE)},height:h},"*")}catch(x){}}if(typeof ResizeObserver==="function"){new ResizeObserver(s).observe(document.documentElement)}document.addEventListener("DOMContentLoaded",s);window.addEventListener("load",s);s()})();`;

/**
 * 只改寫會讓 `<script>` 提早結束的 `</script`（大小寫不拘）為 `<\/script`。
 * 在字串、樣板字串、註解與 regex 字面值中 `\/` 都等於 `/`，語意不變；一般程式碼
 * 裡不可能合法出現 `</script`。
 *
 * 刻意不處理 `<!--`：HTML 的 script data 只有在 `<!--` 之後又出現 `<script`
 * 時才會進入「double escaped」狀態，讓這段腳本吃掉後面的內容；而把 `<script`
 * 改寫會破壞像 `i<scriptCount` 這種合法程式碼。這只會讓商家自己的腳本失效
 * （仍在沙箱內），不是安全問題；商家文件已說明請避免在字串中同時寫出這兩段。
 */
function scriptText(js: string): string {
  return js.replace(/<\/(script)/giu, String.raw`<\/$1`);
}

/**
 * 同理只改寫 `</style` 為 `<\/style`（CSS 中 `\/` 等於 `/`）；其他 `<`
 * （例如 `@media (width < 600px)`）維持原樣。
 */
function styleText(css: string): string {
  return css.replace(/<\/(style)/giu, String.raw`<\/$1`);
}

/**
 * 組出 iframe 的 srcdoc。static 模式的 HTML 由呼叫端先 sanitize；script 模式的
 * HTML 原樣放進不透明來源的沙箱。
 */
export function buildFunnelCustomCodeSrcDoc(code: { html: string; css: string; js: string }, mode: FunnelCustomCodeMode): string {
  const csp = funnelCustomCodeCsp(mode).replaceAll('"', "&quot;");
  const head = [
    `<meta http-equiv="Content-Security-Policy" content="${csp}">`,
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    "<style>html,body{margin:0}</style>",
    mode === "script" ? `<script>${FUNNEL_CUSTOM_CODE_HEIGHT_REPORTER}</script>` : "",
    code.css.trim() ? `<style>${styleText(code.css)}</style>` : "",
  ].join("");
  const script = mode === "script" && code.js.trim() ? `<script>${scriptText(code.js)}</script>` : "";
  return `<!doctype html><html><head>${head}</head><body>${code.html}${script}</body></html>`;
}

/**
 * 父頁收到 postMessage 時的資料驗證。呼叫端必須先確認
 * `event.source === iframe.contentWindow`（不要用 event.origin，它會是 "null"）。
 */
export function parseFunnelCustomCodeHeightMessage(data: unknown): number | null {
  if (!data || typeof data !== "object" || Array.isArray(data)) return null;
  const record = data as Record<string, unknown>;
  const keys = Object.keys(record);
  if (keys.length !== 2 || record.type !== FUNNEL_CUSTOM_CODE_HEIGHT_MESSAGE) return null;
  const height = record.height;
  if (typeof height !== "number" || !Number.isFinite(height)) return null;
  if (height < FUNNEL_CUSTOM_CODE_MIN_HEIGHT || height > FUNNEL_CUSTOM_CODE_MAX_HEIGHT) return null;
  return Math.ceil(height);
}

/** 緊急開關：`FUNNEL_CUSTOM_CODE_DISABLED` 為 "1" 或 "true" 時，公開頁不執行自訂 JS，也不套用頁面自訂 CSS。 */
export function isFunnelCustomCodeDisabled(env: Record<string, string | undefined> = process.env): boolean {
  const value = env.FUNNEL_CUSTOM_CODE_DISABLED?.trim().toLowerCase();
  return value === "1" || value === "true";
}

/* ---------- 走訪已儲存內容（單頁 PageDocument 或多步驟 FunnelStepPages） ---------- */

type NodeLike = { id?: unknown; type?: unknown; props?: unknown; children?: unknown };
type DocumentLike = { root?: unknown; popups?: unknown; settings?: unknown };

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

/** 回傳 [位置, 文件]；不是 PageDocument 結構（例如舊版內容）就沒有自訂程式碼。 */
function documentsOf(content: unknown): Array<[string, DocumentLike]> {
  const value = record(content);
  if (!value) return [];
  const pages = record(value.pages);
  if (pages && "flow" in value) return Object.entries(pages).flatMap(([stepId, page]) => record(page) ? [[`step:${stepId}`, page as DocumentLike] as [string, DocumentLike]] : []);
  if (Array.isArray(value.root) && record(value.settings)) return [["page", value as DocumentLike]];
  return [];
}

function forEachNode(nodes: unknown, visit: (node: NodeLike) => void, depth = 0) {
  if (!Array.isArray(nodes) || depth > 32) return;
  for (const candidate of nodes) {
    const node = record(candidate) as NodeLike | null;
    if (!node) continue;
    visit(node);
    forEachNode(node.children, visit, depth + 1);
  }
}

function forEachDocumentNode(document: DocumentLike, visit: (node: NodeLike) => void) {
  forEachNode(document.root, visit);
  if (Array.isArray(document.popups)) for (const popup of document.popups) forEachNode(record(popup)?.root, visit);
}

export type FunnelCustomCodeEntry = { location: string } & FunnelCustomCode;
export type FunnelPageCssEntry = { location: string; css: string };
export type FunnelCustomCodeInventory = { nodes: Map<string, FunnelCustomCodeEntry>; pageCss: Map<string, FunnelPageCssEntry> };

/** 收集內容中所有自訂程式碼節點與頁面自訂 CSS（空白的欄位視為沒有）。 */
export function collectFunnelCustomCode(content: unknown): FunnelCustomCodeInventory {
  const inventory: FunnelCustomCodeInventory = { nodes: new Map(), pageCss: new Map() };
  for (const [documentKey, document] of documentsOf(content)) {
    forEachDocumentNode(document, (node) => {
      if (node.type !== "raw_html" || typeof node.id !== "string") return;
      const code = funnelCustomCodeOf(record(node.props) ?? {});
      if (!code.html.trim() && !code.css.trim() && !code.js.trim()) return;
      const location = `${documentKey}/node:${node.id}`;
      inventory.nodes.set(location, { location, ...code });
    });
    const css = stringValue(record(document.settings)?.customCss);
    if (css.trim()) inventory.pageCss.set(documentKey, { location: `${documentKey}/page_css`, css });
  }
  return inventory;
}

export function contentHasCustomScript(content: unknown): boolean {
  return [...collectFunnelCustomCode(content).nodes.values()].some(hasFunnelCustomScript);
}

export function contentHasCustomCode(content: unknown): boolean {
  const inventory = collectFunnelCustomCode(content);
  return inventory.nodes.size > 0 || inventory.pageCss.size > 0;
}

export type FunnelCustomCodeChange = {
  location: string;
  kind: "node" | "page_css";
  change: "added" | "modified" | "removed";
  /** 變動的欄位名稱；不含程式碼本身。 */
  fields: Array<FunnelCustomCodeField>;
  /** 變動後每個欄位的 UTF-8 位元組數（移除時為 0）。 */
  bytes: Partial<Record<FunnelCustomCodeField, number>>;
  /** 這次變動後是否含有非空 JS（新增或修改了 JS）。 */
  scriptAddedOrChanged: boolean;
};

/** 比對新舊內容；只回傳位置、欄位與大小，絕不回傳程式碼。 */
export function diffFunnelCustomCode(previous: unknown, next: unknown): FunnelCustomCodeChange[] {
  const before = collectFunnelCustomCode(previous);
  const after = collectFunnelCustomCode(next);
  const changes: FunnelCustomCodeChange[] = [];
  for (const location of new Set([...before.nodes.keys(), ...after.nodes.keys()])) {
    const old = before.nodes.get(location);
    const current = after.nodes.get(location);
    const fields = FUNNEL_CUSTOM_CODE_FIELDS.filter((field) => (old?.[field] ?? "") !== (current?.[field] ?? ""));
    if (!fields.length) continue;
    changes.push({
      location,
      kind: "node",
      change: !old ? "added" : !current ? "removed" : "modified",
      fields,
      bytes: Object.fromEntries(FUNNEL_CUSTOM_CODE_FIELDS.map((field) => [field, utf8ByteLength(current?.[field] ?? "")])),
      scriptAddedOrChanged: fields.includes("js") && Boolean(current && hasFunnelCustomScript(current)),
    });
  }
  for (const key of new Set([...before.pageCss.keys(), ...after.pageCss.keys()])) {
    const old = before.pageCss.get(key);
    const current = after.pageCss.get(key);
    if ((old?.css ?? "") === (current?.css ?? "")) continue;
    changes.push({
      location: `${key}/page_css`, kind: "page_css", change: !old ? "added" : !current ? "removed" : "modified",
      fields: ["css"], bytes: { css: utf8ByteLength(current?.css ?? "") }, scriptAddedOrChanged: false,
    });
  }
  return changes.sort((left, right) => left.location.localeCompare(right.location));
}

/**
 * 緊急開關啟用時的公開內容：移除每個自訂程式碼節點的 JS（HTML／CSS 仍在
 * sandbox="" 內顯示，完全不執行腳本），並停用頁面自訂 CSS。不修改傳入物件。
 */
export function withoutFunnelCustomScripts<T>(content: T): T {
  const documents = documentsOf(content);
  if (!documents.length) return content;
  const copy = structuredClone(content);
  for (const [, document] of documentsOf(copy)) {
    forEachDocumentNode(document, (node) => {
      const props = record(node.props);
      if (node.type === "raw_html" && props && "js" in props) delete props.js;
    });
    const settings = record(document.settings);
    if (settings && "customCss" in settings) delete settings.customCss;
  }
  return copy;
}

/**
 * 內容未通過 schema 時，找出是否因為自訂程式碼（讓伺服器回傳明確原因）。
 * 只看結構，不信任內容；回傳 null 代表是其他原因。
 */
export function describeFunnelCustomCodeProblem(content: unknown): "css_invalid" | "too_large" | null {
  for (const [, document] of documentsOf(content)) {
    const css = record(document.settings)?.customCss;
    if (css !== undefined && !compileFunnelCustomCss(css).ok) return "css_invalid";
    let tooLarge = false;
    forEachDocumentNode(document, (node) => {
      if (node.type !== "raw_html") return;
      const props = record(node.props) ?? {};
      for (const field of FUNNEL_CUSTOM_CODE_FIELDS) {
        const value = props[field];
        if (typeof value === "string" && utf8ByteLength(value) > FUNNEL_CUSTOM_CODE_LIMITS[field]) tooLarge = true;
      }
    });
    if (tooLarge) return "too_large";
  }
  return null;
}

/** 單一頁面的摘要，用於公開頁的平台揭露。 */
export function documentCustomCodeSummary(document: unknown): { any: boolean; scripts: boolean } {
  const inventory = collectFunnelCustomCode(document);
  const scripts = [...inventory.nodes.values()].some(hasFunnelCustomScript);
  return { any: scripts || inventory.nodes.size > 0 || [...inventory.pageCss.values()].some((entry) => compileFunnelCustomCss(entry.css).ok), scripts };
}
