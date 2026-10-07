import type { PaymentTransaction, Prisma } from "@prisma/client";

type ProjectionDb = Pick<Prisma.TransactionClient, "vendorSubscription" | "vendorUsageLimit" | "refundRecord">;
type RefundedPayment = Pick<PaymentTransaction, "id" | "vendorId" | "paymentMode" | "status" | "grossAmountCents" | "refundedAmountCents" | "metadata">;
export class PlatformSubscriptionRefundProjectionError extends Error {
  constructor() { super("平台訂閱退款投影與可信付款紀錄不一致。"); this.name = "PlatformSubscriptionRefundProjectionError"; }
}

/** All callers own the enclosing Serializable payment/refund transaction.
 * Provider metadata never selects a subscription: this is the persisted native
 * checkout metadata on the already validated payment row. */
export async function applyPlatformSubscriptionRefundProjection(db: ProjectionDb, payment: RefundedPayment, occurredAt: Date) {
  const metadata = payment.metadata;
  if (payment.paymentMode !== "platform" || metadata === null || typeof metadata !== "object" || Array.isArray(metadata)
    || metadata.billingPurpose !== "platform_subscription_checkout") return null;
  if (payment.status !== "refunded") return null;
  const subscriptionId = metadata.platformSubscriptionId, planId = metadata.billingPlanId;
  if (typeof subscriptionId !== "string" || typeof planId !== "string" || payment.grossAmountCents <= 0
    || payment.refundedAmountCents !== payment.grossAmountCents) throw new PlatformSubscriptionRefundProjectionError();
  const [subscription, processed] = await Promise.all([
    db.vendorSubscription.findFirst({ where: { id: subscriptionId, vendorId: payment.vendorId, planId } }),
    db.refundRecord.aggregate({ where: { vendorId: payment.vendorId, paymentTransactionId: payment.id, status: "processed" }, _sum: { refundAmountCents: true } }),
  ]);
  if (!subscription || processed._sum.refundAmountCents !== payment.grossAmountCents) throw new PlatformSubscriptionRefundProjectionError();
  const updated = subscription.status === "payment_refunded" ? subscription : await db.vendorSubscription.update({
    where: { id: subscription.id, vendorId: payment.vendorId, status: subscription.status }, data: { status: "payment_refunded", endedAt: occurredAt },
  });
  // Refund A can never rewrite the limits/counters of an independently active B.
  const remaining = await db.vendorSubscription.findFirst({ where: { vendorId: payment.vendorId, status: "active" }, select: { id: true } });
  if (!remaining) await db.vendorUsageLimit.upsert({
    where: { vendorId: payment.vendorId },
    create: { vendorId: payment.vendorId, billingPlanId: planId, entitlementStatus: "revoked", resetAt: new Date(Date.UTC(occurredAt.getUTCFullYear(), occurredAt.getUTCMonth() + 1, 1)) },
    update: { entitlementStatus: "revoked" },
  });
  return updated;
}
