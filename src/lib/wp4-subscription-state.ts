import { Prisma, type PrismaClient } from "@prisma/client";
import { WP4_SANDBOX_FIXTURE } from "./wp4-sandbox-fixture";
/** One repeatable snapshot verifies payment, subscription, refund and entitlement. */
export async function readWp4SubscriptionState(db: Pick<PrismaClient, "$transaction">, sourceSha: string) {
  return db.$transaction(async (tx) => {
    const payments = await tx.paymentTransaction.findMany({ where: {
      vendorId: WP4_SANDBOX_FIXTURE.vendorId, providerName: "payuni", paymentMode: "platform", grossAmountCents: 100, currency: "TWD",
      AND: [{ metadata: { path: ["wp4SourceCommit"], equals: sourceSha } },
        { metadata: { path: ["billingPurpose"], equals: "platform_subscription_checkout" } },
        { metadata: { path: ["billingPlanId"], equals: WP4_SANDBOX_FIXTURE.planId } }],
    }, select: { id: true, status: true, metadata: true, refundedAmountCents: true }, take: 2 });
    if (payments.length !== 1) return { status: payments.length ? "CANDIDATE_AMBIGUOUS" : "FIXTURE_UNAVAILABLE" };
    const payment = payments[0]!;
    const metadata = payment.metadata;
    if (!metadata || typeof metadata !== "object" || Array.isArray(metadata) || typeof metadata.platformSubscriptionId !== "string") return { status: "STATE_MISMATCH" };
    const [subscription, usage, active, refund] = await Promise.all([
      tx.vendorSubscription.findFirst({ where: { id: metadata.platformSubscriptionId, vendorId: WP4_SANDBOX_FIXTURE.vendorId, planId: WP4_SANDBOX_FIXTURE.planId } }),
      tx.vendorUsageLimit.findUnique({ where: { vendorId: WP4_SANDBOX_FIXTURE.vendorId } }),
      tx.vendorSubscription.count({ where: { vendorId: WP4_SANDBOX_FIXTURE.vendorId, status: "active" } }),
      tx.refundRecord.aggregate({ where: { vendorId: WP4_SANDBOX_FIXTURE.vendorId, paymentTransactionId: payment.id, status: "processed" }, _sum: { refundAmountCents: true }, _count: true }),
    ]);
    if (!subscription || !usage) return { status: "STATE_MISMATCH" };
    if (payment.status === "paid" && payment.refundedAmountCents === 0 && subscription.status === "active" && active === 1
      && usage.billingPlanId === WP4_SANDBOX_FIXTURE.planId && usage.entitlementStatus === "active" && usage.streamMinutesLimit === 10
      && refund._count === 0) return { status: "ACTIVE_VERIFIED" };
    if (payment.status === "refunded" && payment.refundedAmountCents === 100 && subscription.status === "payment_refunded"
      && subscription.endedAt !== null && active === 0 && usage.entitlementStatus === "revoked"
      && refund._count === 1 && refund._sum.refundAmountCents === 100) return { status: "REFUNDED_VERIFIED" };
    return { status: "STATE_MISMATCH" };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
}
