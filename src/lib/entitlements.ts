import type { BillingPlan, VendorSubscription, VendorUsageLimit } from "@prisma/client";
import { getDb } from "@/lib/db";

export type EntitlementOperation =
  | "vendor_write"
  | "video_create"
  | "video_update"
  | "direct_upload"
  | "live_input"
  | "live_create"
  | "live_update"
  | "live_publish"
  | "form_create"
  | "form_update"
  | "affiliate_create"
  | "affiliate_update";

export type EntitlementReason =
  | "no_subscription"
  | "subscription_inactive"
  | "subscription_expired"
  | "quota_unavailable"
  | "quota_exceeded";

export class VendorEntitlementError extends Error {
  constructor(
    public readonly reason: EntitlementReason,
    public readonly operation: EntitlementOperation,
  ) {
    super(`Vendor entitlement denied: ${reason} (${operation})`);
    this.name = "VendorEntitlementError";
  }
}

type SubscriptionWithPlan = VendorSubscription & { plan: BillingPlan };

type EntitlementContext = {
  subscription: SubscriptionWithPlan | null;
  usageLimit: VendorUsageLimit | null;
  liveCount: number;
  affiliateCount: number;
};

export type EntitlementDecision =
  | { allowed: true; overage: boolean; subscriptionStatus: string }
  | { allowed: false; reason: EntitlementReason; subscriptionStatus: string | null };

function activeSubscriptionDecision(subscription: SubscriptionWithPlan | null, now: Date): EntitlementDecision {
  if (!subscription) return { allowed: false, reason: "no_subscription", subscriptionStatus: null };
  if (!["active", "trialing"].includes(subscription.status)) {
    return { allowed: false, reason: "subscription_inactive", subscriptionStatus: subscription.status };
  }
  if (subscription.endedAt && subscription.endedAt <= now) {
    return { allowed: false, reason: "subscription_expired", subscriptionStatus: subscription.status };
  }
  if (subscription.status === "trialing" && !subscription.endedAt) {
    return { allowed: false, reason: "subscription_expired", subscriptionStatus: subscription.status };
  }
  return { allowed: true, overage: false, subscriptionStatus: subscription.status };
}

function hardUsageQuota(
  usageLimit: VendorUsageLimit | null,
  used: number,
  limit: number | undefined,
  requestedUnits: number,
): EntitlementDecision | null {
  if (!usageLimit || !limit || limit <= 0) {
    return { allowed: false, reason: "quota_unavailable", subscriptionStatus: null };
  }
  if (used + requestedUnits > limit) {
    return { allowed: false, reason: "quota_exceeded", subscriptionStatus: null };
  }
  return null;
}

export function evaluateVendorEntitlement(
  context: EntitlementContext,
  operation: EntitlementOperation,
  now: Date,
  requestedUnits = 0,
): EntitlementDecision {
  const subscriptionDecision = activeSubscriptionDecision(context.subscription, now);
  if (!subscriptionDecision.allowed) return subscriptionDecision;

  const subscription = context.subscription;
  if (!subscription) return { allowed: false, reason: "no_subscription", subscriptionStatus: null };
  const { plan } = subscription;
  if (operation === "direct_upload" || operation === "video_create") {
    const denied = hardUsageQuota(
      context.usageLimit,
      context.usageLimit?.storageMinutesUsed ?? 0,
      context.usageLimit?.storageMinutesLimit,
      Math.max(1, requestedUnits),
    );
    if (denied) return { ...denied, subscriptionStatus: subscription.status };
  }
  if (operation === "live_input" || operation === "live_publish") {
    const denied = hardUsageQuota(
      context.usageLimit,
      context.usageLimit?.creditsUsed ?? 0,
      context.usageLimit?.creditsLimit,
      Math.max(1, requestedUnits),
    );
    if (denied) return { ...denied, subscriptionStatus: subscription.status };
  }
  if (operation === "live_create" && context.liveCount >= plan.includedEvents) {
    if (plan.overflowEventUnitPriceCents <= 0) {
      return { allowed: false, reason: plan.includedEvents > 0 ? "quota_exceeded" : "quota_unavailable", subscriptionStatus: subscription.status };
    }
    return { allowed: true, overage: true, subscriptionStatus: subscription.status };
  }
  if (operation === "affiliate_create" && context.affiliateCount >= plan.includedAffiliates) {
    if (plan.overflowAffiliateUnitPriceCents <= 0) {
      return { allowed: false, reason: plan.includedAffiliates > 0 ? "quota_exceeded" : "quota_unavailable", subscriptionStatus: subscription.status };
    }
    return { allowed: true, overage: true, subscriptionStatus: subscription.status };
  }

  return subscriptionDecision;
}

export async function getVendorEntitlementDecision(
  vendorId: string,
  operation: EntitlementOperation,
  options: { now?: Date; requestedUnits?: number } = {},
) {
  const now = options.now ?? new Date();
  const db = getDb();
  const [subscription, usageLimit, liveCount, affiliateCount] = await Promise.all([
    db.vendorSubscription.findFirst({
      where: { vendorId, startedAt: { lte: now } },
      include: { plan: true },
      orderBy: [{ startedAt: "desc" }, { createdAt: "desc" }],
    }),
    db.vendorUsageLimit.findUnique({ where: { vendorId } }),
    operation === "live_create" ? db.live.count({ where: { vendorId } }) : Promise.resolve(0),
    operation === "affiliate_create" ? db.affiliate.count({ where: { vendorId } }) : Promise.resolve(0),
  ]);

  return evaluateVendorEntitlement(
    { subscription, usageLimit, liveCount, affiliateCount },
    operation,
    now,
    options.requestedUnits,
  );
}

export async function assertVendorEntitlement(
  vendorId: string,
  operation: EntitlementOperation,
  options: { now?: Date; requestedUnits?: number } = {},
) {
  const decision = await getVendorEntitlementDecision(vendorId, operation, options);
  if (!decision.allowed) throw new VendorEntitlementError(decision.reason, operation);
  return decision;
}

export async function auditEntitlementDenial(input: {
  vendorId: string;
  actorId?: string | null;
  actorLabel: string;
  error: VendorEntitlementError;
  targetType?: string;
  targetId?: string | null;
}) {
  const db = getDb();
  const vendor = await db.vendor.findUnique({ where: { id: input.vendorId }, select: { id: true } });
  if (!vendor) return;
  await db.auditLog.create({
    data: {
      vendorId: vendor.id,
      actorId: input.actorId ?? null,
      actorLabel: input.actorLabel,
      action: "entitlement_denied",
      targetType: input.targetType ?? "VendorSubscription",
      targetId: input.targetId ?? vendor.id,
      after: { reason: input.error.reason, operation: input.error.operation },
    },
  });
}
