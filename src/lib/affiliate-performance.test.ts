import { describe, expect, it } from "vitest";
import { calculateAffiliateConversionRate } from "./affiliate-performance";

describe("calculateAffiliateConversionRate", () => {
  it("returns 0 when there are no clicks", () => {
    expect(calculateAffiliateConversionRate(0, 0)).toBe(0);
  });

  it("calculates a conversion rate for recorded clicks", () => {
    expect(calculateAffiliateConversionRate(80, 6)).toBe(7.5);
  });
});
