import { describe, expect, it } from "vitest";
import { formatCurrency, formatTwd } from "./format";

describe("formatTwd (F-120)", () => {
  it("always renders NT$ with grouping and no dollar-only symbol", () => {
    expect(formatTwd(123_400)).toBe("NT$1,234");
    expect(formatTwd(1_234_500)).toBe("NT$12,345");
    expect(formatTwd(0)).toBe("NT$0");
  });
  it("puts the sign before the symbol", () => {
    expect(formatTwd(-123_400)).toBe("-NT$1,234");
  });
  it("keeps cents only when asked", () => {
    expect(formatTwd(1_234_550, { fractionDigits: 2 })).toBe("NT$12,345.50");
  });
  it("routes TWD through formatCurrency and leaves other currencies to Intl", () => {
    expect(formatCurrency(50_000)).toBe("NT$500");
    expect(formatCurrency(50_000, "TWD")).toBe("NT$500");
    expect(formatCurrency(1_999, "USD")).toContain("19.99");
    expect(formatCurrency(1_999, "USD")).not.toContain("NT$");
    expect(formatCurrency(50_000, "JPY")).toMatch(/500$/);
    expect(formatCurrency(50_000, "JPY")).not.toContain(".");
  });
});
