import type { Prisma } from "@prisma/client";

type ReleaseDb = Pick<Prisma.TransactionClient, "paymentTransaction" | "postPurchaseCredit">;

/**
 * The demo provider never creates a remote trade, so its original manual
 * session stays locally resumable and keeps its credit bound. Every other
 * provider's issued session cannot be resumed once its payment is terminal.
 */
export function postPurchaseCreditStaysBound(payment: { providerName: string; providerTradeNo: string | null }) {
  return payment.providerName === "demo" && payment.providerTradeNo === null;
}

/**
 * Called in the same serializable transaction that finalizes a checkout as
 * provider-failed or expired. Returns the source credit only when neither the
 * payment nor its order recorded any money; the database trigger re-checks
 * this and revokes target delivery so a late payment can never use the credit.
 */
export async function releasePostPurchaseCreditForTerminalPayment(
  tx: ReleaseDb,
  input: { vendorId: string; paymentTransactionId: string; now: Date },
) {
  const payment = await tx.paymentTransaction.findFirst({
    where: { id: input.paymentTransactionId, vendorId: input.vendorId },
    select: {
      status: true, providerName: true, providerTradeNo: true, refundedAmountCents: true,
      primaryCommerceOrder: { select: { id: true, vendorId: true, status: true, paidAmountCents: true, refundedAmountCents: true } },
    },
  });
  const order = payment?.primaryCommerceOrder;
  if (!payment || !order || order.vendorId !== input.vendorId) return false;
  const terminalUnpaid = (payment.status === "failed" && order.status === "payment_failed")
    || (payment.status === "expired" && order.status === "expired");
  if (!terminalUnpaid || payment.refundedAmountCents !== 0 || order.paidAmountCents !== 0
    || order.refundedAmountCents !== 0 || postPurchaseCreditStaysBound(payment)) return false;
  const released = await tx.postPurchaseCredit.updateMany({
    where: { vendorId: input.vendorId, targetOrderId: order.id, releasedAt: null, invalidatedAt: null, supersededAt: null },
    data: { releasedAt: input.now },
  });
  return released.count === 1;
}
