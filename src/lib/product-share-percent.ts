/**
 * 課程推廣者分潤比例的「百分比」顯示層換算。
 *
 * 伺服器欄位 `coursePromoterShareBps` 與驗證（1 到 9999 的整數，萬分比）完全不變；
 * 表單只在顯示與輸入時改用百分比。1 bps = 0.01%，所以「最多兩位小數的百分比」與
 * 整數 bps 一一對應，換算不會四捨五入、也不會有精度損失：超過兩位小數的輸入不會被
 * 默默進位，而是以伺服器一定會拒絕的值送出，讓欄位顯示錯誤。
 * 換算核心（字串與整數運算，不經過浮點數）在 `percent-bps.ts`，與聯盟政策表單共用；
 * 這個檔案只保留商品表單的介面：先 trim、空白送空字串、伺服器原值是字串。
 */
import { bpsToPercentText as formatBps, INVALID_PERCENT_PREFIX, parsePercentText, PERCENT_INPUT_PATTERN } from "./percent-bps";

/** 無法換算的輸入以這個前綴送出（Number() 會得到 NaN，伺服器一律拒絕），並保留原文供重新顯示。 */
export const INVALID_SHARE_PREFIX = INVALID_PERCENT_PREFIX;

export const SHARE_PERCENT_MIN = 0.01;
export const SHARE_PERCENT_MAX = 99.99;
export const SHARE_PERCENT_ERROR = "分潤比例須介於 0.01% 到 99.99%，最多兩位小數。";

/**
 * 百分比輸入框的原生 `pattern`（瀏覽器會自動加上 ^…$）。與 `percentTextToBps` 接受的格式一致：
 * 整數部分最多三位有效數字（可帶前導零）、小數最多兩位，也接受 `.5`；科學記號、負數、逗號一律擋下。
 */
export const SHARE_PERCENT_INPUT_PATTERN = PERCENT_INPUT_PATTERN;

/** 伺服器值（萬分比字串）→ 百分比輸入框的文字。 */
export function bpsToPercentText(bps: string): string {
  const text = bps.trim();
  if (text.startsWith(INVALID_SHARE_PREFIX)) return text.slice(INVALID_SHARE_PREFIX.length);
  if (!/^\d{1,9}$/u.test(text)) return text;
  return formatBps(Number(text));
}

/**
 * 百分比輸入框的文字 → 要送給伺服器的萬分比字串。
 * 空白維持空白；格式正確的數字照整數換算並正規化（`.5` → 50、`0020` → 2000；超出 1–9999 的
 * 交給伺服器回報範圍錯誤）；其餘（三位以上小數、整數部分超過三位、負數、科學記號、非數字、
 * 只有小數點）一律回傳 `invalid:` 加原文。
 */
export function percentTextToBps(percent: string): string {
  const text = percent.trim();
  if (text === "") return "";
  const parsed = parsePercentText(text);
  return parsed.kind === "ok" ? String(parsed.bps) : `${INVALID_SHARE_PREFIX}${text}`;
}
