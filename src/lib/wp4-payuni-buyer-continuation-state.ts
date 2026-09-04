import type { PrismaClient } from "@prisma/client";
import { WP4_CURRENT_BUYER_CALLBACK_SOURCE_SHA } from "@/lib/wp4-payuni-buyer-callback-retry";
import { wp4PayUniPurposeFromMetadata, wp4SourceCommitFromMetadata } from "@/lib/wp4-payuni-sandbox-reconciliation";
import { WP4_SANDBOX_FIXTURE } from "@/lib/wp4-sandbox-fixture";

export type BuyerContinuationState = {
  status: "VERIFIED" | "UNAVAILABLE" | "AMBIGUOUS";
  paymentStatus: "PENDING" | "PAID" | "REFUNDED" | "UNKNOWN";
  orderPaid: boolean;
  inventoryCommitted: boolean;
  notificationQueued: boolean;
  refundReconciled: boolean;
};
type StateDb = Pick<PrismaClient, "paymentTransaction" | "commerceOrder" | "inventoryReservation" | "emailDelivery" | "commerceOrderRefund">;
const unavailable = (paymentStatus: BuyerContinuationState["paymentStatus"] = "UNKNOWN"): BuyerContinuationState => ({ status: "UNAVAILABLE", paymentStatus, orderPaid: false, inventoryCommitted: false, notificationQueued: false, refundReconciled: false });

export async function readWp4BuyerContinuationState(db: StateDb): Promise<BuyerContinuationState> {
  const rows = await db.paymentTransaction.findMany({
    where: { vendorId: WP4_SANDBOX_FIXTURE.vendorId, providerName: "payuni", status: { in: ["pending", "paid", "refunded"] } },
    select: { id: true, vendorId: true, providerName: true, orderNumber: true, grossAmountCents: true, refundedAmountCents: true, status: true, metadata: true },
  });
  const candidates = rows.filter((row) => row.vendorId === WP4_SANDBOX_FIXTURE.vendorId && row.providerName === "payuni"
    && wp4SourceCommitFromMetadata(row.metadata) === WP4_CURRENT_BUYER_CALLBACK_SOURCE_SHA
    && wp4PayUniPurposeFromMetadata(row.metadata) === "buyer_order"
    && row.metadata && typeof row.metadata === "object" && !Array.isArray(row.metadata)
    && (row.metadata as Record<string, unknown>).productId === WP4_SANDBOX_FIXTURE.productId
    && (row.metadata as Record<string, unknown>).wp4PaymentSubmissionReserved === true
    && row.grossAmountCents === 100 && row.orderNumber);
  if (candidates.length !== 1) return candidates.length > 1 ? { ...unavailable(), status: "AMBIGUOUS" } : unavailable();
  const transaction = candidates[0]!;
  const order = await db.commerceOrder.findFirst({ where: { vendorId: WP4_SANDBOX_FIXTURE.vendorId, orderNumber: transaction.orderNumber!, primaryPaymentTransactionId: transaction.id }, select: { id: true, status: true, paidAmountCents: true, totalAmountCents: true, refundedAmountCents: true } });
  const reservation = await db.inventoryReservation.findUnique({ where: { paymentTransactionId: transaction.id }, select: { vendorId: true, productId: true, status: true } });
  if (!order || !reservation) return unavailable(transaction.status === "paid" ? "PAID" : transaction.status === "refunded" ? "REFUNDED" : "PENDING");
  const notificationQueued = await db.emailDelivery.count({ where: { vendorId: WP4_SANDBOX_FIXTURE.vendorId, idempotencyKey: `order-paid:v1:${order.id}`, status: { in: ["queued", "sent"] } } }) > 0;
  const refundReconciled = transaction.status === "refunded" && transaction.refundedAmountCents === 100
    && order.status === "refunded" && order.refundedAmountCents === 100
    && reservation.vendorId === WP4_SANDBOX_FIXTURE.vendorId && reservation.productId === WP4_SANDBOX_FIXTURE.productId
    && await db.commerceOrderRefund.count({ where: { vendorId: WP4_SANDBOX_FIXTURE.vendorId, orderId: order.id, paymentTransactionId: transaction.id, amountCents: 100, status: "processed" } }) > 0;
  const paymentStatus = transaction.status === "paid" ? "PAID" : transaction.status === "refunded" ? "REFUNDED" : "PENDING";
  const orderPaid = order.paidAmountCents === 100 && order.totalAmountCents === 100 && ["paid", "refunded"].includes(order.status);
  const inventoryCommitted = reservation.vendorId === WP4_SANDBOX_FIXTURE.vendorId && reservation.productId === WP4_SANDBOX_FIXTURE.productId && reservation.status === "committed";
  // Paid and refunded evidence must describe the same lifecycle phase.
  const paidConsistent = paymentStatus === "PAID" && transaction.refundedAmountCents === 0
    && order.status === "paid" && order.refundedAmountCents === 0;
  const verified = orderPaid && inventoryCommitted && notificationQueued && (paidConsistent || refundReconciled);
  return { status: verified ? "VERIFIED" : "UNAVAILABLE", paymentStatus, orderPaid, inventoryCommitted, notificationQueued, refundReconciled };
}
