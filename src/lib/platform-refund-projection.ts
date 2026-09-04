import type { PaymentTransaction, Prisma } from "@prisma/client";

type RefundProjectionTransaction = Pick<PaymentTransaction,
  "id" | "vendorId" | "paymentMode" | "grossAmountCents" | "currency" | "status" | "refundedAmountCents" | "refundedAt" | "metadata"
>;

type ProjectionResult = {
  subscription: { id: string; status: string } | null;
  invoice: { id: string; status: string } | null;
};

export class PlatformRefundProjectionConflictError extends Error {
  constructor(public readonly reason: "payment_mode" | "subscription_identity" | "subscription_amount" | "subscription_state" | "invoice_identity" | "invoice_amount" | "invoice_state") {
    super(`Platform refund projection conflict: ${reason}`);
  }
}

function metadataObject(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function metadataString(metadata: Record<string, unknown>, key: string) {
  const value = metadata[key];
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function isFullRefund(transaction: RefundProjectionTransaction) {
  return transaction.status === "refunded"
    && transaction.grossAmountCents > 0
    && transaction.refundedAmountCents === transaction.grossAmountCents;
}

function isPartialRefund(transaction: RefundProjectionTransaction) {
  return transaction.status === "partially_refunded"
    && transaction.grossAmountCents > 0
    && transaction.refundedAmountCents > 0
    && transaction.refundedAmountCents < transaction.grossAmountCents;
}

function hasTrustedSubscriptionAmountSnapshot(transaction: RefundProjectionTransaction) {
  // Platform plan checkout writes this server-owned price snapshot before the
  // provider is contacted. Do not compare against BillingPlan.monthlyPrice:
  // plan prices are mutable after payment and cannot prove a historical fee.
  return Number.isSafeInteger(transaction.grossAmountCents)
    && transaction.grossAmountCents > 0
    && transaction.currency === "TWD";
}

/**
 * Applies only the non-ledger consequences of a confirmed platform refund.
 *
 * The caller must pass the payment row re-read and updated in its enclosing
 * Serializable transaction. Provider payloads are intentionally not inputs:
 * the only identity source is metadata already stored by a server checkout.
 */
// The branches are distinct financial invariants. Splitting them would make
// it easier for a caller to bypass the common transaction-bound projection.
// eslint-disable-next-line complexity
export async function applyPlatformRefundProjection(
  tx: Prisma.TransactionClient,
  transaction: RefundProjectionTransaction,
  occurredAt: Date,
): Promise<ProjectionResult> {
  const none: ProjectionResult = { subscription: null, invoice: null };
  if (!isFullRefund(transaction) && !isPartialRefund(transaction)) return none;

  const metadata = metadataObject(transaction.metadata);
  if (!metadata) return none;
  const purpose = metadataString(metadata, "billingPurpose");
  if (purpose !== "platform_subscription_checkout" && purpose !== "invoice_payment") return none;
  if (transaction.paymentMode !== "platform") {
    throw new PlatformRefundProjectionConflictError("payment_mode");
  }

  if (purpose === "platform_subscription_checkout") {
    const subscriptionId = metadataString(metadata, "platformSubscriptionId");
    const planId = metadataString(metadata, "billingPlanId");
    if (!subscriptionId || !planId) throw new PlatformRefundProjectionConflictError("subscription_identity");
    if (!hasTrustedSubscriptionAmountSnapshot(transaction)) {
      throw new PlatformRefundProjectionConflictError("subscription_amount");
    }

    const subscription = await tx.vendorSubscription.findUnique({
      where: { id: subscriptionId },
      select: { id: true, vendorId: true, planId: true, paymentMode: true, status: true },
    });
    if (
      !subscription
      || subscription.vendorId !== transaction.vendorId
      || subscription.paymentMode !== "platform"
      || subscription.planId !== planId
    ) {
      throw new PlatformRefundProjectionConflictError("subscription_identity");
    }

    // Partial refunds are verified but deliberately retain the current plan
    // and quota. This still rejects forged identities before a caller reports
    // a completed refund as safely projected.
    if (isPartialRefund(transaction)) return none;
    if (!["active", "ended", "payment_superseded", "payment_refunded"].includes(subscription.status)) {
      throw new PlatformRefundProjectionConflictError("subscription_state");
    }

    // This exact subscription is the only subscription a historical payment
    // may terminate. In particular, never end or de-quota a newer plan.
    if (subscription.status !== "payment_refunded") {
      const ended = await tx.vendorSubscription.updateMany({
        where: {
          id: subscription.id,
          vendorId: transaction.vendorId,
          planId,
          paymentMode: "platform",
          status: { in: ["active", "ended", "payment_superseded"] },
        },
        data: { status: "payment_refunded", endedAt: occurredAt },
      });
      if (ended.count !== 1) throw new PlatformRefundProjectionConflictError("subscription_state");
    }

    const otherActiveSubscription = await tx.vendorSubscription.findFirst({
      where: {
        vendorId: transaction.vendorId,
        status: "active",
        id: { not: subscription.id },
      },
      select: { id: true },
    });
    if (!otherActiveSubscription) {
      // VendorUsageLimit has no subscription foreign key. It is safe to clear
      // it only when it still names this refunded plan and no other plan is
      // active for the tenant. Usage measurements themselves are retained.
      const usageLimit = await tx.vendorUsageLimit.findUnique({ where: { vendorId: transaction.vendorId } });
      if (
        usageLimit?.billingPlanId === planId
        && (usageLimit.streamMinutesLimit !== 0 || usageLimit.storageMinutesLimit !== 0 || usageLimit.creditsLimit !== 0)
      ) {
        await tx.vendorUsageLimit.updateMany({
          where: { vendorId: transaction.vendorId, billingPlanId: planId },
          data: {
            billingPlanId: null,
            streamMinutesLimit: 0,
            storageMinutesLimit: 0,
            creditsLimit: 0,
          },
        });
      }
    }
    return { subscription: { id: subscription.id, status: "payment_refunded" }, invoice: null };
  }

  const invoiceId = metadataString(metadata, "invoiceId");
  if (!invoiceId) throw new PlatformRefundProjectionConflictError("invoice_identity");

  const invoice = await tx.invoice.findFirst({
    where: { id: invoiceId, vendorId: transaction.vendorId },
  });
  if (!invoice) throw new PlatformRefundProjectionConflictError("invoice_identity");
  if (invoice.totalCents !== transaction.grossAmountCents) {
    throw new PlatformRefundProjectionConflictError("invoice_amount");
  }

  if (isPartialRefund(transaction)) {
    if (invoice.status === "partially_refunded") return { subscription: null, invoice: { id: invoice.id, status: invoice.status } };
    if (invoice.status !== "paid") throw new PlatformRefundProjectionConflictError("invoice_state");
    const updated = await tx.invoice.updateMany({
      where: {
        id: invoice.id,
        vendorId: transaction.vendorId,
        totalCents: transaction.grossAmountCents,
        status: "paid",
      },
      data: { status: "partially_refunded" },
    });
    if (updated.count !== 1) throw new PlatformRefundProjectionConflictError("invoice_state");
    return { subscription: null, invoice: { id: invoice.id, status: "partially_refunded" } };
  }

  if (invoice.status === "refunded") return { subscription: null, invoice: { id: invoice.id, status: invoice.status } };
  if (!["paid", "partially_refunded"].includes(invoice.status)) {
    throw new PlatformRefundProjectionConflictError("invoice_state");
  }
  const updated = await tx.invoice.updateMany({
    where: {
      id: invoice.id,
      vendorId: transaction.vendorId,
      totalCents: transaction.grossAmountCents,
      status: { in: ["paid", "partially_refunded"] },
    },
    data: { status: "refunded" },
  });
  if (updated.count !== 1) throw new PlatformRefundProjectionConflictError("invoice_state");
  return { subscription: null, invoice: { id: invoice.id, status: "refunded" } };
}
