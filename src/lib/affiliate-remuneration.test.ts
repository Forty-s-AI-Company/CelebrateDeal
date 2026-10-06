import { describe, expect, it } from "vitest";
import { AFFILIATE_REMUNERATION_RULE_VERSION, calculateAffiliateRemuneration } from "./affiliate-remuneration";

const resident = { recipientType: "resident_individual", nhiTreatment: "subject_execution_business", bankFeeCents: 1_500 } as const;

describe("approved affiliate remuneration calculation", () => {
  it.each([
    [1_999_900, 0, 0, 1_998_400],
    [2_000_000, 0, 42_200, 1_956_300],
    [2_000_999, 0, 42_200, 1_957_299],
    [2_001_000, 200_100, 42_200, 1_757_200],
    [2_001_500, 200_100, 42_200, 1_757_700],
  ])("keeps the exact cents and whole-NTD threshold at %i", (grossAmountCents, withholdingTaxCents, nhiSupplementaryTaxCents, netPayoutAmountCents) => {
    expect(calculateAffiliateRemuneration({ ...resident, grossAmountCents })).toEqual({ grossAmountCents, withholdingTaxCents, nhiSupplementaryTaxCents, bankFeeCents: 1_500, netPayoutAmountCents, ruleVersion: AFFILIATE_REMUNERATION_RULE_VERSION });
  });

  it("caps NHI per-payment basis while income tax still covers the full payable", () => {
    const first = calculateAffiliateRemuneration({ ...resident, grossAmountCents: 1_000_000_000 });
    const second = calculateAffiliateRemuneration({ ...resident, grossAmountCents: 2_000_000_000 });
    expect(first.nhiSupplementaryTaxCents).toBe(21_100_000);
    expect(second.nhiSupplementaryTaxCents).toBe(first.nhiSupplementaryTaxCents);
    expect(second.withholdingTaxCents).toBe(200_000_000);
    expect(second.netPayoutAmountCents).toBe(1_778_898_500);
  });

  it("does not infer NHI coverage from nonresident income tax classification", () => {
    const quote = calculateAffiliateRemuneration({ ...resident, recipientType: "nonresident_individual", grossAmountCents: 2_000_000 });
    expect(quote.withholdingTaxCents).toBe(400_000);
    expect(quote.nhiSupplementaryTaxCents).toBe(42_200);
    expect(calculateAffiliateRemuneration({ ...resident, recipientType: "nonresident_individual", grossAmountCents: 10_000 }).withholdingTaxCents).toBe(2_000);
  });

  it.each(["documented_exemption", "not_insured"] as const)("requires an approved reference for %s", nhiTreatment => {
    const input = { ...resident, nhiTreatment, grossAmountCents: 2_001_000 };
    expect(() => calculateAffiliateRemuneration(input)).toThrow("approved exemption reference");
    expect(calculateAffiliateRemuneration({ ...input, exemptionReference: "review-synthetic" }).nhiSupplementaryTaxCents).toBe(0);
  });

  it("requires an invoice business classification instead of silently applying a personal tax rate", () => {
    const input = { recipientType: "domestic_invoice_business", nhiTreatment: "not_applicable_business", bankFeeCents: 0, grossAmountCents: 2_001_000 };
    expect(() => calculateAffiliateRemuneration(input)).toThrow("approved invoice business classification");
    expect(calculateAffiliateRemuneration({ ...input, invoiceReference: "invoice-synthetic" })).toMatchObject({ withholdingTaxCents: 0, nhiSupplementaryTaxCents: 0, netPayoutAmountCents: 2_001_000 });
    expect(() => calculateAffiliateRemuneration({ ...resident, grossAmountCents: 2_001_000, invoiceReference: "invoice-synthetic" })).toThrow("individual cannot use");
  });

  it.each([-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, 2_147_483_648, Number.MAX_SAFE_INTEGER])("rejects unsupported gross cents %s without rounding the input", grossAmountCents => {
    expect(() => calculateAffiliateRemuneration({ ...resident, grossAmountCents })).toThrow();
  });

  it("rejects caller-selected rates, fee overflow, invalid exemptions and nonpositive payables", () => {
    const input = { ...resident, grossAmountCents: 2_001_000 };
    expect(() => calculateAffiliateRemuneration({ ...input, rateBps: 0 })).toThrow();
    expect(() => calculateAffiliateRemuneration({ ...input, bankFeeCents: 1.5 })).toThrow();
    expect(() => calculateAffiliateRemuneration({ ...input, nhiTreatment: "documented_exemption", exemptionReference: "../foreign" })).toThrow();
    expect(() => calculateAffiliateRemuneration({ ...input, nhiTreatment: "not_applicable_business" })).toThrow();
    expect(() => calculateAffiliateRemuneration({ ...input, grossAmountCents: 1_500 })).toThrow("positive payable");
    expect(calculateAffiliateRemuneration({ ...resident, bankFeeCents: 0, grossAmountCents: 1_999_900 }).netPayoutAmountCents).toBe(1_999_900);
  });
});
