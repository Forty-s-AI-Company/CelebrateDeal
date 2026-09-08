import { describe, expect, it } from "vitest";
import { calculateTaiwanTaxWithholding } from "@/lib/taiwan-tax-withholding";

describe("Taiwan affiliate tax withholding", () => {
  it.each([
    [19_999, 0, 0, 15, 19_984],
    [20_000, 0, 422, 15, 19_563],
    [20_010, 2_001, 422, 15, 17_572],
  ])("calculates the NT$%i boundary", (grossNtd, incomeTaxNtd, nhiNtd, feeNtd, netNtd) => {
    expect(calculateTaiwanTaxWithholding({ grossAmountCents: grossNtd * 100 })).toMatchObject({
      grossAmountCents: grossNtd * 100,
      withholdingTaxCents: incomeTaxNtd * 100,
      nhiSupplementaryTaxCents: nhiNtd * 100,
      bankFeeCents: feeNtd * 100,
      netPayoutAmountCents: netNtd * 100,
    });
  });

  it("supports same-bank or merchant-paid zero fees", () => {
    expect(calculateTaiwanTaxWithholding({ grossAmountCents: 19_999_00, bankFeeCents: 0 }).netPayoutAmountCents).toBe(19_999_00);
  });

  it("rounds statutory deductions to whole NTD and rejects unsafe inputs", () => {
    expect(calculateTaiwanTaxWithholding({ grossAmountCents: 20_011_00 }).nhiSupplementaryTaxCents).toBe(422_00);
    for (const grossAmountCents of [-1, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
      expect(() => calculateTaiwanTaxWithholding({ grossAmountCents })).toThrow(RangeError);
    }
  });
});
