import { describe, expect, it } from "vitest";
import type { BillingPlan, VendorSubscription, VendorUsageLimit } from "@prisma/client";
import { evaluateVendorEntitlement } from "@/lib/entitlements";

const now = new Date("2026-07-11T00:00:00Z");

function context(overrides: {
  status?: string;
  endedAt?: Date | null;
  includedEvents?: number;
  includedAffiliates?: number;
  overflowEventUnitPriceCents?: number;
  liveCount?: number;
  affiliateCount?: number;
  storageLimit?: number;
  storageUsed?: number;
  creditsLimit?: number;
  creditsUsed?: number;
} = {}) {
  const plan = {
    includedEvents: overrides.includedEvents ?? 3,
    includedAffiliates: overrides.includedAffiliates ?? 5,
    overflowEventUnitPriceCents: overrides.overflowEventUnitPriceCents ?? 0,
    overflowAffiliateUnitPriceCents: 0,
  } as BillingPlan;
  const subscription = {
    status: overrides.status ?? "active",
    endedAt: overrides.endedAt ?? null,
    plan,
  } as VendorSubscription & { plan: BillingPlan };
  const usageLimit = {
    storageMinutesLimit: overrides.storageLimit ?? 120,
    storageMinutesUsed: overrides.storageUsed ?? 20,
    creditsLimit: overrides.creditsLimit ?? 1000,
    creditsUsed: overrides.creditsUsed ?? 100,
  } as VendorUsageLimit;
  return {
    subscription,
    usageLimit,
    liveCount: overrides.liveCount ?? 0,
    affiliateCount: overrides.affiliateCount ?? 0,
  };
}

describe("vendor entitlement evaluation", () => {
  it.each(["expired", "suspended", "canceled"])("denies write access for %s subscriptions", (status) => {
    expect(evaluateVendorEntitlement(context({ status }), "vendor_write", now)).toMatchObject({
      allowed: false,
      reason: "subscription_inactive",
    });
  });

  it("allows an unexpired trial and denies an expired trial", () => {
    expect(evaluateVendorEntitlement(context({ status: "trialing", endedAt: new Date("2026-07-18T00:00:00Z") }), "form_create", now).allowed).toBe(true);
    expect(evaluateVendorEntitlement(context({ status: "trialing", endedAt: now }), "form_create", now)).toMatchObject({ allowed: false, reason: "subscription_expired" });
  });

  it("denies direct upload and publishing when hard usage quota is exhausted", () => {
    expect(evaluateVendorEntitlement(context({ storageLimit: 120, storageUsed: 119 }), "direct_upload", now, 2)).toMatchObject({ allowed: false, reason: "quota_exceeded" });
    expect(evaluateVendorEntitlement(context({ creditsLimit: 1000, creditsUsed: 1000 }), "live_publish", now, 1)).toMatchObject({ allowed: false, reason: "quota_exceeded" });
  });

  it("allows configured event overage but denies a hard event limit", () => {
    expect(evaluateVendorEntitlement(context({ includedEvents: 1, liveCount: 1, overflowEventUnitPriceCents: 2500 }), "live_create", now)).toMatchObject({ allowed: true, overage: true });
    expect(evaluateVendorEntitlement(context({ includedEvents: 1, liveCount: 1, overflowEventUnitPriceCents: 0 }), "live_create", now)).toMatchObject({ allowed: false, reason: "quota_exceeded" });
  });
});
