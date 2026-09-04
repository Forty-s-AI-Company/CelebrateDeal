import type { PrismaClient } from "@prisma/client";
import {
  isWp4PayUniSandboxTransactionForSource,
  wp4PayUniPurposeFromMetadata,
} from "@/lib/wp4-payuni-sandbox-reconciliation";
import { WP4_SANDBOX_FIXTURE } from "@/lib/wp4-sandbox-fixture";

export type Wp4PayUniSubscriptionState =
  | "ACTIVE_VERIFIED"
  | "REFUNDED_VERIFIED"
  | "STATE_UNVERIFIED";

type StateDb = Pick<PrismaClient, "paymentTransaction" | "vendorSubscription" | "vendorUsageLimit">;

function metadataObject(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

/**
 * Reads only the fixed current-source SaaS transaction and its projected state.
 * It accepts no caller-owned transaction, vendor, plan, or subscription id.
 */
export async function verifyWp4PayUniSubscriptionState(
  db: StateDb,
  sourceCommit: string,
): Promise<Wp4PayUniSubscriptionState> {
  const rows = await db.paymentTransaction.findMany({
    where: {
      vendorId: WP4_SANDBOX_FIXTURE.vendorId,
      providerName: "payuni",
      status: { in: ["paid", "refunded", "partially_refunded"] },
    },
    select: { vendorId: true, providerName: true, grossAmountCents: true, status: true, metadata: true },
  });
  const candidates = rows.filter((row) => {
    const metadata = metadataObject(row.metadata);
    return isWp4PayUniSandboxTransactionForSource(row, sourceCommit)
      && wp4PayUniPurposeFromMetadata(metadata) === "platform_subscription"
      && typeof metadata?.platformSubscriptionId === "string"
      && metadata.platformSubscriptionId.length > 0;
  });
  if (candidates.length !== 1) return "STATE_UNVERIFIED";

  const candidate = candidates[0]!;
  const metadata = metadataObject(candidate.metadata)!;
  const subscriptionId = metadata.platformSubscriptionId as string;
  const subscription = await db.vendorSubscription.findUnique({
    where: { id: subscriptionId },
    select: {
      vendorId: true,
      planId: true,
      paymentMode: true,
      status: true,
      plan: { select: { includedStreamMinutes: true, includedStorageMinutes: true, includedCredits: true } },
    },
  });
  if (!subscription
    || subscription.vendorId !== WP4_SANDBOX_FIXTURE.vendorId
    || subscription.planId !== WP4_SANDBOX_FIXTURE.planId
    || subscription.paymentMode !== "platform") return "STATE_UNVERIFIED";

  const usageLimit = await db.vendorUsageLimit.findUnique({
    where: { vendorId: WP4_SANDBOX_FIXTURE.vendorId },
    select: { billingPlanId: true, streamMinutesLimit: true, storageMinutesLimit: true, creditsLimit: true },
  });

  if (candidate.status === "paid") {
    if (!subscription.plan) return "STATE_UNVERIFIED";
    return subscription.status === "active"
      && usageLimit?.billingPlanId === WP4_SANDBOX_FIXTURE.planId
      && usageLimit.streamMinutesLimit === subscription.plan.includedStreamMinutes
      && usageLimit.storageMinutesLimit === subscription.plan.includedStorageMinutes
      && usageLimit.creditsLimit === subscription.plan.includedCredits
      ? "ACTIVE_VERIFIED"
      : "STATE_UNVERIFIED";
  }

  if (candidate.status !== "refunded" || subscription.status !== "payment_refunded") return "STATE_UNVERIFIED";
  const otherActive = await db.vendorSubscription.findMany({
    where: { vendorId: WP4_SANDBOX_FIXTURE.vendorId, status: "active", id: { not: subscriptionId } },
    take: 2,
    select: {
      planId: true,
      plan: { select: { includedStreamMinutes: true, includedStorageMinutes: true, includedCredits: true } },
    },
  });
  // The existing refund projection clears this plan's quota only when no newer
  // active subscription exists. With another active plan, preserve its quota.
  if (otherActive.length > 1) return "STATE_UNVERIFIED";
  if (otherActive.length === 1) {
    const replacement = otherActive[0]!;
    return replacement.plan
      && usageLimit?.billingPlanId === replacement.planId
      && usageLimit.streamMinutesLimit === replacement.plan.includedStreamMinutes
      && usageLimit.storageMinutesLimit === replacement.plan.includedStorageMinutes
      && usageLimit.creditsLimit === replacement.plan.includedCredits
      ? "REFUNDED_VERIFIED"
      : "STATE_UNVERIFIED";
  }
  return usageLimit === null
    || (usageLimit.billingPlanId === null
      && usageLimit.streamMinutesLimit === 0
      && usageLimit.storageMinutesLimit === 0
      && usageLimit.creditsLimit === 0)
    ? "REFUNDED_VERIFIED"
    : "STATE_UNVERIFIED";
}
