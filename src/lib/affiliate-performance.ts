/**
 * Returns the percentage of recorded affiliate clicks that were converted.
 * A partner without clicks has a stable 0% conversion rate.
 */
export function calculateAffiliateConversionRate(clicks: number, conversions: number) {
  if (clicks <= 0) return 0;

  return Math.round((conversions / clicks) * 1000) / 10;
}
