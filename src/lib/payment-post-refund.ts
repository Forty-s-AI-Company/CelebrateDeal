import type { PaymentTransaction, Prisma, PrismaClient } from "@prisma/client";

import { applyPaymentInventoryTransition } from "@/lib/inventory-reservations";
import { reconcileElectronicInvoiceAfterPayment } from "@/lib/taiwan-electronic-invoice";

/**
 * F-045 (B03-10): the single post-refund hook shared by the provider webhook
 * and the admin PayUni refund path. Whichever path records a completed
 * refund must run both halves:
 *
 * 1. `applyPostRefundInTransaction` inside the same serializable transaction
 *    that writes the RefundRecord and calls `applyPaymentRefundAccounting`:
 *    it releases the inventory reservation on a full refund (a partial refund
 *    keeps stock committed). Post-purchase credits are handled by that same
 *    accounting call: it raises the canonical CommerceOrder
 *    `refundedAmountCents`, and the `CommerceOrder_post_purchase_refund_guard`
 *    trigger invalidates or flags the linked credit in the same transaction.
 *    The hook complements the accounting call; it never replaces it.
 * 2. `applyPostRefundAfterCommit` after the transaction committed: queues the
 *    electronic-invoice void or allowance. It never throws, because an invoice
 *    adapter or queue outage must not undo or mask a committed refund.
 */
export type PostRefundEventType = "refunded" | "partially_refunded";

export type PostRefundCommerceOrderRefund = {
  orderId: string;
  refundId: string;
  refundedAmountCents?: number | null;
} | null | undefined;

export function postRefundEventType(refundedAmountCents: number, grossAmountCents: number): PostRefundEventType {
  return refundedAmountCents >= grossAmountCents ? "refunded" : "partially_refunded";
}

export async function applyPostRefundInTransaction(
  tx: Prisma.TransactionClient,
  input: {
    transaction: Pick<PaymentTransaction, "id" | "vendorId">;
    eventType: PostRefundEventType;
    /** Metadata of the server-created checkout row, read before this refund. */
    trustedCheckoutMetadata: unknown;
    occurredAt: Date;
  },
) {
  return applyPaymentInventoryTransition(tx, {
    transaction: input.transaction,
    eventType: input.eventType,
    trustedCheckoutMetadata: input.trustedCheckoutMetadata,
    now: input.occurredAt,
  });
}

export async function applyPostRefundAfterCommit(
  db: Pick<PrismaClient, "commerceOrder" | "electronicInvoice" | "electronicInvoiceAllowance">,
  input: {
    vendorId: string;
    paymentTransactionId: string;
    eventType: PostRefundEventType;
    occurredAt: Date;
    refundAmountCents: number;
    /** Transaction refunded total before this refund; used when the order result omits it. */
    previousRefundedAmountCents: number;
    commerceOrderRefund: PostRefundCommerceOrderRefund;
  },
) {
  const refund = input.commerceOrderRefund;
  if (!refund) return null;
  try {
    return await reconcileElectronicInvoiceAfterPayment(db, {
      vendorId: input.vendorId,
      paymentTransactionId: input.paymentTransactionId,
      eventType: input.eventType,
      occurredAt: input.occurredAt,
      refund: {
        id: refund.refundId,
        orderId: refund.orderId,
        amountCents: input.refundAmountCents,
        cumulativeAmountCents: refund.refundedAmountCents ?? input.previousRefundedAmountCents + input.refundAmountCents,
      },
    });
  } catch {
    // The committed refund and its CommerceOrderRefund stay authoritative;
    // queued invoice work is retried by the electronic-invoice job.
    return null;
  }
}
