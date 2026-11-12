/**
 * 課程推廣者分潤比例的「百分比」顯示層換算。
 *
 * 伺服器欄位 `coursePromoterShareBps` 與驗證（1 到 9999 的整數，萬分比）完全不變；
 * 表單只在顯示與輸入時改用百分比。1 bps = 0.01%，所以「最多兩位小數的百分比」與
 * 整數 bps 一一對應，換算不會四捨五入、也不會有精度損失：超過兩位小數的輸入不會被
 * 默默進位，而是以伺服器一定會拒絕的值送出，讓欄位顯示錯誤。
 * 換算全程用字串與整數運算，不經過浮點數（例如 0.29 * 100 = 28.999999999999996）。
 */

/** 無法換算的輸入以這個前綴送出（Number() 會得到 NaN，伺服器一律拒絕），並保留原文供重新顯示。 */
export const INVALID_SHARE_PREFIX = "invalid:";

export const SHARE_PERCENT_MIN = 0.01;
export const SHARE_PERCENT_MAX = 99.99;
export const SHARE_PERCENT_ERROR = "分潤比例須介於 0.01% 到 99.99%，最多兩位小數。";

const PERCENT_PATTERN = /^(\d*)(?:\.(\d{1,2}))?$/u;

/**
 * 百分比輸入框的原生 `pattern`（瀏覽器會自動加上 ^…$）。與 `percentTextToBps` 接受的格式一致：
 * 整數部分最多三位有效數字（可帶前導零）、小數最多兩位，也接受 `.5`；科學記號、負數、逗號一律擋下。
 */
export const SHARE_PERCENT_INPUT_PATTERN = "0*\\d{1,3}(\\.\\d{1,2})?|\\.\\d{1,2}";

/** 伺服器值（萬分比字串）→ 百分比輸入框的文字。 */
export function bpsToPercentText(bps: string): string {
  const text = bps.trim();
  if (text.startsWith(INVALID_SHARE_PREFIX)) return text.slice(INVALID_SHARE_PREFIX.length);
  if (!/^\d{1,9}$/u.test(text)) return text;
  const value = Number(text);
  const whole = Math.floor(value / 100);
  const fraction = value % 100;
  if (fraction === 0) return String(whole);
  return `${whole}.${String(fraction).padStart(2, "0").replace(/0$/u, "")}`;
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
  const match = PERCENT_PATTERN.exec(text);
  if (!match || (match[1] === "" && match[2] === undefined)) return `${INVALID_SHARE_PREFIX}${text}`;
  const wholeDigits = (match[1] ?? "").replace(/^0+/u, "");
  if (wholeDigits.length > 3) return `${INVALID_SHARE_PREFIX}${text}`;
  const whole = Number(wholeDigits || "0");
  const fraction = Number((match[2] ?? "").padEnd(2, "0"));
  return String(whole * 100 + fraction);
}
