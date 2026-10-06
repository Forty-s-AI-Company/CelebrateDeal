import { createHash } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { recordLearnerNotificationSourceEvent } from "./learner-notification-source-events";

type Store = Pick<Prisma.TransactionClient, "vendor" | "commerceOrderItem" | "learnerNotificationSourceEvent">;
/** Called only after the exact canonical order transitions to paid, in the same
 * transaction. Legacy orders without a recipient identity cannot address a learner. */
export async function recordLearnerPaymentNotificationSources(tx: Store, input: {
  vendorId: string; orderId: string; customerKeyHash: string | null; occurredAt: Date;
}) {
  if (input.customerKeyHash === null) return;
  const items = await tx.commerceOrderItem.findMany({
    where: { vendorId: input.vendorId, orderId: input.orderId, commerceDomain: "course", fulfillmentType: "course" },
    select: { productId: true, productName: true },
  });
  if (!items.length) return;
  const vendor = await tx.vendor.findUniqueOrThrow({ where: { id: input.vendorId }, select: { slug: true } });
  for (const item of items) {
    // Deleted products retain order snapshots but have no remaining learning resource.
    if (item.productId === null) continue;
    await recordLearnerNotificationSourceEvent(tx, {
      vendorId: input.vendorId, productId: item.productId, event: "payment_success",
      eventIdentity: createHash("sha256").update(JSON.stringify([input.orderId, item.productId])).digest("hex"),
      audienceCustomerKeyHash: input.customerKeyHash, occurredAt: input.occurredAt,
      message: { title: "課程付款已完成", body: item.productName, path: `/portal/${vendor.slug}/learn/${item.productId}` },
    });
  }
}
