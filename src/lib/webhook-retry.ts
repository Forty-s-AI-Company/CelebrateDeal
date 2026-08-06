import { auditSnapshot, writeAuditLog } from "@/lib/audit";
import { getDb } from "@/lib/db";
import { captureOperationalError } from "@/lib/monitoring";
import { classifyPaymentWebhookFailure, paymentWebhookFailureMessage } from "@/lib/payment-webhook-errors";
import { PaymentWebhookPayload, processPaymentWebhook } from "@/lib/payment-webhooks";

const WEBHOOK_RETRY_LEASE_MS = 1000 * 60 * 10;

function nextRetryDate() {
  return new Date(Date.now() + 1000 * 60 * 15);
}

type RetryableWebhookEvent = {
  id: string;
  vendorId: string | null;
  provider: string;
  status: string;
  retryCount: number;
  maxRetries: number;
  updatedAt: Date;
};

/**
 * Reclaims only a retry claim whose owner has stopped making progress. The
 * `updatedAt` fence prevents an old scan from changing a claim a newer worker
 * has already touched. This recovers the next scheduling opportunity; it does
 * not pretend to cancel a still-running processor call.
 */
export async function recoverStaleWebhookRetryClaim(event: RetryableWebhookEvent, now = new Date()) {
  const db = getDb();
  if (event.status !== "retrying") return { status: "not_retrying" as const, event };
  if (event.updatedAt > new Date(now.getTime() - WEBHOOK_RETRY_LEASE_MS)) {
    return { status: "not_stale" as const, event };
  }

  const exhausted = event.retryCount >= event.maxRetries;
  const recovered = await db.webhookEvent.updateMany({
    where: {
      id: event.id,
      status: "retrying",
      retryCount: event.retryCount,
      updatedAt: event.updatedAt,
    },
    data: exhausted
      ? {
          status: "exhausted",
          nextRetryAt: null,
          errorMessage: "Webhook retry lease expired after maximum retries",
        }
      : {
          status: "failed",
          nextRetryAt: now,
          errorMessage: "Webhook retry lease expired",
        },
  });

  if (recovered.count !== 1) return { status: "claimed_elsewhere" as const, event };
  if (exhausted) return { status: "exhausted" as const, event };
  return retryWebhookEvent(event.id);
}

export async function retryWebhookEvent(eventId: string, actorLabel = "job:webhook-retry") {
  const db = getDb();
  const event = await db.webhookEvent.findUnique({ where: { id: eventId } });
  if (!event) return { status: "missing" as const };
  if (event.retryCount >= event.maxRetries) {
    const exhausted = await db.webhookEvent.updateMany({
      where: { id: event.id, status: "failed", retryCount: event.retryCount, updatedAt: event.updatedAt },
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
      updatedAt: event.updatedAt,
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
    captureOperationalError(error, {
      source: "webhook_retry",
      operation: "retry_claim",
      provider: event.provider,
      status,
    });
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
  const leaseCutoff = new Date(now.getTime() - WEBHOOK_RETRY_LEASE_MS);
  const staleRetryingEvents = await db.webhookEvent.findMany({
    where: {
      status: "retrying",
      updatedAt: { lte: leaseCutoff },
    },
    orderBy: { updatedAt: "asc" },
    take: limit,
  });

  const results = [];
  for (const event of staleRetryingEvents) {
    const result = await recoverStaleWebhookRetryClaim(event, now);
    results.push({ eventId: event.id, status: result.status });
  }

  const remaining = Math.max(0, limit - results.length);
  if (remaining === 0) return results;

  const events = await db.webhookEvent.findMany({
    where: {
      status: "failed",
      nextRetryAt: { lte: now },
    },
    orderBy: { nextRetryAt: "asc" },
    take: remaining,
  });

  for (const event of events) {
    const result = await retryWebhookEvent(event.id);
    results.push({ eventId: event.id, status: result.status });
  }

  return results;
}
