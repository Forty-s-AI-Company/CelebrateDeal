import { describe, expect, it } from "vitest";
import {
  allowsLegacyAffiliateAttribution,
  defaultAffiliateCode,
  LiveQuotaPolicyValidationError,
  parseLiveQuotaPolicy,
  parseLiveQuotaPolicyForm,
} from "./live-quota-policy";

describe("live quota policy", () => {
  it("normalizes the live form policy and preserves explicit rules", () => {
    expect(parseLiveQuotaPolicyForm({
      affiliateMode: "enabled",
      defaultAffiliateCode: "summer_partner",
      maxConcurrentViewers: 1200,
      stopWhenCreditsBelow: 450,
    })).toEqual({
      version: 2,
      affiliateMode: "enabled",
      defaultAffiliateCode: "SUMMER_PARTNER",
      maxConcurrentViewers: 1200,
      stopWhenCreditsBelow: 450,
      quotaPayerScope: "VENDOR",
      usageAttributionMode: "PROMOTER",
      splitOwnerBps: 3000,
      splitPromoterBps: 7000,
      customAllocations: [],
      memberQuotas: [],
      pageQuotas: [],
    });
  });

  it("rejects invalid modes, codes, and unsafe numeric ranges", () => {
    for (const input of [
      { affiliateMode: "maybe" },
      { defaultAffiliateCode: "bad code" },
      { maxConcurrentViewers: 0 },
      { stopWhenCreditsBelow: -1 },
      { quotaPayerScope: "UNKNOWN" },
      { quotaPayerScope: "MEMBER" },
      { usageAttributionMode: "UNKNOWN" },
      { usageAttributionMode: "SPLIT", splitOwnerBps: 8000, splitPromoterBps: 3000 },
      { usageAttributionMode: "CUSTOM", customAllocations: [{ teamId: "team-1", membershipId: "member-1", bps: 9000 }] },
      { usageAttributionMode: "CUSTOM", customAllocations: [{ teamId: "team-1", membershipId: "member-1" }] },
      { memberQuotas: [{ teamId: "team-1", membershipId: "member-1", includedMinutes: 0 }] },
      { memberQuotas: [{ teamId: "team-1", membershipId: "member-1", includedMinutes: 1 }, { teamId: "team-1", membershipId: "member-1", includedMinutes: 2 }] },
      { pageQuotas: [{ pageId: "page-1", includedMinutes: 1 }, { pageId: "page-1", includedMinutes: 2 }] },
    ]) {
      expect(() => parseLiveQuotaPolicyForm(input)).toThrow(LiveQuotaPolicyValidationError);
    }
  });

  it("fails closed for malformed stored policies and exposes only normalized legacy referral state", () => {
    expect(parseLiveQuotaPolicy({ affiliateMode: "corrupt", defaultAffiliateCode: "bad code" })).toMatchObject({
      affiliateMode: "disabled",
      defaultAffiliateCode: null,
    });
    expect(allowsLegacyAffiliateAttribution({ affiliateMode: "disabled" })).toBe(false);
    expect(defaultAffiliateCode({ affiliateMode: "enabled", defaultAffiliateCode: "ref-1" })).toBe("REF-1");
    expect(parseLiveQuotaPolicy({ usageAttributionMode: "CUSTOM", customAllocations: "not-json" })).toMatchObject({
      affiliateMode: "disabled",
      usageAttributionMode: "PROMOTER",
      customAllocations: [],
    });
  });

  it("accepts an exact split and custom allocation policy snapshot", () => {
    expect(parseLiveQuotaPolicyForm({
      usageAttributionMode: "SPLIT",
      splitOwnerBps: 3000,
      splitPromoterBps: 7000,
    }).splitOwnerBps).toBe(3000);
    expect(parseLiveQuotaPolicyForm({
      usageAttributionMode: "CUSTOM",
      quotaPayerScope: "MEMBER",
      customAllocations: [
        { teamId: "team-1", membershipId: "member-1", bps: 2500 },
        { teamId: "team-1", membershipId: "member-2", bps: 7500 },
      ],
    }).customAllocations).toEqual([
        { teamId: "team-1", membershipId: "member-1", bps: 2500 },
        { teamId: "team-1", membershipId: "member-2", bps: 7500 },
      ]);
    expect(parseLiveQuotaPolicyForm({
      memberQuotas: [{ teamId: "team-1", membershipId: "member-1", includedMinutes: 60 }],
      pageQuotas: [{ pageId: "page-1", includedMinutes: 120 }],
      quotaPayerScope: "MEMBER",
    })).toMatchObject({
      quotaPayerScope: "MEMBER",
      memberQuotas: [{ teamId: "team-1", membershipId: "member-1", includedMinutes: 60 }],
      pageQuotas: [{ pageId: "page-1", includedMinutes: 120 }],
    });
  });
});
