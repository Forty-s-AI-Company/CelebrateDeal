import { createHash } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { learnerNotificationLink, safeLearnerNotificationLink } from "./learner-notification-links";
import { boundLearnerNotificationText, persistLearnerNotificationSourceEvent, prepareLearnerNotificationSourceEvent, type PreparedLearnerNotificationSource } from "./learner-notification-source-events";

type Store = Pick<Prisma.TransactionClient, "commerceOrder" | "commerceOrderItem" | "learnerNotificationSourceEvent">;
/** Called only after the exact canonical order transitions to paid, in the same
 * transaction. Legacy orders without a recipient identity cannot address a learner.
 * Every message is built, validated and encrypted before the first write; a
 * deterministic notification failure is skipped and never rolls back the payment.
 * Database errors still propagate so the serializable payment transaction retries. */
export async function recordLearnerPaymentNotificationSources(tx: Store, input: {
  vendorId: string; orderId: string; customerKeyHash: string | null; occurredAt: Date;
}) {
  if (input.customerKeyHash === null) return;
  const order = await tx.commerceOrder.findFirst({ where: {
    id: input.orderId, vendorId: input.vendorId, automationCustomerKeyHash: input.customerKeyHash,
    status: "paid", refundedAmountCents: 0,
  }, select: { paidAmountCents: true, totalAmountCents: true } });
  if (!order || order.paidAmountCents !== order.totalAmountCents) return;
  const items = await tx.commerceOrderItem.findMany({
    where: { vendorId: input.vendorId, orderId: input.orderId },
    select: { productId: true, productName: true },
  });
  const path = safeLearnerNotificationLink(() => learnerNotificationLink.notifications(input.vendorId));
  const prepared: PreparedLearnerNotificationSource[] = [];
  for (const item of items) {
    // Deleted products retain order snapshots but have no current notification resource.
    if (item.productId === null) continue;
    const source = prepareLearnerNotificationSourceEvent({
      vendorId: input.vendorId, productId: item.productId, event: "payment_success",
      eventIdentity: createHash("sha256").update(JSON.stringify([input.orderId, item.productId])).digest("hex"),
      audienceCustomerKeyHash: input.customerKeyHash, occurredAt: input.occurredAt,
      message: { paymentOrder: { id: input.orderId }, title: "付款已完成", body: boundLearnerNotificationText(item.productName, 2000, "付款已完成"), path },
    });
    if (source) prepared.push(source);
  }
  for (const source of prepared) await persistLearnerNotificationSourceEvent(tx, source);
}
