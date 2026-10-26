/**
 * Where a commission came from, derived only from the server-written
 * commission snapshot (`merchantLevel`, frozen `referralCode`).
 *
 * - `merchantLevel` 0 is the promoter whose code the order used; 1..N are the
 *   team uplines paid on that order. Legacy flat commissions leave it null and
 *   were always paid to the code holder, so null is treated as direct.
 * - The frozen `referralCode` is the code the order was closed with, i.e. the
 *   level-0 promoter's code at the bottom of the chain. Only the level-1
 *   upline (that promoter's direct upline, who already sees them on the team
 *   page) receives it. Level 2+ uplines may not know that promoter and a code
 *   can contain a person's name, so the code is dropped here in the data layer
 *   rather than hidden in the UI.
 * - No other downline detail is exposed: no name, email, buyer, order number
 *   or commission base.
 */
export type AffiliateCommissionSource =
  | { kind: "direct" }
  | { kind: "upline"; level: number; referralCode: string | null };

export function affiliateCommissionSource(row: { merchantLevel: number | null; referralCode: string | null }): AffiliateCommissionSource {
  const level = row.merchantLevel;
  // The database constrains merchantLevel to 0..8; anything that is not a
  // positive integer is the direct promoter (or a legacy flat commission).
  if (level === null || !Number.isSafeInteger(level) || level <= 0) return { kind: "direct" };
  const referralCode = level === 1 ? row.referralCode?.trim() || null : null;
  return { kind: "upline", level, referralCode };
}

/** Partner-facing label: 「團隊上線（第 1 層）· 來自 TESTP2」 or 「團隊上線（第 2 層）」. */
export function formatAffiliateCommissionSource(source: AffiliateCommissionSource) {
  if (source.kind === "direct") return "直接推廣";
  const label = `團隊上線（第 ${source.level} 層）`;
  return source.level === 1 && source.referralCode ? `${label}· 來自 ${source.referralCode}` : label;
}

/** Merchant-facing level label: 「直接」 or 「第 N 層」. */
export function formatAffiliateCommissionLevel(merchantLevel: number | null) {
  const source = affiliateCommissionSource({ merchantLevel, referralCode: null });
  return source.kind === "direct" ? "直接" : `第 ${source.level} 層`;
}
