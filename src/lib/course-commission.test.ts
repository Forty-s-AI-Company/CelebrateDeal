import { describe, expect, it } from "vitest";
import {
  calculateCourseAllocationPlan,
  calculateCourseRefundDistribution,
} from "@/lib/course-commission";

describe("course F/G allocation policy", () => {
  it("allocates a direct F sale entirely to F without inventing G", () => {
    const plan = calculateCourseAllocationPlan({
      grossAmountCents: 100_000,
      policyVersion: 3,
      contentOwnerMembershipId: "member-f",
      promoterMembershipId: null,
      promoterShareBps: 2_000,
    });

    expect(plan).toEqual({
      grossAmountCents: 100_000,
      policyVersion: 3,
      allocations: [{
        recipientMembershipId: "member-f",
        recipientRole: "content_owner",
        shareBps: 10_000,
        amountCents: 100_000,
      }],
    });
  });

  it("allocates a G sale to only the configured F and actual G", () => {
    const plan = calculateCourseAllocationPlan({
      grossAmountCents: 100_001,
      policyVersion: 1,
      contentOwnerMembershipId: "member-f",
      promoterMembershipId: "member-g1",
      promoterShareBps: 2_000,
    });

    expect(plan.allocations).toEqual([
      { recipientMembershipId: "member-f", recipientRole: "content_owner", shareBps: 8_000, amountCents: 80_001 },
      { recipientMembershipId: "member-g1", recipientRole: "promoter", shareBps: 2_000, amountCents: 20_000 },
    ]);
    expect(plan.allocations.reduce((sum, allocation) => sum + allocation.amountCents, 0)).toBe(100_001);
    expect(plan.allocations.map((allocation) => allocation.recipientMembershipId)).not.toContain("member-g2");
  });

  it("rejects an invalid split and refuses zero-cent recipients", () => {
    expect(() => calculateCourseAllocationPlan({
      grossAmountCents: 100,
      policyVersion: 1,
      contentOwnerMembershipId: "member-f",
      promoterMembershipId: "member-g",
      promoterShareBps: 10_001,
    })).toThrow();

    expect(() => calculateCourseAllocationPlan({
      grossAmountCents: 1,
      policyVersion: 1,
      contentOwnerMembershipId: "member-f",
      promoterMembershipId: "member-g",
      promoterShareBps: 1,
    })).toThrow(/正整數/);
  });

  it("refunds by the immutable share snapshot and keeps the event total exact", () => {
    const distribution = calculateCourseRefundDistribution(1, [
      { recipientRole: "content_owner", shareBps: 8_000, currentBalanceCents: 80_001 },
      { recipientRole: "promoter", shareBps: 2_000, currentBalanceCents: 20_000 },
    ]);

    expect(distribution).toEqual([
      { recipientRole: "content_owner", shareBps: 8_000, currentBalanceCents: 80_001, amountCents: 1 },
      { recipientRole: "promoter", shareBps: 2_000, currentBalanceCents: 20_000, amountCents: 0 },
    ]);
    expect(distribution.reduce((sum, allocation) => sum + allocation.amountCents, 0)).toBe(1);
  });

  it("does not permit a refund to exceed the remaining snapshot ledger", () => {
    expect(() => calculateCourseRefundDistribution(101, [
      { recipientRole: "content_owner", shareBps: 8_000, currentBalanceCents: 80 },
      { recipientRole: "promoter", shareBps: 2_000, currentBalanceCents: 20 },
    ])).toThrow(/餘額/);
  });
});
