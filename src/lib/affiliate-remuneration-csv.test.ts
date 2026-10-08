import { describe, expect, it } from "vitest";
import { affiliateRemunerationCsv } from "./affiliate-remuneration-csv";
const record = { snapshotId: "synthetic", payoutId: "synthetic_payout", revision: 1, exportedAt: new Date("2026-10-07T00:00:00Z"), ruleVersion: "tw-affiliate-20261007-v2" as const, grossAmountCents: 3_000_000, withholdingTaxCents: 300_000, nhiSupplementaryTaxCents: 63_300, bankFeeCents: 1500, netPayoutAmountCents: 2_635_200, bank: { accountName: "Synthetic", bankCode: "001", accountNumber: "00123456789012345678" }, taxIdentity: "SYNTHETIC123" };
describe("private remuneration CSV", () => {
  it("preserves exact cents and text identifiers without claiming payment", () => {
    const csv = affiliateRemunerationCsv(record);
    expect(csv).toContain('"netPayoutAmountCents"');
    expect(csv).toContain('"2635200"');
    expect(csv).toContain('"\'001"');
    expect(csv).toContain('"\'00123456789012345678"');
    expect(csv).not.toContain("paidAt");
  });
  it.each(["=HYPERLINK(\"synthetic\")", " +SYNTHETIC", "\t@SUM(1)", "-SYNTHETIC"])("neutralizes formula account names %j", accountName => {
    const csv = affiliateRemunerationCsv({ ...record, bank: { ...record.bank, accountName } });
    expect(csv).toContain(`"'${accountName.replaceAll('"', '""')}"`);
  });
  it("quotes commas, newlines and double quotes", () => {
    const csv = affiliateRemunerationCsv({ ...record, bank: { ...record.bank, accountName: 'Synthetic, "name"\nnext' } });
    expect(csv).toContain('"Synthetic, ""name""\nnext"');
    expect(csv.endsWith("\r\n")).toBe(true);
  });
});
