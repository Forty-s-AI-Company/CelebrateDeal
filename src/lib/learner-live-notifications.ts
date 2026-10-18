import { createHash } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { learnerNotificationLink, safeLearnerNotificationLink } from "./learner-notification-links";
import { boundLearnerNotificationText, persistLearnerNotificationSourceEvent, prepareLearnerNotificationSourceEvent, type PreparedLearnerNotificationSource } from "./learner-notification-source-events";

type Store = Pick<Prisma.TransactionClient, "live" | "liveProduct" | "learnerNotificationSourceEvent">;
/** Read only the exact active session and its persisted course bindings inside
 * the owner's lifecycle transaction. Each new session has a separate identity.
 * Messages are prepared before any write; a deterministic failure is skipped and
 * reported, never thrown out of the live lifecycle transaction. */
export async function recordLearnerLiveStartedSources(tx: Store, input: { vendorId: string; liveId: string; startedAt: Date }) {
  const live = await tx.live.findFirst({
    where: { vendorId: input.vendorId, id: input.liveId, status: "live", startedAt: input.startedAt, endedAt: null },
    select: { id: true, title: true },
  });
  if (!live) return;
  const products = await tx.liveProduct.findMany({
    where: { vendorId: input.vendorId, liveId: live.id, isVisible: true, product: { commerceDomain: "course", fulfillmentType: "course" } },
    select: { productId: true },
  });
  // The live slug may be CJK; the link carries only the opaque live ID.
  const path = safeLearnerNotificationLink(() => learnerNotificationLink.live(input.vendorId, live.id));
  const prepared: PreparedLearnerNotificationSource[] = [];
  for (const { productId } of products) {
    const source = prepareLearnerNotificationSourceEvent({
      vendorId: input.vendorId, productId, event: "live_started", audienceCustomerKeyHash: null, occurredAt: input.startedAt,
      eventIdentity: createHash("sha256").update(JSON.stringify([live.id, input.startedAt.toISOString()])).digest("hex"),
      message: { title: "課程直播已開始", body: boundLearnerNotificationText(live.title, 2000, "課程直播已開始"), path,
        liveSession: { id: live.id, startedAt: input.startedAt.toISOString() } },
    });
    if (source) prepared.push(source);
  }
  for (const source of prepared) await persistLearnerNotificationSourceEvent(tx, source);
}
