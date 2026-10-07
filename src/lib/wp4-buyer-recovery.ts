import { Prisma, type PrismaClient, type CommerceOrderItem } from "@prisma/client";
import { createHash } from "node:crypto";
import { WP4_SANDBOX_FIXTURE } from "./wp4-sandbox-fixture";
export const WP4_BUYER_CONTINUATION_SOURCE = "8497ec1ad66a07b0a286585dc050915c998d0f67";
export const WP4_REFUND_RECOVERY_SOURCE = "1052a46d002149b5c06104927ed0fab32b049214";
function checkoutKey(source: string) {
  const hex = createHash("sha256").update(`celebratedeal-mvp-payuni:${source}`, "utf8").digest("hex").slice(0, 32);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20)}`;
}
/** Catalog-owned source is independent from the current deployment SHA. */
export function wp4HistoricalBuyerWhere(source = WP4_BUYER_CONTINUATION_SOURCE) {
  return { vendorId: WP4_SANDBOX_FIXTURE.vendorId, providerName: "payuni", grossAmountCents: 100, currency: "TWD",
    checkoutIdempotencyKey: checkoutKey(source),
    AND: [{ metadata: { path: ["wp4SourceCommit"], equals: source } },
      { metadata: { path: ["billingPurpose"], equals: "buyer_order" } },
      { metadata: { path: ["productId"], equals: WP4_SANDBOX_FIXTURE.productId } },
      { metadata: { path: ["wp4PaymentSubmissionReserved"], equals: true } }],
  };
}
type BuyerItem = Pick<CommerceOrderItem, "productId" | "quantity" | "unitPriceCents" | "lineTotalCents" | "commerceDomain" | "fulfillmentType">;
function isFixedBuyerItem(items: BuyerItem[]) {
  const item = items.length === 1 ? items[0] : null;
  return item?.productId === WP4_SANDBOX_FIXTURE.productId && item.quantity === 1 && item.unitPriceCents === 100
    && item.lineTotalCents === 100 && item.commerceDomain === "merchant" && item.fulfillmentType === "physical";
}
export async function readWp4ExistingBuyerState(db: Pick<PrismaClient, "$transaction">) {
  return db.$transaction(async tx => {
    const payments = await tx.paymentTransaction.findMany({ where: wp4HistoricalBuyerWhere(), take: 2,
      select: { id: true, status: true, orderNumber: true, refundedAmountCents: true } });
    if (payments.length !== 1) return { status: payments.length ? "CANDIDATE_AMBIGUOUS" : "FIXTURE_UNAVAILABLE" };
    const payment = payments[0]!;
    const orders = await tx.commerceOrder.findMany({ where: { vendorId: WP4_SANDBOX_FIXTURE.vendorId, primaryPaymentTransactionId: payment.id },
      select: { id: true, status: true, orderNumber: true, checkoutIdempotencyKey: true, paidAmountCents: true, totalAmountCents: true,
        items: { select: { productId: true, quantity: true, unitPriceCents: true, lineTotalCents: true, commerceDomain: true, fulfillmentType: true } } }, take: 2 });
    if (orders.length !== 1) return { status: "STATE_MISMATCH" };
    const order = orders[0]!;
    if (!isFixedBuyerItem(order.items)
      || order.orderNumber !== payment.orderNumber || order.checkoutIdempotencyKey !== checkoutKey(WP4_BUYER_CONTINUATION_SOURCE)
      || order.paidAmountCents !== 100 || order.totalAmountCents !== 100) return { status: "STATE_MISMATCH" };
    const [paid, inventory, notifications, refunds, orderRefunds] = await Promise.all([
      tx.commerceOrderEvent.count({ where: { vendorId: WP4_SANDBOX_FIXTURE.vendorId, orderId: order.id, eventType: "payment.paid" } }),
      tx.inventoryReservation.count({ where: { vendorId: WP4_SANDBOX_FIXTURE.vendorId, paymentTransactionId: payment.id, productId: WP4_SANDBOX_FIXTURE.productId, quantity: 1,
        // A refunded order must prove its prior commitment and refund restock.
        committedAt: { not: null },
        ...(payment.status === "refunded" && payment.refundedAmountCents === 100
          ? { status: "released", releaseReason: "full_refund", releasedAt: { not: null } }
          : { status: "committed" }),
      } }),
      tx.emailDelivery.count({ where: { vendorId: WP4_SANDBOX_FIXTURE.vendorId, idempotencyKey: `order-paid:v1:${order.id}`, trigger: "order_paid", status: { in: ["queued", "retrying", "sending", "sent"] } } }),
      tx.refundRecord.aggregate({ where: { vendorId: WP4_SANDBOX_FIXTURE.vendorId, paymentTransactionId: payment.id, status: "processed" }, _count: true, _sum: { refundAmountCents: true } }),
      tx.commerceOrderRefund.aggregate({ where: { vendorId: WP4_SANDBOX_FIXTURE.vendorId, orderId: order.id }, _count: true, _sum: { amountCents: true } }),
    ]);
    const refundReconciled = payment.status === "refunded" && payment.refundedAmountCents === 100 && order.status === "refunded"
      && refunds._count === 1 && refunds._sum.refundAmountCents === 100 && orderRefunds._count === 1 && orderRefunds._sum.amountCents === 100;
    const initiallyPaid = payment.status === "paid" && payment.refundedAmountCents === 0 && order.status === "paid" && refunds._count === 0 && orderRefunds._count === 0;
    if (paid !== 1 || inventory !== 1 || notifications !== 1 || (!initiallyPaid && !refundReconciled)) return { status: "STATE_MISMATCH" };
    return { status: "VERIFIED", paymentStatus: refundReconciled ? "REFUNDED" : "PAID", orderPaid: true, inventoryCommitted: true, notificationQueued: true, refundReconciled };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
}
