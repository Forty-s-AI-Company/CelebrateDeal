export function formatCurrency(cents: number, currency = "TWD") {
  return new Intl.NumberFormat("zh-TW", {
    style: "currency",
    currency,
    maximumFractionDigits: currency === "TWD" ? 0 : 2,
  }).format(cents / 100);
}

export function formatDateTime(date: Date | string) {
  return new Intl.DateTimeFormat("zh-TW", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(date));
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
