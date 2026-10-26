/**
 * Where a commission came from, derived only from the server-written
 * commission snapshot (`merchantLevel`, frozen `referralCode`).
 *
 * - `merchantLevel` 0 is the promoter whose code the order used; 1..N are the
 *   team uplines paid on that order. Legacy flat commissions leave it null and
 *   were always paid to the code holder, so null is treated as direct.
 * - For an upline row the frozen `referralCode` is the downline's public share
 *   code. It is the only downline detail exposed: no name, email, buyer, order
 *   number or commission base.
 */
export type AffiliateCommissionSource =
  | { kind: "direct" }
  | { kind: "upline"; level: number; referralCode: string | null };

export function affiliateCommissionSource(row: { merchantLevel: number | null; referralCode: string | null }): AffiliateCommissionSource {
  const level = row.merchantLevel;
  // The database constrains merchantLevel to 0..8; anything that is not a
  // positive integer is the direct promoter (or a legacy flat commission).
  if (level === null || !Number.isSafeInteger(level) || level <= 0) return { kind: "direct" };
  const referralCode = row.referralCode?.trim() || null;
  return { kind: "upline", level, referralCode };
}

/** Partner-facing label, e.g. 「團隊上線（第 1 層）· 來自 TESTP2」. */
export function formatAffiliateCommissionSource(source: AffiliateCommissionSource) {
  if (source.kind === "direct") return "直接推廣";
  const label = `團隊上線（第 ${source.level} 層）`;
  return source.referralCode ? `${label}· 來自 ${source.referralCode}` : label;
}

/** Merchant-facing level label: 「直接」 or 「第 N 層」. */
export function formatAffiliateCommissionLevel(merchantLevel: number | null) {
  const source = affiliateCommissionSource({ merchantLevel, referralCode: null });
  return source.kind === "direct" ? "直接" : `第 ${source.level} 層`;
}
