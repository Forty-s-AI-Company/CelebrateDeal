import { z } from "zod";

export const AFFILIATE_REMUNERATION_RULE_VERSION = "tw-affiliate-20261007-v2";
export class AffiliateRemunerationInputError extends Error {}
const Cents = z.number().int().min(0).max(2_147_483_647);
const Reference = z.string().trim().regex(/^[A-Za-z0-9_-]{1,160}$/u);

const Input = z.object({
  grossAmountCents: Cents,
  // The fee is selected from the server's payment policy, not a form amount.
  bankFeeCents: Cents,
  recipientType: z.enum(["resident_individual", "nonresident_individual", "domestic_invoice_business"]),
  nhiTreatment: z.enum(["subject_execution_business", "documented_exemption", "not_insured", "not_applicable_business"]),
  exemptionReference: Reference.optional(),
  invoiceReference: Reference.optional(),
}).strict();

export type AffiliateRemunerationInput = z.infer<typeof Input>;
export type AffiliateRemunerationQuote = {
  grossAmountCents: number;
  withholdingTaxCents: number;
  nhiSupplementaryTaxCents: number;
  bankFeeCents: number;
  netPayoutAmountCents: number;
  ruleVersion: typeof AFFILIATE_REMUNERATION_RULE_VERSION;
};

export function validateAffiliateRecipientClassification(raw: unknown) {
  const input = Input.omit({ grossAmountCents: true, bankFeeCents: true }).parse(raw);
  if (input.recipientType === "domestic_invoice_business") {
    if (!input.invoiceReference || input.nhiTreatment !== "not_applicable_business") throw new AffiliateRemunerationInputError("An approved invoice business classification is required.");
    return;
  }
  if (input.nhiTreatment === "not_applicable_business") throw new AffiliateRemunerationInputError("An individual cannot use the business exemption.");
  if (["documented_exemption", "not_insured"].includes(input.nhiTreatment) && !input.exemptionReference) throw new AffiliateRemunerationInputError("An approved exemption reference is required.");
  if (input.invoiceReference) throw new AffiliateRemunerationInputError("An individual cannot use an invoice business reference.");
}

/** Tax is collected in whole NTD, with sub-dollar amounts discarded. BigInt
 * keeps the threshold and multiplication exact, including fractional NTD. */
function incomeTaxCents(grossCents: number, rateBps: number, resident: boolean) {
  const wholeNtd = BigInt(grossCents) * BigInt(rateBps) / BigInt(1_000_000);
  return resident && wholeNtd <= BigInt(2_000) ? 0 : Number(wholeNtd) * 100;
}

/** Consumes an approved server-side recipient classification. An unreviewed
 * browser declaration is not evidence of residency, an invoice or exemption.
 * This is a quote, never a provider transfer or an accounting ledger entry.
 *
 * Rules verified against official sources on 2026-10-07:
 * https://www.etax.nat.gov.tw/etwmain/tax-info/innotative-tax-e-reference/withheld/regulation/Prj8q2V
 * https://www.etax.nat.gov.tw/etwmain/tax-info/understanding/tax-q-and-a/national/individual-income-tax/withheld-rule/rule/7owOpjr
 * https://www.etax.nat.gov.tw/download/doc/v2/OvDueFCal_tax_doc.pdf
 * https://www.nhi.gov.tw/ch/cp-4516-74b0f-2613-1.html
 */
export function calculateAffiliateRemuneration(raw: unknown): AffiliateRemunerationQuote {
  const input = Input.parse(raw);
  validateAffiliateRecipientClassification({ recipientType: input.recipientType, nhiTreatment: input.nhiTreatment, exemptionReference: input.exemptionReference, invoiceReference: input.invoiceReference });
  const business = input.recipientType === "domestic_invoice_business";
  const resident = input.recipientType === "resident_individual";
  const withholdingTaxCents = business ? 0 : incomeTaxCents(input.grossAmountCents, resident ? 1_000 : 2_000, resident);
  const nhiBaseCents = Math.min(input.grossAmountCents, 1_000_000_000);
  // NHI uses half-up whole-NTD rounding, a 20,000-NTD inclusive threshold
  // and a 10,000,000-NTD cap per payment. Tax residency does not imply coverage.
  const nhiSupplementaryTaxCents = input.nhiTreatment === "subject_execution_business" && input.grossAmountCents >= 2_000_000
    ? Number((BigInt(nhiBaseCents) * BigInt(211) + BigInt(500_000)) / BigInt(1_000_000)) * 100 : 0;
  const netPayoutAmountCents = input.grossAmountCents - withholdingTaxCents - nhiSupplementaryTaxCents - input.bankFeeCents;
  if (netPayoutAmountCents <= 0) throw new AffiliateRemunerationInputError("A positive payable amount is required.");
  return { grossAmountCents: input.grossAmountCents, withholdingTaxCents, nhiSupplementaryTaxCents, bankFeeCents: input.bankFeeCents, netPayoutAmountCents, ruleVersion: AFFILIATE_REMUNERATION_RULE_VERSION };
}
