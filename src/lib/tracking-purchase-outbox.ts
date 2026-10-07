import type { Prisma } from "@prisma/client";

/** Private payment-domain entry: call inside the same transaction as paid state. */
export async function enqueuePaidPurchaseTracking(
  tx: Pick<Prisma.TransactionClient, "trackingSetting" | "commerceOrder" | "trackingDelivery">,
  input: { vendorId: string; paymentTransactionId: string },
) {
  const setting = await tx.trackingSetting.findUnique({ where: { vendorId: input.vendorId } });
  if (!setting?.enablePurchaseEvent || !setting.facebookPixelId || !setting.facebookAccessTokenEncrypted) return null;
  const order = await tx.commerceOrder.findFirst({
    where: {
      vendorId: input.vendorId, primaryPaymentTransactionId: input.paymentTransactionId,
      status: "paid", refundedAmountCents: 0,
      primaryPaymentTransaction: { status: "paid", vendorId: input.vendorId },
    },
    select: { id: true, totalAmountCents: true, paidAmountCents: true, paidAt: true },
  });
  if (!order || !order.paidAt || order.totalAmountCents <= 0 || order.paidAmountCents !== order.totalAmountCents) return null;
  // Stable across different webhook event IDs: provider retries cannot invent
  // additional purchases. A transaction rollback also removes this queue row.
  return tx.trackingDelivery.upsert({
    where: { vendorId_eventId: { vendorId: input.vendorId, eventId: `purchase:${input.paymentTransactionId}` } },
    create: {
      vendorId: input.vendorId, orderId: order.id, eventId: `purchase:${input.paymentTransactionId}`,
      credentialRevision: setting.credentialRevision, pixelId: setting.facebookPixelId,
      testEventCode: setting.facebookTestEventCode,
    },
    update: {},
  });
}
