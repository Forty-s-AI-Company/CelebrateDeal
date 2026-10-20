import { describe, expect, it } from "vitest";

import { payUniRefundHoldEligibleAt, payUniRefundHoldPolicy } from "@/lib/payuni-refund-hold-release";

const HOUR = 60 * 60 * 1000;

describe("PayUni refund hold release policy (F-046)", () => {
  it("defaults to three confirmations and a 24-hour window", () => {
    expect(payUniRefundHoldPolicy({})).toEqual({ requiredConfirmations: 3, windowMs: 24 * HOUR });
  });

  it("accepts bounded integer overrides", () => {
    expect(payUniRefundHoldPolicy({
      PAYUNI_REFUND_HOLD_RELEASE_CONFIRMATIONS: "5",
      PAYUNI_REFUND_HOLD_RELEASE_WINDOW_HOURS: " 48 ",
    })).toEqual({ requiredConfirmations: 5, windowMs: 48 * HOUR });
  });

  it.each(["1", "0", "-3", "2.5", "1e1", "abc", "21"])("falls back to the default for confirmations=%j", (value) => {
    expect(payUniRefundHoldPolicy({ PAYUNI_REFUND_HOLD_RELEASE_CONFIRMATIONS: value }).requiredConfirmations).toBe(3);
  });

  it.each(["0", "721", "12h", ""])("falls back to the default for window=%j", (value) => {
    expect(payUniRefundHoldPolicy({ PAYUNI_REFUND_HOLD_RELEASE_WINDOW_HOURS: value }).windowMs).toBe(24 * HOUR);
  });

  it("measures the window from the reservation time", () => {
    expect(payUniRefundHoldEligibleAt(new Date("2026-10-20T00:00:00.000Z"), { requiredConfirmations: 3, windowMs: 24 * HOUR }))
      .toEqual(new Date("2026-10-21T00:00:00.000Z"));
  });
});
