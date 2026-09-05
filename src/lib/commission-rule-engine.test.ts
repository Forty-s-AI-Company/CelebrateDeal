import { describe, expect, it } from "vitest";
import {
  allocateCommissionAmounts,
  calculateCommissionPlan,
  CommissionCapExceededError,
  parseCommissionRule,
} from "@/lib/commission-rule-engine";

const rule = {
  maxTotalRateBps: 2_000,
  tiers: [
    { minMonthlySalesCents: 0, rateBps: 800 },
    { minMonthlySalesCents: 100_000, rateBps: 1_000 },
    { minMonthlySalesCents: 300_000, rateBps: 1_200 },
  ],
  uplineLevels: [
    { level: 1, bonusRateBps: 300 },
    { level: 2, bonusRateBps: 200 },
  ],
} as const;

describe("commission rule engine", () => {
  it("includes the paid order when selecting an upgraded monthly tier", () => {
    const plan = calculateCommissionPlan({
      grossAmountCents: 20_000,
      monthlySalesBeforeCents: 90_000,
      promoterAffiliateId: "affiliate-promoter",
      uplines: [],
      rule,
    });

    expect(plan.selectedTier).toEqual({ minMonthlySalesCents: 100_000, rateBps: 1_000 });
    expect(plan.monthlySalesAfterCents).toBe(110_000);
    expect(plan.totalAmountCents).toBe(2_000);
  });

  it("allocates configured leader bonuses and keeps rounding within the cap", () => {
    const plan = calculateCommissionPlan({
      grossAmountCents: 101,
      monthlySalesBeforeCents: 300_000,
      promoterAffiliateId: "affiliate-promoter",
      promoterMembershipId: "member-promoter",
      uplines: [
        { affiliateId: "affiliate-leader-1", membershipId: "member-leader-1", level: 1 },
        { affiliateId: "affiliate-leader-2", membershipId: "member-leader-2", level: 2 },
      ],
      rule,
    });

    expect(plan.totalRateBps).toBe(1_700);
    expect(plan.totalAmountCents).toBe(17);
    expect(plan.beneficiaries).toEqual([
      expect.objectContaining({ affiliateId: "affiliate-promoter", recipientRole: "promoter", rateBps: 1_200, amountCents: 12 }),
      expect.objectContaining({ affiliateId: "affiliate-leader-1", recipientRole: "upline_leader", uplineLevel: 1, amountCents: 3 }),
      expect.objectContaining({ affiliateId: "affiliate-leader-2", recipientRole: "upline_leader", uplineLevel: 2, amountCents: 2 }),
    ]);
  });

  it("rejects a configuration whose maximum tier plus bonuses exceeds the cap", () => {
    expect(() => parseCommissionRule({
      ...rule,
      maxTotalRateBps: 1_600,
    })).toThrow(CommissionCapExceededError);
  });

  it("rejects unordered tiers and non-contiguous upline levels", () => {
    expect(() => parseCommissionRule({
      ...rule,
      tiers: [{ minMonthlySalesCents: 10, rateBps: 500 }],
    })).toThrow("第一個分潤階梯門檻必須為 0");
    expect(() => parseCommissionRule({
      ...rule,
      uplineLevels: [{ level: 2, bonusRateBps: 100 }],
    })).toThrow("層級必須從 1 開始且連續");
  });

  it("distributes refund rounding once across all beneficiaries", () => {
    expect(allocateCommissionAmounts(101, [1200, 300, 200])).toEqual([12, 3, 2]);
    expect(allocateCommissionAmounts(1, [5000, 5000])).toEqual([1, 0]);
  });
});
