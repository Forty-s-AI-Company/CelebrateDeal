import { describe, expect, it } from "vitest";

import {
  payUniRefundHoldEarliestReleaseAt,
  payUniRefundHoldEligibleAt,
  payUniRefundHoldNextCountableAt,
  payUniRefundHoldPolicy,
} from "@/lib/payuni-refund-hold-release";

const HOUR = 60 * 60 * 1000;

describe("PayUni refund hold release policy (F-046)", () => {
  it("defaults to three confirmations and a 24-hour window", () => {
    expect(payUniRefundHoldPolicy({})).toEqual({ requiredConfirmations: 3, windowMs: 24 * HOUR, minIntervalMs: 6 * HOUR });
  });

  it("accepts bounded integer overrides", () => {
    expect(payUniRefundHoldPolicy({
      PAYUNI_REFUND_HOLD_RELEASE_CONFIRMATIONS: "5",
      PAYUNI_REFUND_HOLD_RELEASE_WINDOW_HOURS: " 48 ",
      PAYUNI_REFUND_HOLD_CONFIRMATION_INTERVAL_HOURS: "12",
    })).toEqual({ requiredConfirmations: 5, windowMs: 48 * HOUR, minIntervalMs: 12 * HOUR });
  });

  it.each(["1", "0", "-3", "2.5", "1e1", "abc", "21"])("falls back to the default for confirmations=%j", (value) => {
    expect(payUniRefundHoldPolicy({ PAYUNI_REFUND_HOLD_RELEASE_CONFIRMATIONS: value }).requiredConfirmations).toBe(3);
  });

  it.each(["0", "721", "12h", ""])("falls back to the default for window=%j", (value) => {
    expect(payUniRefundHoldPolicy({ PAYUNI_REFUND_HOLD_RELEASE_WINDOW_HOURS: value }).windowMs).toBe(24 * HOUR);
  });

  it.each(["0", "169", "1.5"])("falls back to the default for interval=%j", (value) => {
    expect(payUniRefundHoldPolicy({ PAYUNI_REFUND_HOLD_CONFIRMATION_INTERVAL_HOURS: value }).minIntervalMs).toBe(6 * HOUR);
  });

  it("measures the window from the reservation time and spaces counted confirmations", () => {
    const policy = { requiredConfirmations: 3, windowMs: 24 * HOUR, minIntervalMs: 6 * HOUR };
    const createdAt = new Date("2026-10-20T00:00:00.000Z");
    expect(payUniRefundHoldEligibleAt(createdAt, policy)).toEqual(new Date("2026-10-21T00:00:00.000Z"));
    expect(payUniRefundHoldNextCountableAt({ createdAt, providerNoRefundCheckCount: 0, providerNoRefundLastCheckedAt: null }, policy))
      .toEqual(new Date("2026-10-21T00:00:00.000Z"));
    expect(payUniRefundHoldNextCountableAt({ createdAt, providerNoRefundCheckCount: 1, providerNoRefundLastCheckedAt: new Date("2026-10-21T03:00:00.000Z") }, policy))
      .toEqual(new Date("2026-10-21T09:00:00.000Z"));
  });

  it("puts the earliest release 36 hours after the reservation with the defaults", () => {
    const policy = { requiredConfirmations: 3, windowMs: 24 * HOUR, minIntervalMs: 6 * HOUR };
    const createdAt = new Date("2026-10-20T00:00:00.000Z");
    expect(payUniRefundHoldEarliestReleaseAt({ createdAt, providerNoRefundCheckCount: 0, providerNoRefundLastCheckedAt: null }, policy))
      .toEqual(new Date("2026-10-21T12:00:00.000Z"));
    expect(payUniRefundHoldEarliestReleaseAt({ createdAt, providerNoRefundCheckCount: 2, providerNoRefundLastCheckedAt: new Date("2026-10-21T08:00:00.000Z") }, policy))
      .toEqual(new Date("2026-10-21T14:00:00.000Z"));
  });
});
