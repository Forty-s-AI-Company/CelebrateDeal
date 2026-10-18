// PayUni UPP credit-card trades accept whole TWD units within this inclusive
// range. Kept dependency-free so offer policy can refuse unpayable amounts
// before any credit, order or provider session is created.
export const PAYUNI_MIN_TRADE_AMOUNT = 1;
export const PAYUNI_MAX_CREDIT_TRADE_AMOUNT = 199_999;

/** True only for an amount PayUni can charge as one credit-card trade. */
export function isPayUniChargeableAmountCents(amountCents: number) {
  if (!Number.isSafeInteger(amountCents) || amountCents % 100 !== 0) return false;
  const amount = amountCents / 100;
  return amount >= PAYUNI_MIN_TRADE_AMOUNT && amount <= PAYUNI_MAX_CREDIT_TRADE_AMOUNT;
}
