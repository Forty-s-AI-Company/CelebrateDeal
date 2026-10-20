/**
 * CelebrateDeal only charges, refunds and settles in New Taiwan Dollars.
 * PayUni UPP trades are whole TWD units, and settlement sums cents across
 * transactions, so any other currency would be charged or paid out at the
 * wrong value. Every money path must refuse a non-TWD amount instead of
 * reinterpreting it.
 */
export const SUPPORTED_CHECKOUT_CURRENCY = "TWD" as const;

export function isSupportedCheckoutCurrency(currency: unknown): currency is typeof SUPPORTED_CHECKOUT_CURRENCY {
  return currency === SUPPORTED_CHECKOUT_CURRENCY;
}

export class UnsupportedCurrencyError extends Error {
  readonly code = "unsupported_currency" as const;

  constructor(context: string) {
    super(`${context} only supports ${SUPPORTED_CHECKOUT_CURRENCY}.`);
    this.name = "UnsupportedCurrencyError";
  }
}
