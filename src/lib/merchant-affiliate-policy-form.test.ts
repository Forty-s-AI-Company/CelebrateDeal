import { describe, expect, it } from "vitest";
import { merchantAffiliatePolicyFromForm } from "./merchant-affiliate-policy-form";
function fixture() {
  const form = new FormData();
  for (const [key, value] of Object.entries({ expectedRevision: "3", maxTotalPercent: "20.00", tierStart: "1", tierEnd: "", tierRate: "12.34", uplineRate: "5.66", overrideProduct: "same-tenant-product", overrideRate: "14.00" })) form.append(key, value);
  return form;
}
describe("merchant policy browser form monetary boundary", () => {
  it("parses exact decimal percentages without a floating monetary conversion", () => {
    const result = merchantAffiliatePolicyFromForm(fixture());
    expect(result.expectedRevision).toBe(3);
    expect(result.terms).toMatchObject({ maxTotalBps: 2000, tiers: [{ rateBps: 1234, maxQuantity: null }], uplines: [{ level: 1, rateBps: 566 }], productOverrides: [{ rateBps: 1400 }] });
  });
  it.each(["", "-1", "NaN", "Infinity", "1e2", "12.345", "100.01"])("rejects non-canonical percentages %s", value => {
    const form = fixture(); form.set("tierRate", value);
    expect(() => merchantAffiliatePolicyFromForm(form)).toThrow();
  });
  it("rejects extra/missing rows, file fields and over-budget product overrides", () => {
    const extra = fixture(); extra.append("tierStart", "2"); expect(() => merchantAffiliatePolicyFromForm(extra)).toThrow();
    const missing = fixture(); missing.delete("tierEnd"); expect(() => merchantAffiliatePolicyFromForm(missing)).toThrow();
    const file = fixture(); file.set("tierRate", new Blob(["10"])); expect(() => merchantAffiliatePolicyFromForm(file)).toThrow();
    const cap = fixture(); cap.set("overrideRate", "15"); expect(() => merchantAffiliatePolicyFromForm(cap)).toThrow();
  });
});
