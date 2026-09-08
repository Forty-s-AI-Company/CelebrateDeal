import { describe, expect, it } from "vitest";
import { calculateTieredCommission, simulateTieredCommission } from "@/lib/tiered-commission-engine";

const policy = {
  version: 3,
  tiers: [
    { minQuantity: 1, maxQuantity: 5, rateBps: 1_500 },
    { minQuantity: 6, maxQuantity: 20, rateBps: 2_000 },
    { minQuantity: 21, maxQuantity: null, rateBps: 2_500 },
  ],
  productOverrides: [{ productId: "course-vip", rateBps: 3_000 }],
} as const;

describe("tiered commission engine", () => {
  it("在第 5 件與第 6 件精準跨階梯", () => {
    expect(calculateTieredCommission({ unitPriceCents: 10_000, quantity: 1, cumulativeSalesBeforeCount: 4, policy }).appliedRateBps).toBe(1_500);
    const sixth = calculateTieredCommission({ unitPriceCents: 10_000, quantity: 1, cumulativeSalesBeforeCount: 5, policy });
    expect(sixth.appliedRateBps).toBe(2_000);
    expect(sixth.matchedTier).toMatchObject({ minQuantity: 6, maxQuantity: 20, source: "tier" });
  });

  it("商品獨立覆蓋率優先於全域階梯", () => {
    const result = calculateTieredCommission({ unitPriceCents: 10_000, quantity: 1, cumulativeSalesBeforeCount: 0, productId: "course-vip", policy });
    expect(result).toMatchObject({ commissionRate: 0.3, commissionAmountCents: 3_000, vendorNetAmountCents: 7_000, policyVersion: 3 });
    expect(result.matchedTier.source).toBe("product_override");
  });

  it("以分為單位四捨五入，不產生浮點金額", () => {
    const result = calculateTieredCommission({ unitPriceCents: 101, quantity: 1, cumulativeSalesBeforeCount: 0, policy });
    expect(result.grossSalesAmount).toBe(101);
    expect(result.commissionAmountCents).toBe(15);
    expect(result.vendorNetAmountCents).toBe(86);
  });

  it("批次模擬逐件套用階梯，不把第 6 件費率回溯至前五件", () => {
    expect(simulateTieredCommission({ unitPriceCents: 10_000, quantity: 6, policy })).toEqual({
      grossSalesAmount: 60_000,
      totalCommissionAmountCents: 9_500,
      vendorNetAmountCents: 50_500,
    });
  });
});
