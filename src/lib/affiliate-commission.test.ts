import { describe, expect, it } from "vitest";
import {
  AffiliateCommissionRateBps,
  AffiliateCommissionStatus,
  assertAffiliateCommissionAmounts,
  assertAffiliateCommissionTransition,
  buildCommissionDeduplicationKey,
  canonicalizeCommissionIdempotencyToken,
  canTransitionAffiliateCommission,
  commissionAmountCents,
  MAX_COMMISSION_RATE_BPS,
} from "@/lib/affiliate-commission";

describe("affiliate commission invariants", () => {
  it.each([0, 1, 500, MAX_COMMISSION_RATE_BPS])("accepts the bounded rate %s", (rate) => {
    expect(AffiliateCommissionRateBps.parse(rate)).toBe(rate);
  });

  it.each([-1, 10_001, 1.5, Number.NaN])("rejects the invalid rate %s", (rate) => {
    expect(AffiliateCommissionRateBps.safeParse(rate).success).toBe(false);
  });

  it("never produces a commission larger than the nonnegative order amount", () => {
    expect(commissionAmountCents(12_345, 10_000)).toBe(12_345);
    expect(() => commissionAmountCents(-1, 500)).toThrow();
  });

  it("builds the same non-secret key for a canonical provider source", () => {
    const key = buildCommissionDeduplicationKey({
      affiliateId: "affiliate-a",
      sourceType: " Webhook ",
      sourceId: " provider-event-1 ",
    });
    expect(key).toBe(buildCommissionDeduplicationKey({
      affiliateId: "affiliate-a",
      sourceType: "webhook",
      sourceId: "provider-event-1",
    }));
    expect(key).toMatch(/^commission:v1\|sha256:[a-f0-9]{64}$/);
    expect(key).not.toContain("provider-event-1");
  });

  it("requires a stable token for a NULL source and normalizes token formatting", () => {
    expect(() => buildCommissionDeduplicationKey({
      affiliateId: null,
      sourceType: "manual",
      sourceId: null,
    })).toThrow("idempotency token");
    expect(canonicalizeCommissionIdempotencyToken("  AbC__ 123 ")).toBe("abc-123");
    expect(buildCommissionDeduplicationKey({
      affiliateId: null,
      sourceType: "manual",
      idempotencyToken: " AbC__ 123 ",
    })).toBe(buildCommissionDeduplicationKey({
      affiliateId: null,
      sourceType: "manual",
      idempotencyToken: "abc-123",
    }));
  });

  it("keeps beneficiary scope inside the identity", () => {
    const common = { sourceType: "webhook", sourceId: "event-1" };
    expect(buildCommissionDeduplicationKey({ ...common, affiliateId: "affiliate-a" }))
      .not.toBe(buildCommissionDeduplicationKey({ ...common, affiliateId: "affiliate-b" }));
    expect(buildCommissionDeduplicationKey({ ...common, affiliateId: "affiliate-a" }))
      .not.toBe(buildCommissionDeduplicationKey({ ...common, affiliateId: null }));
  });

  it("uses the closed status set and rejects terminal or backward transitions", () => {
    expect(AffiliateCommissionStatus.options).toEqual(["pending", "approved", "locked", "paid", "void"]);
    expect(canTransitionAffiliateCommission("pending", "approved")).toBe(true);
    expect(canTransitionAffiliateCommission("approved", "locked")).toBe(true);
    expect(canTransitionAffiliateCommission("locked", "paid")).toBe(true);
    expect(canTransitionAffiliateCommission("paid", "void")).toBe(false);
    expect(() => assertAffiliateCommissionTransition("void", "pending")).toThrow();
  });

  it("enforces non-refund and refund amount ranges", () => {
    expect(() => assertAffiliateCommissionAmounts({
      sourceType: "webhook", orderAmountCents: 100, commissionAmountCents: 101,
    })).toThrow();
    expect(() => assertAffiliateCommissionAmounts({
      sourceType: "refund_adjustment", orderAmountCents: -100, commissionAmountCents: -10,
    })).not.toThrow();
    expect(() => assertAffiliateCommissionAmounts({
      sourceType: "refund_adjustment", orderAmountCents: -100, commissionAmountCents: 1,
    })).toThrow();
  });
});
