import { describe, expect, it } from "vitest";
import { affiliateCommissionSource, formatAffiliateCommissionLevel, formatAffiliateCommissionSource } from "@/lib/affiliate-commission-source";

describe("affiliate commission source", () => {
  it("treats level 0 and legacy null levels as direct promotion without exposing the code", () => {
    expect(affiliateCommissionSource({ merchantLevel: 0, referralCode: "TESTP1" })).toEqual({ kind: "direct" });
    expect(affiliateCommissionSource({ merchantLevel: null, referralCode: "LEGACY" })).toEqual({ kind: "direct" });
    expect(affiliateCommissionSource({ merchantLevel: null, referralCode: null })).toEqual({ kind: "direct" });
    expect(formatAffiliateCommissionSource({ kind: "direct" })).toBe("直接推廣");
  });

  it("labels a level-1 upline row with the order's referral code", () => {
    const source = affiliateCommissionSource({ merchantLevel: 1, referralCode: "TESTP2" });
    expect(source).toEqual({ kind: "upline", level: 1, referralCode: "TESTP2" });
    expect(formatAffiliateCommissionSource(source)).toBe("團隊上線（第 1 層）· 來自 TESTP2");
  });

  it("drops the order's referral code in the data layer for level 2 and above", () => {
    for (const merchantLevel of [2, 3, 8]) {
      const source = affiliateCommissionSource({ merchantLevel, referralCode: "TESTP2" });
      expect(source).toEqual({ kind: "upline", level: merchantLevel, referralCode: null });
      expect(formatAffiliateCommissionSource(source)).toBe(`團隊上線（第 ${merchantLevel} 層）`);
    }
    // The formatter never prints a code for level 2+ even if one is supplied.
    expect(formatAffiliateCommissionSource({ kind: "upline", level: 2, referralCode: "TESTP2" })).toBe("團隊上線（第 2 層）");
  });

  it("shows only the level when an upline row has no usable referral code", () => {
    for (const referralCode of [null, "", "   "]) {
      const source = affiliateCommissionSource({ merchantLevel: 1, referralCode });
      expect(source).toEqual({ kind: "upline", level: 1, referralCode: null });
      expect(formatAffiliateCommissionSource(source)).toBe("團隊上線（第 1 層）");
    }
  });

  it("never reports an upline level for a non-positive or non-integer level", () => {
    for (const merchantLevel of [-1, 1.5, Number.NaN]) {
      expect(affiliateCommissionSource({ merchantLevel, referralCode: "TESTP2" })).toEqual({ kind: "direct" });
    }
  });

  it("formats merchant level labels", () => {
    expect(formatAffiliateCommissionLevel(null)).toBe("直接");
    expect(formatAffiliateCommissionLevel(0)).toBe("直接");
    expect(formatAffiliateCommissionLevel(1)).toBe("第 1 層");
    expect(formatAffiliateCommissionLevel(8)).toBe("第 8 層");
  });
});
