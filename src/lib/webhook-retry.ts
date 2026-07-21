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
    await db.webhookEvent.update({ where: { id: event.id }, data: { status: "exhausted", nextRetryAt: null } });
    return { status: "exhausted" as const, event };
  }

  const eventPayload = event.payload as { normalized?: unknown };
  const parsed = PaymentWebhookPayload.safeParse(eventPayload.normalized ?? event.payload);
  if (!parsed.success) {
    const updatedRetryCount = event.retryCount + 1;
    const status = updatedRetryCount >= event.maxRetries ? "exhausted" : "failed";
    await db.webhookEvent.update({
      where: { id: event.id },
      data: {
        status,
        errorMessage: "Stored payload is invalid",
        retryCount: { increment: 1 },
        nextRetryAt: status === "exhausted" ? null : nextRetryDate(),
      },
    });
    return { status, event };
  }

  await db.webhookEvent.update({ where: { id: event.id }, data: { status: "retrying" } });

  try {
    const result = await processPaymentWebhook(parsed.data, event);
    await db.webhookEvent.update({ where: { id: event.id }, data: { status: "processed", nextRetryAt: null, errorMessage: null } });
    await writeAuditLog({
      vendorId: result.vendor.id,
      actorLabel,
      action: "retry_webhook_event",
      targetType: "WebhookEvent",
      targetId: event.id,
      before: auditSnapshot(event),
      after: auditSnapshot(result),
    });
    return { status: "processed" as const, event, result };
  } catch (error) {
    const updatedRetryCount = event.retryCount + 1;
    const status = updatedRetryCount >= event.maxRetries ? "exhausted" : "failed";
    const errorCode = classifyPaymentWebhookFailure(error);
    const message = paymentWebhookFailureMessage(errorCode);
    await db.webhookEvent.update({
      where: { id: event.id },
      data: {
        status,
        errorMessage: message,
        retryCount: { increment: 1 },
        nextRetryAt: status === "exhausted" ? null : nextRetryDate(),
      },
    });
    await writeAuditLog({
      vendorId: event.vendorId,
      actorLabel,
      action: status === "exhausted" ? "webhook_retry_exhausted" : "webhook_retry_failed",
      targetType: "WebhookEvent",
      targetId: event.id,
      before: auditSnapshot(event),
      after: auditSnapshot({ errorCode, status }),
    });
    return { status, event, error: message, errorCode };
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
    if (event.retryCount >= event.maxRetries) {
      await db.webhookEvent.update({ where: { id: event.id }, data: { status: "exhausted", nextRetryAt: null } });
      results.push({ eventId: event.id, status: "exhausted" });
      continue;
    }
    const result = await retryWebhookEvent(event.id);
    results.push({ eventId: event.id, status: result.status });
  }

  return results;
}
