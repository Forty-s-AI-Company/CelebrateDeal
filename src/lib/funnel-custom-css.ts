/**
 * 頁面自訂 CSS 的保守編譯器。
 *
 * 商家寫的 CSS 只能作用在頁面內容容器（`[data-funnel-content]`）之內：每個
 * 選擇器都加上範圍前綴，`html`／`body`／`:root` 改寫成容器本身；平台必須
 * 顯示的元素（腳本揭露、政策連結）放在容器外，所以選不到。
 *
 * 這不是完整的 CSS 解析器，而是刻意保守的子集：解析不確定就拒絕，並回傳
 * 商家看得懂的錯誤訊息。儲存時（schema）與渲染時都會重新編譯同一份原始碼，
 * 所以只會渲染通過這裡驗證的輸出。
 */

export const FUNNEL_CUSTOM_CSS_SCOPE = "[data-funnel-content]";
export const FUNNEL_PAGE_CUSTOM_CSS_MAX_BYTES = 20_000;
/** 商家 @keyframes 名稱一律加上前綴，避免覆寫平台同名動畫。 */
export const FUNNEL_CUSTOM_KEYFRAMES_PREFIX = "cdm-";
/**
 * 商家 @font-face 的字型名稱也一律加上前綴（並同步改寫 font-family／font 中的
 * 引用），讓商家字型無法接管平台字型堆疊（例如 "Segoe UI"、"Noto Sans TC"）。
 */
export const FUNNEL_CUSTOM_FONT_PREFIX = "cdm-";

const MAX_RULES = 2_000;
const MAX_NESTING = 3;
const BLOCKED_PROPERTIES = new Set(["behavior", "-ms-behavior", "-moz-binding", "-webkit-binding"]);
const GENERIC_FONT_FAMILIES = new Set([
  "serif", "sans-serif", "monospace", "cursive", "fantasy", "system-ui", "ui-serif", "ui-sans-serif",
  "ui-monospace", "ui-rounded", "emoji", "math", "fangsong", "inherit", "initial", "unset", "revert", "revert-layer", "default",
]);
const FONT_FACE_PROPERTIES = new Set([
  "font-family", "src", "font-style", "font-weight", "font-display", "font-stretch", "unicode-range", "size-adjust",
  "ascent-override", "descent-override", "line-gap-override", "font-feature-settings", "font-variation-settings",
]);
/** 這些函式會把字串當成網址載入（或不在支援範圍），一律拒絕；網址只能用 url(https://…)。 */
const BLOCKED_FUNCTIONS = /(?:^|[^\w-])((?:-webkit-|-moz-)?(?:image-set|image|cross-fade|element|src|paint|expression))\s*\(/iu;

export type FunnelCustomCssResult = { ok: true; css: string } | { ok: false; error: string };

class CssRejected extends Error {}

function reject(message: string): never {
  throw new CssRejected(message);
}

function snippet(value: string): string {
  const compact = value.replace(/\s+/gu, " ").trim();
  return compact.length > 40 ? `${compact.slice(0, 40)}…` : compact;
}

function utf8Length(value: string): number {
  return new TextEncoder().encode(value).length;
}

/** 去除註解；字串內的 `/*` 不算註解。沒有反斜線，所以字串一定在下一個同樣的引號結束。 */
function stripComments(source: string): string {
  let output = "";
  for (let index = 0; index < source.length;) {
    const char = source[index]!;
    if (char === '"' || char === "'") {
      const end = source.indexOf(char, index + 1);
      if (end < 0) reject("有未結束的字串（缺少對應的引號）。");
      const text = source.slice(index, end + 1);
      if (/[\r\n]/u.test(text)) reject("字串不可跨行。");
      output += text;
      index = end + 1;
    } else if (char === "/" && source[index + 1] === "*") {
      const end = source.indexOf("*/", index + 2);
      if (end < 0) reject("有未結束的註解（缺少 */）。");
      output += " ";
      index = end + 2;
    } else {
      output += char;
      index += 1;
    }
  }
  return output;
}

/** 在深度 0 依分隔字元切開（略過字串、括號與中括號內的內容）。 */
function splitTopLevel(text: string, separator: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let start = 0;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index]!;
    if (char === '"' || char === "'") { index = text.indexOf(char, index + 1); if (index < 0) reject("有未結束的字串。"); continue; }
    if (char === "(" || char === "[") depth += 1;
    else if (char === ")" || char === "]") { depth -= 1; if (depth < 0) reject("括號不成對。"); }
    else if (char === separator && depth === 0) { parts.push(text.slice(start, index)); start = index + 1; }
  }
  if (depth !== 0) reject("括號不成對。");
  parts.push(text.slice(start));
  return parts;
}

