import type { Prisma } from "@prisma/client";
import { revealCommerceOrderPii } from "@/lib/commerce-order-pii";
import { protectEmailDeliveryPayload } from "@/lib/email-delivery-pii";

const SYSTEM_ORDER_PAID_TEMPLATE_ID = "system_order_paid_v1";

/**
 * Queues one encrypted transactional receipt for a paid commerce order.
 * The unique idempotency key makes duplicate provider callbacks converge on
 * the same delivery without exposing buyer contact data in event metadata.
 */
export async function ensureCommerceOrderPaidDelivery(
  db: Prisma.TransactionClient,
  input: { vendorId: string; paymentTransactionId: string; occurredAt: Date },
) {
  const order = await db.commerceOrder.findFirst({
    where: {
      vendorId: input.vendorId,
      primaryPaymentTransactionId: input.paymentTransactionId,
      status: "paid",
    },
    select: {
      id: true,
      orderNumber: true,
      buyerEncryptedEnvelope: true,
      shippingEncryptedEnvelope: true,
      items: { orderBy: { lineIndex: "asc" }, select: { productName: true } },
      vendor: { select: { name: true, senderName: true, supportEmail: true, contactUrl: true } },
    },
  });
  if (!order) return { status: "not_applicable" as const };

  const pii = revealCommerceOrderPii({
    buyerEncrypted: order.buyerEncryptedEnvelope,
    shippingEncrypted: order.shippingEncryptedEnvelope,
  }, { vendorId: input.vendorId, orderId: order.id });
  const deliveryId = `order_paid_${order.id}`;
  const idempotencyKey = `order-paid:v1:${order.id}`;
  const productSummary = order.items.map((item) => item.productName).join("、").slice(0, 500);
  const protectedPayload = protectEmailDeliveryPayload({
    recipientEmail: pii.buyer.email,
    subject: `付款成功｜訂單 ${order.orderNumber}`,
    body: `${pii.buyer.name} 您好：\n\n${order.vendor.name} 已確認收到訂單 ${order.orderNumber} 的付款。\n商品：${productSummary}\n\n請使用原結帳瀏覽器開啟 CelebrateDeal 的「我的訂單」查看交付內容；如需協助，請聯絡商家客服。`,
    brand: order.vendor,
  }, { vendorId: input.vendorId, deliveryId });

  const existing = await db.emailDelivery.findUnique({
    where: { vendorId_idempotencyKey: { vendorId: input.vendorId, idempotencyKey } },
    select: { id: true, status: true },
  });
  if (existing) return { status: "existing" as const, deliveryId: existing.id };

  const delivery = await db.emailDelivery.create({
    data: {
      id: deliveryId,
      vendorId: input.vendorId,
      sourceTemplateId: SYSTEM_ORDER_PAID_TEMPLATE_ID,
      trigger: "order_paid",
      ...protectedPayload,
      idempotencyKey,
      status: "queued",
      nextAttemptAt: input.occurredAt,
    },
    select: { id: true },
  });
  return { status: "queued" as const, deliveryId: delivery.id };
}
