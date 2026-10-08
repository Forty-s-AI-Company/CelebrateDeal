import { describe, expect, it } from "vitest";
import { calculateMerchantAffiliatePlan, calculateMerchantAffiliateRefundTargets, parseMerchantAffiliateTerms, type MerchantAffiliateTerms } from "./affiliate-tier-policy";
const terms: MerchantAffiliateTerms = { schemaVersion: 1, currency: "TWD", maxTotalBps: 10_000, tiers: [{ minQuantity: 1, maxQuantity: 5, rateBps: 1000 }, { minQuantity: 6, maxQuantity: null, rateBps: 2000 }], uplines: [{ level: 1, rateBps: 500 }], productOverrides: [] };
const recipients = [{ affiliateId: "direct", level: 0 }, { affiliateId: "upline", level: 1 }];
const plan = (overrides: Partial<Parameters<typeof calculateMerchantAffiliatePlan>[0]> = {}) => calculateMerchantAffiliatePlan({ terms, recipients, lines: [{ productId: "p", quantity: 1, amountCents: 1000 }], qualifiedQuantityBefore: 0, netReferenceAmountCents: 900, ...overrides });
describe("immutable merchant quantity-tier monetary plan", () => {
  it("crosses the fifth-to-sixth unit individually and conserves the discounted payment", () => {
    const result = plan({ qualifiedQuantityBefore: "4", lines: [{ productId: "p", quantity: 2, amountCents: 1800 }], netReferenceAmountCents: 1700 });
    expect(result.selectedTiers.map(item => item.rateBps)).toEqual([1000, 2000]);
    expect(result.recipients.map(item => item.amountCents)).toEqual([270, 90]);
    expect(result.qualifiedQuantityBefore).toBe("4"); expect(result.qualifiedQuantityAfter).toBe("6");
    expect(result.grossAmountCents).toBe(1800); expect(result.commissionAmountCents).toBe(360);
  });
  it("applies a product override without collapsing missing upline levels", () => {
    const result = plan({ terms: { ...terms, productOverrides: [{ productId: "p", rateBps: 3000 }], uplines: [{ level: 1, rateBps: 500 }, { level: 2, rateBps: 700 }] }, recipients: [{ affiliateId: "direct", level: 0 }, { affiliateId: "second", level: 2 }] });
    expect(result.recipients.map(item => item.amountCents)).toEqual([300, 70]);
  });
  it("rounds a one-cent shared allocation once instead of paying two cents", () => {
    const result = plan({ terms: { ...terms, tiers: [{ minQuantity: 1, maxQuantity: null, rateBps: 5000 }], uplines: [{ level: 1, rateBps: 5000 }] }, lines: [{ productId: "p", quantity: 1, amountCents: 1 }], netReferenceAmountCents: 1 });
    expect(result.recipients.map(item => item.amountCents)).toEqual([1, 0]); expect(result.commissionAmountCents).toBe(1);
  });
  it("retains a zero monetary plan and advances count only in the returned immutable plan", () => {
    const result = plan({ lines: [{ productId: "p", quantity: 1, amountCents: 1 }] });
    expect(result.commissionAmountCents).toBe(0); expect(result.qualifiedQuantityAfter).toBe("1");
    expect(result.recipients.map(item => item.amountCents)).toEqual([0, 0]);
  });
  it.each([
    { tiers: [{ minQuantity: 2, maxQuantity: null, rateBps: 1000 }] },
    { tiers: [{ minQuantity: 1, maxQuantity: 5, rateBps: 1000 }, { minQuantity: 7, maxQuantity: null, rateBps: 1000 }] },
    { tiers: [{ minQuantity: 1, maxQuantity: 5, rateBps: 1000 }, { minQuantity: 5, maxQuantity: null, rateBps: 1000 }] },
    { tiers: [{ minQuantity: 1, maxQuantity: 5, rateBps: 1000 }] },
    { uplines: [{ level: 2, rateBps: 1000 }] },
    { uplines: [{ level: 1, rateBps: 9000 }] },
    { productOverrides: [{ productId: "p", rateBps: 9501 }] },
    { productOverrides: [{ productId: "p", rateBps: 1000 }, { productId: "p", rateBps: 2000 }] },
  ])("rejects malformed/ambiguous or over-budget terms %#", patch => { expect(() => parseMerchantAffiliateTerms({ ...terms, ...patch })).toThrow(); });
  it("rejects duplicate beneficiaries, cycles, unsafe integers, quantity/count overflow and invalid net reference", () => {
    expect(() => plan({ recipients: [{ affiliateId: "direct", level: 0 }, { affiliateId: "direct", level: 1 }] })).toThrow();
    expect(() => plan({ recipients: [{ affiliateId: "a", level: 0 }, { affiliateId: "b", level: 0 }] })).toThrow();
    expect(() => plan({ netReferenceAmountCents: -1 })).toThrow();
    expect(() => plan({ qualifiedQuantityBefore: Number.MAX_SAFE_INTEGER + 1 })).toThrow();
    expect(() => plan({ qualifiedQuantityBefore: "9223372036854775807" })).toThrow("成交件數");
    expect(() => plan({ lines: [{ productId: "p", quantity: 1001, amountCents: 1000 }] })).toThrow();
  });
  it.each([999, 0])("preserves gross commission when provider net reference is %i", netReferenceAmountCents => {
    const result = plan({ terms: { ...terms, tiers: [{ minQuantity: 1, maxQuantity: null, rateBps: 10000 }], uplines: [] }, recipients: [{ affiliateId: "direct", level: 0 }], netReferenceAmountCents });
    expect(result.commissionAmountCents).toBe(1000);
    expect(result.netReferenceAmountCents).toBe(netReferenceAmountCents);
  });
  it("supports exactly eight bounded upline levels and preserves original frozen input", () => {
    const input = { ...terms, uplines: Array.from({ length: 8 }, (_, index) => ({ level: index + 1, rateBps: 100 })) };
    const frozen = JSON.stringify(input); expect(plan({ terms: input, recipients: [{ affiliateId: "direct", level: 0 }, ...input.uplines.map(item => ({ affiliateId: `upline-${item.level}`, level: item.level }))] }).recipients).toHaveLength(9);
    expect(JSON.stringify(input)).toBe(frozen);
    expect(() => parseMerchantAffiliateTerms({ ...input, uplines: [...input.uplines, { level: 9, rateBps: 100 }] })).toThrow();
  });
});
describe("cumulative original-plan refund allocation", () => {
  it("conserves a one-cent refund and clears every original amount at full refund", () => {
    expect(calculateMerchantAffiliateRefundTargets({ grossAmountCents: 2, originalAmountsCents: [1, 1], cumulativeRefundCents: 1 })).toEqual([1, 0]);
    expect(calculateMerchantAffiliateRefundTargets({ grossAmountCents: 2, originalAmountsCents: [1, 1], cumulativeRefundCents: 2 })).toEqual([1, 1]);
  });
  it("never moves a beneficiary backwards when cumulative refunds increase, including the Alabama-paradox weights", () => {
    const weights = [1500, 1500, 900, 500, 500, 200]; let previous = weights.map(() => 0);
    for (let refunded = 0; refunded <= 1000; refunded += 1) {
      const next = calculateMerchantAffiliateRefundTargets({ grossAmountCents: 5100, originalAmountsCents: weights, cumulativeRefundCents: refunded });
      expect(next.reduce((sum, amount) => sum + amount, 0)).toBe(refunded);
      next.forEach((amount, index) => { expect(amount).toBeGreaterThanOrEqual(previous[index]!); expect(amount).toBeLessThanOrEqual(weights[index]!); }); previous = next;
    }
  });
  it("rejects invented original budgets and refund principal outside the paid transaction", () => {
    expect(() => calculateMerchantAffiliateRefundTargets({ grossAmountCents: 10, originalAmountsCents: [6, 6], cumulativeRefundCents: 1 })).toThrow();
    expect(() => calculateMerchantAffiliateRefundTargets({ grossAmountCents: 10, originalAmountsCents: [1, 2], cumulativeRefundCents: 11 })).toThrow();
  });
});
