import { describe, expect, it } from "vitest";

import {
  calculateDiscountCodeAmount,
  DISCOUNT_CODE_MIN_PAYABLE_CENTS,
  evaluateDiscountCode,
  normalizeDiscountCode,
  type DiscountCodeRecord,
} from "@/lib/discount-codes";

const now = new Date("2026-11-24T04:00:00.000Z");

function code(overrides: Partial<DiscountCodeRecord> = {}): DiscountCodeRecord {
  return {
    id: "code-a",
    vendorId: "vendor-a",
    code: "Save100",
    normalizedCode: "SAVE100",
    discountType: "fixed_amount",
    discountValue: 10_000,
    currency: "TWD",
    appliesToAllProducts: true,
    startsAt: null,
    endsAt: null,
    maxRedemptions: null,
    maxRedemptionsPerBuyer: null,
    minSubtotalCents: null,
    isActive: true,
    redemptionCount: 0,
    revision: 1,
    products: [],
    ...overrides,
  };
}

const context = { vendorId: "vendor-a", productId: "product-a", primaryPriceCents: 100_000, additionalAmountCents: 0, currency: "TWD", now };

describe("normalizeDiscountCode", () => {
  it("ignores case and surrounding spaces", () => {
    expect(normalizeDiscountCode("  save-10_x ")).toBe("SAVE-10_X");
  });

  it.each(["ab", "a".repeat(33), "折扣碼", "SAVE 10", "SAVE%", "", 12, null, ["SAVE10"]])("rejects %j", (value) => {
    expect(normalizeDiscountCode(value)).toBeNull();
  });
});

describe("calculateDiscountCodeAmount", () => {
  it("takes a fixed amount off the primary product", () => {
    expect(calculateDiscountCodeAmount({ discountType: "fixed_amount", discountValue: 30_000, primaryPriceCents: 100_000, currency: "TWD" })).toBe(30_000);
  });

  it("never leaves less than NT$1 to pay", () => {
    expect(DISCOUNT_CODE_MIN_PAYABLE_CENTS).toBe(100);
    expect(calculateDiscountCodeAmount({ discountType: "fixed_amount", discountValue: 500_000, primaryPriceCents: 100_000, currency: "TWD" })).toBe(99_900);
    expect(calculateDiscountCodeAmount({ discountType: "percentage", discountValue: 100, primaryPriceCents: 100_000, currency: "TWD" })).toBe(99_900);
  });

  it("rounds TWD percentages down to whole dollars", () => {
    // 15% of NT$999 is NT$149.85: the buyer gets NT$149 off and pays NT$850.
    expect(calculateDiscountCodeAmount({ discountType: "percentage", discountValue: 15, primaryPriceCents: 99_900, currency: "TWD" })).toBe(14_900);
  });

  it("gives no discount when the price is already the minimum", () => {
    expect(calculateDiscountCodeAmount({ discountType: "fixed_amount", discountValue: 10_000, primaryPriceCents: 100, currency: "TWD" })).toBe(0);
  });

  it.each([
    { discountType: "percentage", discountValue: 101 },
    { discountType: "percentage", discountValue: 0 },
    { discountType: "fixed_amount", discountValue: -100 },
    { discountType: "unknown", discountValue: 100 },
  ])("rejects malformed terms %j", (terms) => {
    expect(calculateDiscountCodeAmount({ ...terms, primaryPriceCents: 100_000, currency: "TWD" })).toBe(0);
  });
});

describe("evaluateDiscountCode", () => {
  it("quotes the discount on the primary product and keeps the bump at full price", () => {
    const result = evaluateDiscountCode(code({ discountType: "percentage", discountValue: 20 }), { ...context, additionalAmountCents: 50_000 });
    expect(result).toEqual({ ok: true, quote: expect.objectContaining({
      discountCodeId: "code-a",
      subtotalAmountCents: 150_000,
      discountAmountCents: 20_000,
      totalAmountCents: 130_000,
      revision: 1,
    }) });
  });

  it("answers another vendor's code exactly like an unknown one", () => {
    expect(evaluateDiscountCode(code({ vendorId: "vendor-b" }), context)).toEqual({ ok: false, reason: "invalid" });
    expect(evaluateDiscountCode(null, context)).toEqual({ ok: false, reason: "invalid" });
  });

  it.each([
    ["inactive", { isActive: false }],
    ["not started", { startsAt: new Date(now.getTime() + 1) }],
    ["ended", { endsAt: now }],
    ["other currency", { currency: "USD" }],
    ["product not listed", { appliesToAllProducts: false, products: [{ productId: "product-b" }] }],
  ] as const)("is invalid when %s", (_label, overrides) => {
    expect(evaluateDiscountCode(code(overrides), context)).toEqual({ ok: false, reason: "invalid" });
  });

  it("applies to a listed product", () => {
    expect(evaluateDiscountCode(code({ appliesToAllProducts: false, products: [{ productId: "product-a" }] }), context).ok).toBe(true);
  });

  it("checks the minimum spend against primary plus order bump", () => {
    const row = code({ minSubtotalCents: 120_000 });
    expect(evaluateDiscountCode(row, context)).toEqual({ ok: false, reason: "min_subtotal_not_met" });
    expect(evaluateDiscountCode(row, { ...context, additionalAmountCents: 20_000 }).ok).toBe(true);
  });

  it("is used up once reserved plus redeemed uses reach the limit", () => {
    expect(evaluateDiscountCode(code({ maxRedemptions: 2, redemptionCount: 2 }), context)).toEqual({ ok: false, reason: "usage_limit_reached" });
    expect(evaluateDiscountCode(code({ maxRedemptions: 2, redemptionCount: 1 }), context).ok).toBe(true);
  });
});
