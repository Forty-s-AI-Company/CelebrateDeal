export function formatCurrency(cents: number, currency = "TWD") {
  return new Intl.NumberFormat("zh-TW", {
    style: "currency",
    currency,
    maximumFractionDigits: currency === "TWD" ? 0 : 2,
  }).format(cents / 100);
}

/** 全站預設顯示時區：台灣時間。伺服器元件在 Vercel 以 UTC 執行，不能依賴執行環境時區。 */
export const DEFAULT_DISPLAY_TIME_ZONE = "Asia/Taipei";

export function formatDateTime(date: Date | string, timeZone: string = DEFAULT_DISPLAY_TIME_ZONE) {
  return new Intl.DateTimeFormat("zh-TW", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone,
  }).format(new Date(date));
}

/** 使用者看得懂的時區名稱：Asia/Taipei 顯示為「台灣時間」，其他時區保留 IANA 名稱。 */
export function formatTimeZoneLabel(timeZone: string) {
  return timeZone === DEFAULT_DISPLAY_TIME_ZONE ? "台灣時間" : timeZone;
}

export function toSlug(input: string) {
  return input
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\u4e00-\u9fa5]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

/**
 * Route params arrive percent-encoded for non-ASCII path segments (a CJK slug
 * from toSlug() is `/form/%E5%A4%8F...`); slugs are stored decoded. toSlug()
 * never produces "%", so decoding is unambiguous; malformed input is kept as is
 * and simply matches nothing.
 */
export function decodeRouteSlug(value: string) {
  if (!value.includes("%")) return value;
  try { return decodeURIComponent(value); } catch { return value; }
}
