import type { PrismaClient } from "@prisma/client";
import { createLiveViewerUrl } from "@/lib/live-public-url";
import {
  buildLiveLineMessage,
  enqueueLineNotification,
  processDueLineDeliveries,
  stableLineIdempotencyKey,
} from "@/lib/line-notification";

const DISPATCH_BATCH_SIZE = 50;

function formatStart(value: Date) {
  return new Intl.DateTimeFormat("zh-TW", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Taipei",
  }).format(value);
}

/**
 * Queues and eagerly dispatches the one-per-session live-started notification.
 * The durable outbox and provider retry key make action retries converge safely.
 */
export async function dispatchLiveStartedLineNotifications(
  db: PrismaClient,
  input: { vendorId: string; liveId: string; startedAt: Date },
) {
  const live = await db.live.findFirst({
    where: { id: input.liveId, vendorId: input.vendorId, status: "live", startedAt: input.startedAt, endedAt: null },
    select: { id: true, slug: true, title: true, startedAt: true },
  });
  if (!live?.startedAt) return { queued: 0, sent: 0, failed: 0 };

  const submissions = await db.formSubmission.findMany({
    where: {
      liveId: live.id,
      verificationStatus: "VERIFIED",
      form: { vendorId: input.vendorId },
    },
    select: { id: true },
    orderBy: { id: "asc" },
  });
  const viewerUrl = createLiveViewerUrl(live.slug);
  const deliveryIds: string[] = [];
  for (const submission of submissions) {
    const queued = await enqueueLineNotification(db, {
      vendorId: input.vendorId,
      subjectType: "buyer_registration",
      subjectId: submission.id,
      trigger: "live_started",
      idempotencyKey: stableLineIdempotencyKey(["live_started", live.id, submission.id, live.startedAt]),
      messages: [buildLiveLineMessage({
        kind: "started",
        liveTitle: live.title,
        startsAtText: formatStart(live.startedAt),
        viewerUrl,
      })],
      dueAt: input.startedAt,
    });
    if ((queued.status === "queued" || queued.status === "duplicate") && queued.deliveryId) {
      deliveryIds.push(queued.deliveryId);
    }
  }

  const results = [];
  for (let offset = 0; offset < deliveryIds.length; offset += DISPATCH_BATCH_SIZE) {
    const batch = deliveryIds.slice(offset, offset + DISPATCH_BATCH_SIZE);
    results.push(...await processDueLineDeliveries(db, undefined, input.startedAt, {
      vendorId: input.vendorId,
      deliveryIds: batch,
    }));
  }
  return {
    queued: deliveryIds.length,
    sent: results.filter((result) => result.status === "sent").length,
    failed: results.filter((result) => result.status === "failed" || result.status === "exhausted").length,
  };
}
