import type { Prisma, WebhookEvent } from "@prisma/client";
import type { getDb } from "@/lib/db";
import type { PaymentWebhookPayloadInput } from "@/lib/payment-providers/contract";

type Db = ReturnType<typeof getDb>;

/**
 * The single provider-event identity shared by the payment callback route and
 * the pending-payment reconciler (A-2 05): one WebhookEvent per
 * (provider, eventId). A callback and a reconciler run for the same trade state
 * converge here, and only the one that wins `claimPaymentWebhookEvent` may run
 * the payment pipeline for it.
 */
export async function findOrCreatePaymentWebhookEvent(
  db: Db,
  payload: PaymentWebhookPayloadInput,
  storedPayload: Prisma.InputJsonObject,
) {
  const eventKey = { provider_eventId: { provider: payload.provider, eventId: payload.eventId } };
  const existing = await db.webhookEvent.findUnique({ where: eventKey });
  if (existing) return existing;
  try {
    return await db.webhookEvent.create({
      data: {
        provider: payload.provider,
        eventId: payload.eventId,
        eventType: payload.eventType,
        status: "received",
        maxRetries: 5,
        payload: storedPayload,
      },
    });
  } catch (error) {
    // ReturnURL, NotifyURL and the reconciler can all miss the first read. Only
    // converge a unique-key race when the same provider event is visible after the loss.
    if (typeof error !== "object" || error === null || !("code" in error) || error.code !== "P2002") {
      throw error;
    }
    const raced = await db.webhookEvent.findUnique({ where: eventKey });
    if (!raced) throw error;
    return raced;
  }
}

export type PaymentWebhookEventClaim =
  | { status: "processed"; event: WebhookEvent }
  | { status: "pending"; event: WebhookEvent }
  | { status: "claimed"; event: WebhookEvent; isRetry: boolean };

/**
 * A created event is visible before its first processor finishes. Claim it
 * atomically; a later provider retry (or the reconciler) may reclaim only a
 * failed event that still has retry budget. Every other status is someone
 * else's: `pending` for the caller.
 */
export async function claimPaymentWebhookEvent(db: Db, event: WebhookEvent): Promise<PaymentWebhookEventClaim> {
  if (event.status === "processed") return { status: "processed", event };
  if (event.status !== "received" && event.status !== "failed") return { status: "pending", event };
  if (event.status === "failed" && event.retryCount >= event.maxRetries) return { status: "pending", event };

  const isRetry = event.status === "failed";
  const claimed = await db.webhookEvent.updateMany({
    where: { id: event.id, status: event.status, retryCount: event.retryCount },
    data: {
      status: "retrying",
      retryCount: isRetry ? { increment: 1 } : undefined,
      nextRetryAt: null,
    },
  });
  if (claimed.count !== 1) {
    const latestEvent = await db.webhookEvent.findUnique({ where: { id: event.id } });
    return latestEvent?.status === "processed"
      ? { status: "processed", event: latestEvent }
      : { status: "pending", event: latestEvent ?? event };
  }
  return {
    status: "claimed",
    event: { ...event, status: "retrying", retryCount: event.retryCount + (isRetry ? 1 : 0) },
    isRetry,
  };
}

/**
 * After a claimed processor failed: hand the event to the webhook-retry job
 * (failed, retried in 15 minutes), unless another processor already moved it.
 */
export function releaseFailedPaymentWebhookClaim(db: Db, event: WebhookEvent, isRetry: boolean, errorMessage: string) {
  return db.webhookEvent.updateMany({
    where: { id: event.id, status: "retrying", retryCount: event.retryCount },
    data: {
      status: "failed",
      errorMessage,
      retryCount: isRetry ? undefined : { increment: 1 },
      nextRetryAt: new Date(Date.now() + 1000 * 60 * 15),
    },
  });
}
