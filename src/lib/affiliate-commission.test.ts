import { describe, expect, it } from "vitest";
import {
  AffiliateCommissionRateBps,
  AffiliateProfile,
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
  it("validates and canonicalizes merchant-managed affiliate fields", () => {
    expect(AffiliateProfile.parse({
      name: "  合作夥伴  ",
      code: " partner_1 ",
      source: "newsletter",
      contactEmail: "partner@example.test",
    })).toEqual({
      name: "合作夥伴",
      code: "PARTNER_1",
      source: "newsletter",
      contactEmail: "partner@example.test",
    });
    expect(AffiliateProfile.safeParse({ name: "", code: "x", source: null, contactEmail: null }).success).toBe(false);
    expect(AffiliateProfile.safeParse({ name: "夥伴", code: "x".repeat(81), source: null, contactEmail: null }).success).toBe(false);
    expect(AffiliateProfile.safeParse({ name: "夥伴", code: "x", source: null, contactEmail: "bad-email" }).success).toBe(false);
  });

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

describe("FIN-01 commission lifecycle boundaries", () => {
  it("normalizes source identity and rejects ambiguous dual identities", () => {
    expect(buildCommissionDeduplicationKey({
      affiliateId: " affiliate-a ",
      sourceType: " Provider Event ",
      sourceId: " event-7 ",
    })).toBe(buildCommissionDeduplicationKey({
      affiliateId: "affiliate-a",
      sourceType: "provider_event",
      sourceId: "event-7",
    }));

    expect(() => buildCommissionDeduplicationKey({
      affiliateId: "affiliate-a",
      sourceType: "webhook",
      sourceId: "event-7",
      idempotencyToken: "manual-7",
    })).toThrow("不可同時使用 sourceId 與 idempotency token");
  });

  it("allows only forward commission transitions and an explicit void path", () => {
    expect(canTransitionAffiliateCommission("pending", "void")).toBe(true);
    expect(canTransitionAffiliateCommission("approved", "void")).toBe(true);
    expect(canTransitionAffiliateCommission("locked", "void")).toBe(true);
    expect(canTransitionAffiliateCommission("paid", "void")).toBe(false);
    expect(() => assertAffiliateCommissionTransition("paid", "void")).toThrow(
      "非法佣金狀態轉換：paid -> void",
    );
  });

  it("rounds commission amounts deterministically at half-cent boundaries", () => {
    expect(commissionAmountCents(1, 5_000)).toBe(1);
    expect(commissionAmountCents(3, 5_000)).toBe(2);
    expect(commissionAmountCents(10_001, 1)).toBe(1);
  });

  it("rejects blank beneficiary and source identity fields", () => {
    expect(() => buildCommissionDeduplicationKey({
      affiliateId: "   ",
      sourceType: "webhook",
      sourceId: "event-1",
    })).toThrow("affiliateId 不可為空白");
    expect(() => buildCommissionDeduplicationKey({
      affiliateId: "affiliate-a",
      sourceType: "   ",
      sourceId: "event-1",
    })).toThrow("sourceType 不可為空白");
  });
});