type Cursor = { text: string; index: number };

/** 讀到深度 0 的 `{` 或 `;` 為止，回傳前面的內容與結束字元。 */
function readPrelude(cursor: Cursor): { prelude: string; terminator: "{" | ";" | "" } {
  const { text } = cursor;
  let depth = 0;
  const start = cursor.index;
  for (; cursor.index < text.length; cursor.index += 1) {
    const char = text[cursor.index]!;
    if (char === '"' || char === "'") { const end = text.indexOf(char, cursor.index + 1); if (end < 0) reject("有未結束的字串。"); cursor.index = end; continue; }
    if (char === "(" || char === "[") depth += 1;
    else if (char === ")" || char === "]") { depth -= 1; if (depth < 0) reject("括號不成對。"); }
    else if (char === "}" && depth === 0) reject(`多了一個「}」：${snippet(text.slice(start, cursor.index + 1))}`);
    else if ((char === "{" || char === ";") && depth === 0) {
      const prelude = text.slice(start, cursor.index);
      cursor.index += 1;
      return { prelude, terminator: char };
    }
  }
  return { prelude: text.slice(start), terminator: "" };
}

/** 從 `{` 之後讀到對應的 `}`，回傳區塊內容。 */
function readBlock(cursor: Cursor): string {
  const { text } = cursor;
  let depth = 1;
  const start = cursor.index;
  for (; cursor.index < text.length; cursor.index += 1) {
    const char = text[cursor.index]!;
    if (char === '"' || char === "'") { const end = text.indexOf(char, cursor.index + 1); if (end < 0) reject("有未結束的字串。"); cursor.index = end; continue; }
    if (char === "{") depth += 1;
    else if (char === "}") {
      depth -= 1;
      if (depth === 0) {
        const block = text.slice(start, cursor.index);
        cursor.index += 1;
        return block;
      }
    }
  }
  reject("有未結束的區塊（缺少「}」）。");
}

