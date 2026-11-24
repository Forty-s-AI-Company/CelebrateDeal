import { describe, expect, it } from "vitest";

import { discountCodeFormErrorMessage, parseDiscountCodeForm } from "@/lib/discount-code-admin";

function form(values: Record<string, string | string[]>) {
  const data = new FormData();
  for (const [key, value] of Object.entries(values)) {
    for (const item of Array.isArray(value) ? value : [value]) data.append(key, item);
  }
  return data;
}

const base = { code: "Spring-26", discountType: "fixed_amount", discountValue: "150", isActive: "on" };

describe("parseDiscountCodeForm", () => {
  it("stores NT$ amounts in cents and the code upper-cased for case-insensitive matching", () => {
    expect(parseDiscountCodeForm(form({ ...base, minSubtotal: "500", maxRedemptions: "10", maxRedemptionsPerBuyer: "1" }), "Asia/Taipei")).toEqual({
      ok: true,
      draft: {
        code: "Spring-26", normalizedCode: "SPRING-26", discountType: "fixed_amount", discountValue: 15_000, currency: "TWD",
        appliesToAllProducts: true, productIds: [], startsAt: null, endsAt: null,
        maxRedemptions: 10, maxRedemptionsPerBuyer: 1, minSubtotalCents: 50_000, isActive: true,
      },
    });
  });

  it("keeps percentages as whole percent and reads the period in the vendor's time zone", () => {
    const parsed = parseDiscountCodeForm(form({ ...base, discountType: "percentage", discountValue: "20", startsAt: "2026-12-01T00:00", endsAt: "2026-12-31T23:59" }), "Asia/Taipei");
    expect(parsed).toMatchObject({ ok: true, draft: {
      discountType: "percentage", discountValue: 20,
      startsAt: new Date("2026-11-30T16:00:00.000Z"), endsAt: new Date("2026-12-31T15:59:00.000Z"),
    } });
  });

  it("reads selected products, de-duplicated", () => {
    expect(parseDiscountCodeForm(form({ ...base, appliesTo: "selected", productIds: ["product-a", "product-b", "product-a"] }), "Asia/Taipei"))
      .toMatchObject({ ok: true, draft: { appliesToAllProducts: false, productIds: ["product-a", "product-b"] } });
  });

  it("is inactive unless the box is ticked", () => {
    expect(parseDiscountCodeForm(form({ code: "OFF100", discountType: "fixed_amount", discountValue: "1" }), "Asia/Taipei")).toMatchObject({ ok: true, draft: { isActive: false } });
  });

  it.each([
    [{ code: "ab" }, "invalid_code"],
    [{ code: "雙十一" }, "invalid_code"],
    [{ discountType: "free_shipping" }, "invalid_value"],
    [{ discountValue: "0" }, "invalid_value"],
    [{ discountValue: "12.5" }, "invalid_value"],
    [{ discountType: "percentage", discountValue: "101" }, "invalid_value"],
    [{ startsAt: "2026-12-02T00:00", endsAt: "2026-12-01T00:00" }, "invalid_period"],
    [{ startsAt: "not-a-date" }, "invalid_period"],
    [{ maxRedemptions: "0" }, "invalid_limit"],
    [{ maxRedemptionsPerBuyer: "-1" }, "invalid_limit"],
    [{ minSubtotal: "abc" }, "invalid_limit"],
    [{ appliesTo: "selected" }, "invalid_products"],
    [{ appliesTo: "selected", productIds: ["bad id"] }, "invalid_products"],
  ] as const)("rejects %j as %s", (overrides, error) => {
    expect(parseDiscountCodeForm(form({ ...base, ...overrides }), "Asia/Taipei")).toEqual({ ok: false, error });
  });
});

describe("discountCodeFormErrorMessage", () => {
  it("only maps known error codes", () => {
    expect(discountCodeFormErrorMessage("duplicate_code")).toContain("已存在");
    expect(discountCodeFormErrorMessage("<script>")).toBeNull();
    expect(discountCodeFormErrorMessage(undefined)).toBeNull();
  });
});
