import { describe, expect, it } from "vitest";
import { verifyWp4PayUniSubscriptionState } from "./wp4-payuni-subscription-state";

const source = "a".repeat(40);
const subscriptionId = "wp4-subscription-v1";
const basePlan = { includedStreamMinutes: 10, includedStorageMinutes: 0, includedCredits: 0 };

function dbFor(options: { paymentStatus?: string; paymentRows?: unknown[]; subscriptionStatus?: string; subscriptionVendorId?: string; usage?: unknown; otherActive?: unknown[] } = {}) {
  const subscription = { vendorId: options.subscriptionVendorId ?? "wp4_synthetic_vendor_v1", planId: "wp4_synthetic_plan_v1", paymentMode: "platform", status: options.subscriptionStatus ?? "active", plan: basePlan };
  const paymentRows = options.paymentRows ?? [{ vendorId: "wp4_synthetic_vendor_v1", providerName: "payuni", grossAmountCents: 100, status: options.paymentStatus ?? "paid", metadata: { wp4SourceCommit: source, billingPurpose: "platform_subscription_checkout", platformSubscriptionId: subscriptionId, billingPlanId: "wp4_synthetic_plan_v1" } }];
  return {
    paymentTransaction: { findMany: async () => paymentRows },
    vendorSubscription: { findUnique: async () => subscription, findMany: async () => options.otherActive ?? [] },
    vendorUsageLimit: { findUnique: async () => options.usage === undefined ? { billingPlanId: "wp4_synthetic_plan_v1", streamMinutesLimit: 10, storageMinutesLimit: 0, creditsLimit: 0 } : options.usage },
  } as never;
}

describe("verifyWp4PayUniSubscriptionState", () => {
  it("verifies active subscription and exact included quota", async () => {
    await expect(verifyWp4PayUniSubscriptionState(dbFor(), source)).resolves.toBe("ACTIVE_VERIFIED");
  });
  it("fails closed when activation or quota is incomplete", async () => {
    await expect(verifyWp4PayUniSubscriptionState(dbFor({ subscriptionStatus: "pending_payment" }), source)).resolves.toBe("STATE_UNVERIFIED");
    await expect(verifyWp4PayUniSubscriptionState(dbFor({ usage: { billingPlanId: "wp4_synthetic_plan_v1", streamMinutesLimit: 9, storageMinutesLimit: 0, creditsLimit: 0 } }), source)).resolves.toBe("STATE_UNVERIFIED");
  });
  it("verifies refund convergence with a unique replacement plan", async () => {
    await expect(verifyWp4PayUniSubscriptionState(dbFor({ paymentStatus: "refunded", subscriptionStatus: "payment_refunded", usage: { billingPlanId: "replacement-plan", streamMinutesLimit: 20, storageMinutesLimit: 3, creditsLimit: 4 }, otherActive: [{ planId: "replacement-plan", plan: { includedStreamMinutes: 20, includedStorageMinutes: 3, includedCredits: 4 } }] }), source)).resolves.toBe("REFUNDED_VERIFIED");
  });
  it("rejects missing or incorrect replacement quota and ambiguous replacements", async () => {
    const replacement = { planId: "replacement-plan", plan: { includedStreamMinutes: 20, includedStorageMinutes: 3, includedCredits: 4 } };
    await expect(verifyWp4PayUniSubscriptionState(dbFor({ paymentStatus: "refunded", subscriptionStatus: "payment_refunded", usage: null, otherActive: [replacement] }), source)).resolves.toBe("STATE_UNVERIFIED");
    await expect(verifyWp4PayUniSubscriptionState(dbFor({ paymentStatus: "refunded", subscriptionStatus: "payment_refunded", usage: { billingPlanId: "replacement-plan", streamMinutesLimit: 1, storageMinutesLimit: 3, creditsLimit: 4 }, otherActive: [replacement] }), source)).resolves.toBe("STATE_UNVERIFIED");
    await expect(verifyWp4PayUniSubscriptionState(dbFor({ paymentStatus: "refunded", subscriptionStatus: "payment_refunded", usage: { billingPlanId: "replacement-plan", streamMinutesLimit: 20, storageMinutesLimit: 3, creditsLimit: 4 }, otherActive: [replacement, replacement] }), source)).resolves.toBe("STATE_UNVERIFIED");
  });
  it("requires cleared quota after refund when no replacement remains", async () => {
    await expect(verifyWp4PayUniSubscriptionState(dbFor({ paymentStatus: "refunded", subscriptionStatus: "payment_refunded", usage: { billingPlanId: null, streamMinutesLimit: 0, storageMinutesLimit: 0, creditsLimit: 0 } }), source)).resolves.toBe("REFUNDED_VERIFIED");
    await expect(verifyWp4PayUniSubscriptionState(dbFor({ paymentStatus: "refunded", subscriptionStatus: "payment_refunded" }), source)).resolves.toBe("STATE_UNVERIFIED");
  });
  it("rejects cross-source, cross-tenant, and multiple payment candidates", async () => {
    const row = { vendorId: "wp4_synthetic_vendor_v1", providerName: "payuni", grossAmountCents: 100, status: "paid", metadata: { wp4SourceCommit: source, billingPurpose: "platform_subscription_checkout", platformSubscriptionId: subscriptionId, billingPlanId: "wp4_synthetic_plan_v1" } };
    await expect(verifyWp4PayUniSubscriptionState(dbFor({ paymentRows: [{ ...row, vendorId: "other-vendor" }] }), source)).resolves.toBe("STATE_UNVERIFIED");
    await expect(verifyWp4PayUniSubscriptionState(dbFor({ paymentRows: [{ ...row, metadata: { ...row.metadata, wp4SourceCommit: "b".repeat(40) } }] }), source)).resolves.toBe("STATE_UNVERIFIED");
    await expect(verifyWp4PayUniSubscriptionState(dbFor({ paymentRows: [row, row] }), source)).resolves.toBe("STATE_UNVERIFIED");
  });
});
