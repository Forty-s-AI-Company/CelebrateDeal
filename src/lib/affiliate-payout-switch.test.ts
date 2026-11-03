import { afterEach, describe, expect, it, vi } from "vitest";
import {
  AFFILIATE_PAYOUTS_DISABLED_ENV,
  affiliatePayoutsDisabled,
  AffiliatePayoutsDisabledError,
  assertAffiliatePayoutsEnabled,
} from "@/lib/affiliate-payout-switch";

afterEach(() => vi.unstubAllEnvs());

describe("AFFILIATE_PAYOUTS_DISABLED platform switch (F-052)", () => {
  it.each([
    ["unset", undefined],
    ["empty", ""],
    ["blank", "   "],
    ["false", "false"],
    ["FALSE", " FALSE "],
    ["0", "0"],
  ])("allows payouts when the value is %s", (_label, value) => {
    expect(affiliatePayoutsDisabled({ [AFFILIATE_PAYOUTS_DISABLED_ENV]: value })).toBe(false);
    expect(() => assertAffiliatePayoutsEnabled({ [AFFILIATE_PAYOUTS_DISABLED_ENV]: value })).not.toThrow();
  });

  it.each(["true", "TRUE", "1", "yes", "ture", "on"])("fails closed and disables payouts for %j", (value) => {
    expect(affiliatePayoutsDisabled({ [AFFILIATE_PAYOUTS_DISABLED_ENV]: value })).toBe(true);
    expect(() => assertAffiliatePayoutsEnabled({ [AFFILIATE_PAYOUTS_DISABLED_ENV]: value })).toThrow(AffiliatePayoutsDisabledError);
  });

  it("reads the process environment by default", () => {
    vi.stubEnv(AFFILIATE_PAYOUTS_DISABLED_ENV, "true");
    expect(affiliatePayoutsDisabled()).toBe(true);
    vi.stubEnv(AFFILIATE_PAYOUTS_DISABLED_ENV, "false");
    expect(affiliatePayoutsDisabled()).toBe(false);
  });
});
