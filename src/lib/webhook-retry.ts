import { auditSnapshot, writeAuditLog } from "@/lib/audit";
import { getDb } from "@/lib/db";
import { classifyPaymentWebhookFailure, paymentWebhookFailureMessage } from "@/lib/payment-webhook-errors";
import { PaymentWebhookPayload, processPaymentWebhook } from "@/lib/payment-webhooks";

function nextRetryDate() {
  return new Date(Date.now() + 1000 * 60 * 15);
}

export async function retryWebhookEvent(eventId: string, actorLabel = "job:webhook-retry") {
  const db = getDb();
  const event = await db.webhookEvent.findUnique({ where: { id: eventId } });
  if (!event) return { status: "missing" as const };
  if (event.retryCount >= event.maxRetries) {
    const exhausted = await db.webhookEvent.updateMany({
      where: { id: event.id, status: "failed", retryCount: event.retryCount },
      data: { status: "exhausted", nextRetryAt: null },
    });
    if (exhausted.count !== 1) return { status: "claimed_elsewhere" as const, event };
    return { status: "exhausted" as const, event };
  }

  const claimedRetryCount = event.retryCount + 1;
  const claimed = await db.webhookEvent.updateMany({
    where: {
      id: event.id,
      status: "failed",
      retryCount: event.retryCount,
    },
    data: {
      status: "retrying",
      retryCount: { increment: 1 },
      nextRetryAt: null,
    },
  });
  if (claimed.count !== 1) return { status: "claimed_elsewhere" as const, event };

  const claimedEvent = {
    ...event,
    status: "retrying",
    retryCount: claimedRetryCount,
    nextRetryAt: null,
  };
  const eventPayload = event.payload as { normalized?: unknown };
  const parsed = PaymentWebhookPayload.safeParse(eventPayload.normalized ?? event.payload);
  if (!parsed.success) {
    const status = claimedRetryCount >= event.maxRetries ? "exhausted" : "failed";
    const finalized = await db.webhookEvent.updateMany({
      where: { id: event.id, status: "retrying", retryCount: claimedRetryCount },
      data: {
        status,
        errorMessage: "Stored payload is invalid",
        nextRetryAt: status === "exhausted" ? null : nextRetryDate(),
      },
    });
    if (finalized.count !== 1) return { status: "claimed_elsewhere" as const, event: claimedEvent };
    return { status, event };
  }

  try {
    const result = await processPaymentWebhook(parsed.data, claimedEvent);
    await db.webhookEvent.updateMany({
      where: { id: event.id, status: "processed", retryCount: claimedRetryCount },
      data: { nextRetryAt: null, errorMessage: null },
    });
    await writeAuditLog({
      vendorId: result.vendor.id,
      actorLabel,
      action: "retry_webhook_event",
      targetType: "WebhookEvent",
      targetId: event.id,
      before: auditSnapshot(claimedEvent),
      after: auditSnapshot(result),
    });
    return { status: "processed" as const, event: claimedEvent, result };
  } catch (error) {
    const status = claimedRetryCount >= event.maxRetries ? "exhausted" : "failed";
    const errorCode = classifyPaymentWebhookFailure(error);
    const message = paymentWebhookFailureMessage(errorCode);
    const finalized = await db.webhookEvent.updateMany({
      where: { id: event.id, status: "retrying", retryCount: claimedRetryCount },
      data: {
        status,
        errorMessage: message,
        nextRetryAt: status === "exhausted" ? null : nextRetryDate(),
      },
    });
    if (finalized.count !== 1) return { status: "claimed_elsewhere" as const, event: claimedEvent };
    await writeAuditLog({
      vendorId: event.vendorId,
      actorLabel,
      action: status === "exhausted" ? "webhook_retry_exhausted" : "webhook_retry_failed",
      targetType: "WebhookEvent",
      targetId: event.id,
      before: auditSnapshot(claimedEvent),
      after: auditSnapshot({ errorCode, status }),
    });
    return { status, event: claimedEvent, error: message, errorCode };
  }
}

export async function processDueWebhookRetries(limit = 20) {
  const db = getDb();
  const now = new Date();
  const events = await db.webhookEvent.findMany({
    where: {
      status: "failed",
      nextRetryAt: { lte: now },
    },
    orderBy: { nextRetryAt: "asc" },
    take: limit,
  });

  const results = [];
  for (const event of events) {
    const result = await retryWebhookEvent(event.id);
    results.push({ eventId: event.id, status: result.status });
  }

  return results;
}
