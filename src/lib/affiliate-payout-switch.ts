/**
 * F-052: platform-level switch that stops every merchant from recording an
 * affiliate payout as paid, or exporting payee bank data for a transfer,
 * regardless of the merchant's own payout policy. The closed beta sets it so
 * affiliate commissions only accrue and are never paid out.
 *
 * `AFFILIATE_PAYOUTS_DISABLED`:
 * - unset, empty, `false` or `0`: payouts follow the normal merchant rules;
 * - any other value (for example `true`): payouts are disabled. Unknown
 *   values fail closed so a typo never re-enables payouts.
 *
 * Pure module: safe for Server Actions, route handlers, libraries and pages.
 */
export const AFFILIATE_PAYOUTS_DISABLED_ENV = "AFFILIATE_PAYOUTS_DISABLED";

export const AFFILIATE_PAYOUTS_DISABLED_MESSAGE = "平台目前暫停聯盟出款：封測期間佣金只累計、不出款，因此無法標記已付款或匯出提領資料。";

export class AffiliatePayoutsDisabledError extends Error {
  readonly code = "affiliate_payouts_disabled" as const;

  constructor() {
    super("Affiliate payouts are disabled by the platform.");
    this.name = "AffiliatePayoutsDisabledError";
  }
}

export function affiliatePayoutsDisabled(env: Record<string, string | undefined> = process.env) {
  const value = env[AFFILIATE_PAYOUTS_DISABLED_ENV]?.trim().toLowerCase();
  return Boolean(value) && value !== "false" && value !== "0";
}

/** Throws before any payout write or bank-data export while the switch is on. */
export function assertAffiliatePayoutsEnabled(env?: Record<string, string | undefined>) {
  if (affiliatePayoutsDisabled(env)) throw new AffiliatePayoutsDisabledError();
}
