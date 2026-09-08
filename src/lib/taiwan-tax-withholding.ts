/** Taiwan affiliate payout tax snapshot. Every amount is an integer cent value. */
export const TAIWAN_AFFILIATE_TAX_RULE_VERSION = "tw-affiliate-2026-v1";
export const NHI_THRESHOLD_CENTS = 2_000_000;
export const WITHHOLDING_THRESHOLD_CENTS = 2_001_000;
export const DEFAULT_BANK_FEE_CENTS = 1_500;

export type TaiwanTaxWithholdingInput = { grossAmountCents: number; bankFeeCents?: number };
export type TaiwanTaxWithholdingResult = {
  grossAmountCents: number;
  withholdingTaxCents: number;
  nhiSupplementaryTaxCents: number;
  bankFeeCents: number;
  netPayoutAmountCents: number;
  ruleVersion: typeof TAIWAN_AFFILIATE_TAX_RULE_VERSION;
};

function assertCents(value: number, field: string) {
  if (!Number.isSafeInteger(value) || value < 0) throw new RangeError(`${field} must be a non-negative safe integer`);
}

/** Applies the approved policy and rounds each statutory deduction to whole NTD. */
export function calculateTaiwanTaxWithholding(input: TaiwanTaxWithholdingInput): TaiwanTaxWithholdingResult {
  const bankFeeCents = input.bankFeeCents ?? DEFAULT_BANK_FEE_CENTS;
  assertCents(input.grossAmountCents, "grossAmountCents");
  assertCents(bankFeeCents, "bankFeeCents");
  const grossNtd = input.grossAmountCents / 100;
  const withholdingTaxCents = input.grossAmountCents >= WITHHOLDING_THRESHOLD_CENTS ? Math.round(grossNtd * 0.1) * 100 : 0;
  const nhiSupplementaryTaxCents = input.grossAmountCents >= NHI_THRESHOLD_CENTS ? Math.round(grossNtd * 0.0211) * 100 : 0;
  const netPayoutAmountCents = input.grossAmountCents - withholdingTaxCents - nhiSupplementaryTaxCents - bankFeeCents;
  if (netPayoutAmountCents < 0) throw new RangeError("deductions exceed grossAmountCents");
  return { grossAmountCents: input.grossAmountCents, withholdingTaxCents, nhiSupplementaryTaxCents, bankFeeCents, netPayoutAmountCents, ruleVersion: TAIWAN_AFFILIATE_TAX_RULE_VERSION };
}

export const calculateTaiwanWithholding = calculateTaiwanTaxWithholding;
