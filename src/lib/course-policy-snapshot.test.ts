import { describe, expect, it } from "vitest";
import { coursePolicySnapshotFromMetadata, coursePolicySnapshotFromProduct } from "./course-policy-snapshot";

describe("course policy checkout snapshot", () => {
  it("creates a bounded immutable snapshot only for a complete course product", () => {
    expect(coursePolicySnapshotFromProduct({
      id: "product-1", commerceDomain: "course", courseContentOwnerMembershipId: "membership-f",
      coursePromoterShareBps: 2_500, coursePolicyVersion: 7,
    })).toEqual({ productId: "product-1", contentOwnerMembershipId: "membership-f", promoterShareBps: 2_500, policyVersion: 7 });
    expect(coursePolicySnapshotFromProduct({
      id: "product-1", commerceDomain: "merchant", courseContentOwnerMembershipId: null,
      coursePromoterShareBps: null, coursePolicyVersion: 1,
    })).toBeNull();
  });

  it("fails closed for malformed or provider-shaped metadata", () => {
    expect(coursePolicySnapshotFromMetadata({ productId: "product-1", coursePolicySnapshot: { productId: "product-1", contentOwnerMembershipId: "membership-f", promoterShareBps: 0, policyVersion: 1 } })).toBeNull();
    expect(coursePolicySnapshotFromMetadata({ coursePolicySnapshot: { productId: "../../other", contentOwnerMembershipId: "membership-f", promoterShareBps: 2_000, policyVersion: 1 } })).toBeNull();
    expect(coursePolicySnapshotFromMetadata({ productId: "product-1", promoterShareBps: 2_000 })).toBeNull();
  });

  it("ignores extra keys so metadata cannot extend the trusted policy contract", () => {
    expect(coursePolicySnapshotFromMetadata({ coursePolicySnapshot: {
      productId: "product-1", contentOwnerMembershipId: "membership-f", promoterShareBps: 2_000, policyVersion: 1,
      payoutAccountId: "attacker-controlled",
    } })).toBeNull();
  });
});
