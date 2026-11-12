/**
 * 百分比（最多兩位小數）與整數 bps（萬分比）的共用換算。
 *
 * 1 bps = 0.01%，所以「最多兩位小數的百分比」與整數 bps 一一對應：換算全程用字串與整數運算，
 * 不經過浮點數（例如 0.29 * 100 = 28.999999999999996），也不四捨五入。不合法的輸入一律回報
 * `invalid`，由呼叫端以伺服器必定拒絕的值送出，不會被默默換成另一個合法比例。
 *
 * 規則與 `product-share-percent.ts`（PR #584）相同；差別是這裡不 trim 前後空白，讓換算結果
 * 與瀏覽器 `pattern` 完全一致（`pattern` 也不接受空白）。日後可以把商品表單一併改用這個檔案。
 */

/** 無法換算的輸入以這個前綴送出：`Number()` 會得到 NaN、百分比正規式也不會通過，伺服器一律拒絕。 */
export const INVALID_PERCENT_PREFIX = "invalid:";

/** 換算器能表示的最大 bps（整數部分三位、兩位小數：999.99%）。各欄位的實際上限由呼叫端另外檢查。 */
export const MAX_PARSABLE_BPS = 99_999;

/**
 * 百分比輸入框的原生 `pattern`（瀏覽器會自動加上 ^…$）。與 `parsePercentText` 接受的格式一致：
 * 整數部分最多三位有效數字（可帶前導零）、小數最多兩位，也接受 `.5`；科學記號、負數、逗號、
 * 全形數字與空白一律擋下。
 */
export const PERCENT_INPUT_PATTERN = "0*\\d{1,3}(\\.\\d{1,2})?|\\.\\d{1,2}";

const PERCENT_TEXT = /^(\d*)(?:\.(\d{1,2}))?$/u;

export type PercentParseResult =
  | { kind: "empty" }
  | { kind: "invalid" }
  | { kind: "ok"; bps: number };

/** 百分比文字 → bps。只接受 ASCII 數字（`\d` 不含全形數字）。 */
export function parsePercentText(text: string): PercentParseResult {
  if (text === "") return { kind: "empty" };
  const match = PERCENT_TEXT.exec(text);
  if (!match || (match[1] === "" && match[2] === undefined)) return { kind: "invalid" };
  const wholeDigits = (match[1] ?? "").replace(/^0+/u, "");
  if (wholeDigits.length > 3) return { kind: "invalid" };
  const whole = Number(wholeDigits || "0");
  const fraction = Number((match[2] ?? "").padEnd(2, "0"));
  return { kind: "ok", bps: whole * 100 + fraction };
}

/** bps → 最短的百分比文字（1050 → "10.5"、1005 → "10.05"、0 → "0"）。只接受 0 到 99999 的整數。 */
export function bpsToPercentText(bps: number): string {
  if (!Number.isSafeInteger(bps) || bps < 0 || bps > MAX_PARSABLE_BPS) throw new RangeError("bps 必須是 0 到 99999 的整數。");
  const whole = Math.floor(bps / 100);
  const fraction = bps % 100;
  if (fraction === 0) return String(whole);
  return `${whole}.${String(fraction).padStart(2, "0").replace(/0$/u, "")}`;
}

/**
 * 百分比文字 → 送給「收百分比字串」的伺服器欄位（例如聯盟政策的 `tierRate`）的值。
 * 合法 → 正規化後的百分比（`.5` → `0.5`、`0020` → `20`，與輸入的 bps 完全相同）；
 * 空白 → 空字串；其餘 → `invalid:` 加原文。超出欄位上限的合法格式照實送出，由伺服器回報範圍錯誤。
 */
export function percentTextToPercentWire(text: string): string {
  const parsed = parsePercentText(text);
  if (parsed.kind === "empty") return "";
  if (parsed.kind === "invalid") return `${INVALID_PERCENT_PREFIX}${text}`;
  return bpsToPercentText(parsed.bps);
}

/**
 * 百分比文字 → 送給「收整數 bps 字串」的伺服器欄位（例如聯盟夥伴的 `commissionRateBps`）的值。
 * 合法 → bps 整數字串；空白與其餘一律 `invalid:` 加原文。空白不能送空字串：
 * 有些伺服器端以 `Number("")` 解析，會得到合法的 0。
 */
export function percentTextToBpsWire(text: string): string {
  const parsed = parsePercentText(text);
  if (parsed.kind !== "ok") return `${INVALID_PERCENT_PREFIX}${text}`;
  return String(parsed.bps);
}
