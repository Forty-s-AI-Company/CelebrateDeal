import { describe, expect, it } from "vitest";

import { nextSettlementMonthKey, splitNetPayable } from "@/lib/settlement-period";

describe("splitNetPayable (F-039, review m-1)", () => {
  it.each([
    // payable, adjustment, payout, carry
    [1_000, 0, 1_000, 0],
    [-1_000, 0, 0, -1_000],
    // A negative adjustment approved earlier may only reduce the payout to 0.
    [500, -800, 0, 0],
    [-1_000, -100, 0, -1_000],
    // A positive adjustment may reduce or clear a carry.
    [-1_000, 300, 0, -700],
    [-1_000, 1_500, 500, 0],
  ])("payable %i with adjustment %i pays %i and carries %i", (payable, adjustment, payout, carry) => {
    expect(splitNetPayable(payable, adjustment)).toEqual({ finalPayoutAmountCents: payout, carriedOutCents: carry });
  });

  it("rolls the month over the year end", () => {
    expect(nextSettlementMonthKey("2026-12")).toBe("2027-01");
    expect(() => nextSettlementMonthKey("bad")).toThrow("invalid_month");
  });
});
