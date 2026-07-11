import { auditSnapshot, writeAuditLog } from "@/lib/audit";
import { getDb } from "@/lib/db";
import { PaymentWebhookPayload, processPaymentWebhook } from "@/lib/payment-webhooks";
import { getPaymentProvider, UnsupportedPaymentProviderError } from "@/lib/payment-providers";

function nextRetryDate() {
  return new Date(Date.now() + 1000 * 60 * 15);
}

function retryLeaseDate() {
  return new Date(Date.now() + 1000 * 60 * 5);
}

export async function retryWebhookEvent(
  eventId: string,
  actorLabel = "job:webhook-retry",
  options: { force?: boolean } = {},
) {
  const db = getDb();
  let event = await db.webhookEvent.findUnique({ where: { id: eventId } });
  if (!event) return { status: "missing" as const };
  if (event.retryCount >= event.maxRetries) {
    await db.webhookEvent.update({ where: { id: event.id }, data: { status: "exhausted", nextRetryAt: null } });
    return { status: "exhausted" as const, event };
  }

  const now = new Date();
  const force = options.force ?? true;
  const claimed = await db.webhookEvent.updateMany({
    where: {
      id: event.id,
      OR: [
        { status: "failed", ...(force ? {} : { nextRetryAt: { lte: now } }) },
        { status: "retrying", nextRetryAt: { lte: now } },
      ],
    },
    data: { status: "retrying", nextRetryAt: retryLeaseDate() },
  });
  if (claimed.count !== 1) return { status: "skipped" as const, event };
  event = await db.webhookEvent.findUniqueOrThrow({ where: { id: event.id } });

  const eventPayload = event.payload as { normalized?: unknown };
  const parsed = PaymentWebhookPayload.safeParse(eventPayload.normalized ?? event.payload);
  let providerAllowed = false;
  if (parsed.success) {
    try {
      providerAllowed = getPaymentProvider(event.provider).id === parsed.data.provider;
    } catch (error) {
      if (!(error instanceof UnsupportedPaymentProviderError)) throw error;
    }
  }

  if (!parsed.success || !providerAllowed) {
    const updatedRetryCount = event.retryCount + 1;
    const status = !providerAllowed || updatedRetryCount >= event.maxRetries ? "exhausted" : "failed";
    await db.webhookEvent.update({
      where: { id: event.id },
      data: {
        status,
        errorMessage: providerAllowed ? "Stored payload is invalid" : "Stored payment provider is rejected",
        retryCount: { increment: 1 },
        nextRetryAt: status === "exhausted" ? null : nextRetryDate(),
      },
    });
    return { status, event };
  }

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
    const message = error instanceof Error ? error.message : "Unknown retry error";
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
      after: auditSnapshot({ error: message, status }),
    });
    return { status, event, error: message };
  }
}

export async function processDueWebhookRetries(limit = 20) {
  const db = getDb();
  const now = new Date();
  const events = await db.webhookEvent.findMany({
    where: {
      status: { in: ["failed", "retrying"] },
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
    const result = await retryWebhookEvent(event.id, "job:webhook-retry", { force: false });
    results.push({ eventId: event.id, status: result.status });
  }

  return results;
}
