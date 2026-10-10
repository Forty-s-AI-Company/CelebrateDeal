import { createHash } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { recordLearnerNotificationSourceEvent } from "./learner-notification-source-events";

type Store = Pick<Prisma.TransactionClient, "live" | "liveProduct" | "learnerNotificationSourceEvent">;
/** Read only the exact active session and its persisted course bindings inside
 * the owner's lifecycle transaction. Each new session has a separate identity. */
export async function recordLearnerLiveStartedSources(tx: Store, input: { vendorId: string; liveId: string; startedAt: Date }) {
  const live = await tx.live.findFirst({
    where: { vendorId: input.vendorId, id: input.liveId, status: "live", startedAt: input.startedAt, endedAt: null },
    select: { id: true, slug: true, title: true },
  });
  if (!live) return;
  const products = await tx.liveProduct.findMany({
    where: { vendorId: input.vendorId, liveId: live.id, isVisible: true, product: { commerceDomain: "course", fulfillmentType: "course" } },
    select: { productId: true },
  });
  for (const { productId } of products) {
    await recordLearnerNotificationSourceEvent(tx, {
      vendorId: input.vendorId, productId, event: "live_started", audienceCustomerKeyHash: null, occurredAt: input.startedAt,
      eventIdentity: createHash("sha256").update(JSON.stringify([live.id, input.startedAt.toISOString()])).digest("hex"),
      message: { title: "課程直播已開始", body: live.title, path: `/live/${encodeURIComponent(live.slug)}`,
        liveSession: { id: live.id, startedAt: input.startedAt.toISOString() } },
    });
  }
}
