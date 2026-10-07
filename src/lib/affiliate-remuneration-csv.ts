import type { exportAffiliateRemunerationQuote } from "./affiliate-remuneration-quotes";
type Export = NonNullable<Awaited<ReturnType<typeof exportAffiliateRemunerationQuote>>>;
function cell(value: string | number, text = false) {
  const raw = String(value);
  // Excel must not interpret user-controlled names as formulas. Bank/tax
  // identifiers are text to preserve leading zeros and long digit sequences.
  const protectedValue = text || /^[\s\u0000-\u001f]*[=+@-]/u.test(raw) ? `'${raw}` : raw;
  return `"${protectedValue.replaceAll('"', '""')}"`;
}
/** Attachment only, never a log or public artifact. All monetary columns name
 * their integer-cent unit; generating this report executes no bank transfer. */
export function affiliateRemunerationCsv(record: Export) {
  const headers = ["snapshotId", "payoutId", "revision", "exportedAt", "ruleVersion", "currency", "grossAmountCents", "withholdingTaxCents", "nhiSupplementaryTaxCents", "bankFeeCents", "netPayoutAmountCents", "accountName", "bankCode", "accountNumber", "taxIdentity"];
  const values = [record.snapshotId, record.payoutId, record.revision, record.exportedAt.toISOString(), record.ruleVersion, "TWD", record.grossAmountCents, record.withholdingTaxCents, record.nhiSupplementaryTaxCents, record.bankFeeCents, record.netPayoutAmountCents, record.bank.accountName, record.bank.bankCode, record.bank.accountNumber, record.taxIdentity];
  return `\uFEFF${headers.map(value => cell(value)).join(",")}\r\n${values.map((value, index) => cell(value, index >= 12)).join(",")}\r\n`;
}
