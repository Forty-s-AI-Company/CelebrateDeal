/**
 * F-049 (B03-15): strict parsing for finance amounts typed by platform admins.
 *
 * `Number.parseFloat` accepted "1e3" (NT$1,000), "12abc" (NT$12) and other
 * partial input, so a typo became a payout or refund amount. These parsers
 * accept only plain digits, optionally grouped with well-formed thousands
 * separators, and return integer cents or `null`.
 */
const WHOLE_YUAN = /^(-)?(\d{1,9}|\d{1,3}(?:,\d{3}){1,2})$/;
const YUAN_WITH_CENTS = /^(\d{1,9}|\d{1,3}(?:,\d{3}){1,2})(?:\.(\d{1,2}))?$/;

/** Whole New Taiwan dollars (no decimals), at most 999,999,999. */
export function parseWholeYuanToCents(raw: string, options: { allowNegative?: boolean } = {}) {
  const match = WHOLE_YUAN.exec(raw.trim());
  if (!match || (match[1] && !options.allowNegative)) return null;
  const yuan = Number(match[2]!.replaceAll(",", ""));
  const cents = yuan * 100;
  return match[1] && cents !== 0 ? -cents : cents;
}

/** Non-negative amount with at most two decimals (fee refunds may carry cents). */
export function parseYuanWithCentsToCents(raw: string) {
  const match = YUAN_WITH_CENTS.exec(raw.trim());
  if (!match) return null;
  const yuan = Number(match[1]!.replaceAll(",", ""));
  const fraction = (match[2] ?? "").padEnd(2, "0");
  return yuan * 100 + Number(fraction || "0");
}