const SELECTOR_CHARACTERS = /^[\p{L}\p{N}\s.#:[\]=()*>+~,"'^$|_-]+$/u;
const ROOT_COMPOUND = /^(?:html|body|:root)(?![\w-])/iu;

/** 把一個複合選擇器切成「複合選擇器、組合子、複合選擇器…」。 */
function splitCompounds(selector: string): Array<{ combinator: " " | ">" | "+" | "~"; compound: string }> {
  const result: Array<{ combinator: " " | ">" | "+" | "~"; compound: string }> = [];
  let depth = 0;
  let current = "";
  let combinator: " " | ">" | "+" | "~" | null = null;
  const flush = () => {
    if (!current) return;
    if (result.length === 0 && combinator !== null && combinator !== " ") reject(`選擇器不可以組合子開頭：${snippet(selector)}`);
    result.push({ combinator: result.length === 0 ? " " : combinator ?? " ", compound: current });
    current = "";
    combinator = null;
  };
  for (let index = 0; index < selector.length; index += 1) {
    const char = selector[index]!;
    if (char === '"' || char === "'") {
      const end = selector.indexOf(char, index + 1);
      if (end < 0) reject("有未結束的字串。");
      current += selector.slice(index, end + 1);
      index = end;
      continue;
    }
    if (char === "(" || char === "[") depth += 1;
    if (char === ")" || char === "]") depth -= 1;
    if (depth === 0 && (/\s/u.test(char) || char === ">" || char === "+" || char === "~")) {
      if (current) flush();
      if (char !== " " && !/\s/u.test(char)) {
        if (combinator !== null && combinator !== " ") reject(`選擇器的組合子重複：${snippet(selector)}`);
        combinator = char as ">" | "+" | "~";
      } else if (combinator === null) combinator = " ";
      continue;
    }
    current += char;
  }
  if (!current && combinator !== null && combinator !== " ") reject(`選擇器不可以組合子結尾：${snippet(selector)}`);
  flush();
  return result;
}

function joinCompounds(parts: Array<{ combinator: " " | ">" | "+" | "~"; compound: string }>): string {
  return parts.map((part, index) => index === 0 ? part.compound : `${part.combinator === " " ? " " : ` ${part.combinator} `}${part.compound}`).join("");
}

function scopeSelector(selector: string): string {
  const trimmed = selector.trim();
  if (!trimmed) reject("有空白的選擇器（例如多了一個逗號）。");
  if (!SELECTOR_CHARACTERS.test(trimmed)) reject(`選擇器含有不支援的字元：${snippet(trimmed)}`);
  // 屬性選擇器讀取欄位值可被用來竊取輸入內容；nonce 也不應被選取。
  if (/\[\s*(?:[\w*-]*\|)?\s*(?:value|nonce)\s*[\]~|^$*=]/iu.test(trimmed)) reject(`不可使用 [value] 或 [nonce] 屬性選擇器：${snippet(trimmed)}`);
  const parts = splitCompounds(trimmed);
  let rootCount = 0;
  while (rootCount < parts.length && ROOT_COMPOUND.test(parts[rootCount]!.compound)) {
    if (rootCount > 0 && parts[rootCount]!.combinator !== " " && parts[rootCount]!.combinator !== ">") reject(`html／body 之間只能用空白或 > 連接：${snippet(trimmed)}`);
    rootCount += 1;
  }
  if (parts.slice(rootCount).some((part) => ROOT_COMPOUND.test(part.compound))) reject(`html、body、:root 只能放在選擇器開頭：${snippet(trimmed)}`);
  if (rootCount === 0) return `${FUNNEL_CUSTOM_CSS_SCOPE} ${joinCompounds(parts)}`;
  const container = FUNNEL_CUSTOM_CSS_SCOPE + parts.slice(0, rootCount).map((part) => part.compound.replace(ROOT_COMPOUND, "")).join("");
  const rest = parts.slice(rootCount);
  if (rest[0] && (rest[0].combinator === "+" || rest[0].combinator === "~")) reject(`不可選取頁面內容以外的相鄰元素：${snippet(trimmed)}`);
  return rest.length ? `${container}${rest[0]!.combinator === ">" ? " > " : " "}${joinCompounds(rest)}` : container;
}

function scopeSelectorList(prelude: string): string {
  return splitTopLevel(prelude, ",").map(scopeSelector).join(",");
}

/** 檢查 url()：只允許 https 絕對網址，不接受 data:、javascript: 或相對路徑。 */
function checkUrls(value: string) {
  const pattern = /url\s*\(/giu;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(value)) !== null) {
    const start = match.index + match[0].length;
    const end = value.indexOf(")", start);
    if (end < 0) reject("url( 缺少右括號。");
    let argument = value.slice(start, end).trim();
    if ((argument.startsWith('"') && argument.endsWith('"')) || (argument.startsWith("'") && argument.endsWith("'"))) argument = argument.slice(1, -1);
    if (!/^https:\/\/[^\s"'()]+$/iu.test(argument)) reject(`url() 只允許 https:// 開頭的完整網址：${snippet(match[0] + argument + ")")}`);
  }
}

type DeclarationContext = { kind: "rule" } | { kind: "font-face" } | { kind: "keyframe" };
/** 這份 CSS 自己宣告的 @keyframes 名稱與 @font-face 字型名稱（小寫→原樣）。 */
type CustomNames = { keyframes: ReadonlySet<string>; fonts: ReadonlyMap<string, string> };

const FONT_FAMILY_NAME = /^[\p{L}\p{N} _-]{1,64}$/u;

function unquote(value: string): string {
  const trimmed = value.trim();
  return /^(["']).*\1$/u.test(trimmed) ? trimmed.slice(1, -1) : trimmed;
}

function prefixedFont(name: string): string {
  return `"${FUNNEL_CUSTOM_FONT_PREFIX}${name}"`;
}

/** font-family 清單：完全等於自己宣告的字型名稱的項目才改寫；通用字型與其他名稱不變。 */
function renameFontFamilies(value: string, fonts: ReadonlyMap<string, string>): string {
  if (!fonts.size) return value;
  let changed = false;
  const items = splitTopLevel(value, ",").map((item) => {
    const declared = fonts.get(unquote(item).replace(/\s+/gu, " ").toLowerCase());
    if (!declared) return item.trim();
    changed = true;
    return prefixedFont(declared);
  });
  return changed ? items.join(",") : value;
}

/** font 簡寫：字型清單在最後；第一段的尾端可能是自己宣告的名稱（引號或不加引號）。 */
function renameFontShorthand(value: string, fonts: ReadonlyMap<string, string>): string {
  if (!fonts.size) return value;
  const [first = "", ...rest] = splitTopLevel(value, ",");
  let head = first.trim();
  for (const [lower, declared] of fonts) {
    // Names are limited to letters, digits, spaces, _ and - (FONT_FAMILY_NAME), so they need no regex escaping.
    const tail = new RegExp(String.raw`(^|\s)(["']?)${lower}\2\s*$`, "iu");
    if (tail.test(head)) { head = head.replace(tail, (_match, space: string) => `${space}${prefixedFont(declared)}`); break; }
  }
  return [head, ...(rest.length ? [renameFontFamilies(rest.join(","), fonts)] : [])].join(",");
}

function renameKeyframes(value: string, names: ReadonlySet<string>): string {
  if (!names.size) return value;
  return value.replace(/-?[A-Za-z_][\w-]*/gu, (token, offset: number, whole: string) => {
    const before = offset > 0 ? whole[offset - 1] : "";
    // 函式名稱（例如 steps(…)）或其他字詞的一部分不改。
    if (before && /[\w-]/u.test(before)) return token;
    if (whole[offset + token.length] === "(") return token;
    return names.has(token) ? `${FUNNEL_CUSTOM_KEYFRAMES_PREFIX}${token}` : token;
  });
}

function compileDeclarations(block: string, context: DeclarationContext, names: CustomNames): string {
  const output: string[] = [];
  for (const raw of splitTopLevel(block, ";")) {
    const declaration = raw.trim();
    if (!declaration) continue;
    if (/[{}]/u.test(declaration)) reject(`不支援巢狀規則：${snippet(declaration)}`);
    const match = /^(--[\w-]+|-?[A-Za-z_][\w-]*)\s*:([\s\S]*)$/u.exec(declaration);
    if (!match) reject(`無法解析這個宣告（應為「屬性: 值」）：${snippet(declaration)}`);
    const property = match[1]!.startsWith("--") ? match[1]! : match[1]!.toLowerCase();
    let value = match[2]!.trim();
    if (!value) reject(`「${property}」沒有值。`);
    if (BLOCKED_PROPERTIES.has(property)) reject(`不允許使用 ${property}。`);
    if (context.kind === "font-face" && !FONT_FACE_PROPERTIES.has(property)) reject(`@font-face 內不支援 ${property}。`);
    const lower = value.toLowerCase();
    if (/(?:javascript|vbscript)\s*:/u.test(lower)) reject(`不允許 javascript: 網址：${snippet(declaration)}`);
    const blocked = BLOCKED_FUNCTIONS.exec(value);
    if (blocked) reject(`不支援 ${blocked[1]!.toLowerCase()}()；圖片與字型請使用 url(https://…)。`);
    checkUrls(value);
    if (context.kind === "font-face" && property === "font-family") {
      const family = unquote(value).replace(/\s+/gu, " ").trim();
      if (!family || GENERIC_FONT_FAMILIES.has(family.toLowerCase())) reject(`@font-face 不可使用通用字型名稱「${family || value}」，請改用自己的字型名稱。`);
      if (!FONT_FAMILY_NAME.test(family)) reject(`@font-face 的字型名稱只能使用文字、數字、空白、底線與連字號：${snippet(family)}`);
      value = prefixedFont(family);
    } else if (property === "font-family") value = renameFontFamilies(value, names.fonts);
    else if (property === "font") value = renameFontShorthand(value, names.fonts);
    if (context.kind === "font-face" && property === "src" && !/url\s*\(|local\s*\(/iu.test(value)) reject("@font-face 的 src 必須使用 url(https://…) 或 local(…)。");
    if (property === "animation" || property === "animation-name") value = renameKeyframes(value, names.keyframes);
    output.push(`${property}:${value}`);
  }
  return output.join(";");
}

function compileKeyframes(block: string, names: CustomNames): string {
  const cursor: Cursor = { text: block, index: 0 };
  const frames: string[] = [];
  while (cursor.index < block.length) {
    if (!block.slice(cursor.index).trim()) break;
    const { prelude, terminator } = readPrelude(cursor);
    if (terminator !== "{") reject(`@keyframes 內的格式不正確：${snippet(prelude)}`);
    const selectors = splitTopLevel(prelude, ",").map((part) => part.trim().toLowerCase());
    if (!selectors.every((selector) => /^(?:from|to|\d{1,3}(?:\.\d+)?%)$/u.test(selector))) reject(`@keyframes 只接受 from、to 或百分比：${snippet(prelude)}`);
    frames.push(`${selectors.join(",")}{${compileDeclarations(readBlock(cursor), { kind: "keyframe" }, names)}}`);
  }
  return frames.join("");
}

type CompileState = { rules: number; names: CustomNames };

function compileRuleList(text: string, depth: number, state: CompileState): string {
  const cursor: Cursor = { text, index: 0 };
  const output: string[] = [];
  while (cursor.index < text.length) {
    while (cursor.index < text.length && /\s/u.test(text[cursor.index]!)) cursor.index += 1;
    if (cursor.index >= text.length) break;
    state.rules += 1;
    if (state.rules > MAX_RULES) reject(`規則數量超過 ${MAX_RULES} 條。`);
    if (text[cursor.index] === "@") {
      const nameMatch = /^@(-?[A-Za-z][\w-]*)/u.exec(text.slice(cursor.index));
      if (!nameMatch) reject("無法辨識的 @ 規則。");
      const name = nameMatch[1]!.toLowerCase();
      cursor.index += nameMatch[0].length;
      const { prelude, terminator } = readPrelude(cursor);
      if (name === "import") reject("不允許 @import；請把樣式直接寫在這裡。");
      if (name === "media" || name === "supports") {
        if (terminator !== "{") reject(`@${name} 缺少「{」。`);
        if (depth >= MAX_NESTING) reject(`@${name} 巢狀層數過多。`);
        const condition = prelude.trim();
        if (!condition || !/^[A-Za-z0-9\s(),:.%>=+*/_-]+$/u.test(condition) || /url\s*\(/iu.test(condition)) reject(`@${name} 的條件含有不支援的內容：${snippet(condition)}`);
        output.push(`@${name} ${condition.replace(/\s+/gu, " ")}{${compileRuleList(readBlock(cursor), depth + 1, state)}}`);
        continue;
      }
      if (name === "font-face") {
        if (depth > 0) reject("@font-face 只能放在最外層。");
        if (terminator !== "{" || prelude.trim()) reject("@font-face 格式不正確。");
        const declarations = compileDeclarations(readBlock(cursor), { kind: "font-face" }, state.names);
        if (!/(?:^|;)font-family:/u.test(declarations) || !/(?:^|;)src:/u.test(declarations)) reject("@font-face 必須同時設定 font-family 與 src。");
        output.push(`@font-face{${declarations}}`);
        continue;
      }
      if (name === "keyframes" || name === "-webkit-keyframes") {
        if (depth > 0) reject("@keyframes 只能放在最外層。");
        const keyframeName = prelude.trim();
        if (terminator !== "{" || !/^-?[A-Za-z_][\w-]*$/u.test(keyframeName)) reject(`@keyframes 名稱只能使用英數、底線與連字號：${snippet(keyframeName)}`);
        output.push(`@${name} ${FUNNEL_CUSTOM_KEYFRAMES_PREFIX}${keyframeName}{${compileKeyframes(readBlock(cursor), state.names)}}`);
        continue;
      }
      reject(`不支援 @${name}；只允許 @media、@supports、@font-face 與 @keyframes。`);
    }
    const { prelude, terminator } = readPrelude(cursor);
    if (terminator !== "{") reject(`規則缺少「{」：${snippet(prelude)}`);
    const selector = scopeSelectorList(prelude);
    output.push(`${selector}{${compileDeclarations(readBlock(cursor), { kind: "rule" }, state.names)}}`);
  }
  return output.join("\n");
}

/**
 * 驗證並加上範圍前綴。輸出永遠不含 `<`、反斜線或 @import，可直接放進
 * `<style>`；空白輸入回傳空字串。
 */
export function compileFunnelCustomCss(source: unknown): FunnelCustomCssResult {
  if (typeof source !== "string") return { ok: false, error: "自訂 CSS 必須是文字。" };
  if (!source.trim()) return { ok: true, css: "" };
  try {
    if (utf8Length(source) > FUNNEL_PAGE_CUSTOM_CSS_MAX_BYTES) reject(`自訂 CSS 超過 ${FUNNEL_PAGE_CUSTOM_CSS_MAX_BYTES / 1000} KB 上限。`);
    if (source.includes("\\")) reject("不支援反斜線（\\）跳脫字元，請直接輸入字元。");
    if (source.includes("<")) reject("不可包含「<」字元（例如 </style>）。");
    if (/[\u0000-\u0008\u000b\u000e-\u001f\u007f]/u.test(source)) reject("含有不可見的控制字元。");
    const text = stripComments(source);
    const keyframes = new Set([...text.matchAll(/@(?:-webkit-)?keyframes\s+(-?[A-Za-z_][\w-]*)/giu)].map((match) => match[1]!));
    const fonts = new Map<string, string>();
    for (const block of text.matchAll(/@font-face\s*\{([^}]*)\}/giu)) {
      const family = /(?:^|;)\s*font-family\s*:\s*([^;]+)/iu.exec(block[1]!)?.[1];
      const name = family ? unquote(family).replace(/\s+/gu, " ").trim() : "";
      if (FONT_FAMILY_NAME.test(name) && !GENERIC_FONT_FAMILIES.has(name.toLowerCase())) fonts.set(name.toLowerCase(), name);
    }
    const css = compileRuleList(text, 0, { rules: 0, names: { keyframes, fonts } });
    // 最後一道防線：輸出不可能含有這些字元，若有就是編譯器的錯誤，直接拒絕。
    if (/[<\\]/u.test(css) || /@import/iu.test(css)) reject("無法安全處理這段 CSS。");
    return { ok: true, css };
  } catch (error) {
    if (error instanceof CssRejected) return { ok: false, error: error.message };
    return { ok: false, error: "無法解析這段 CSS。" };
  }
}
