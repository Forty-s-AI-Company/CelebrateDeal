import * as Sentry from "@sentry/nextjs";
import { auditSnapshot, writeAuditLog } from "@/lib/audit";
import { getDb } from "@/lib/db";
import { InventoryUnavailableError } from "@/lib/inventory-reservations";
import { captureOperationalError } from "@/lib/monitoring";
import { classifyPaymentWebhookErrorClass, classifyPaymentWebhookFailure, paymentWebhookErrorStage, paymentWebhookFailureMessage } from "@/lib/payment-webhook-errors";
import { MANUAL_RECONCILIATION_STATUS } from "@/lib/payment-webhook-manual-reconciliation";
import { PaymentWebhookPayload, processPaymentWebhook, type PaymentWebhookExpectedScope } from "@/lib/payment-webhooks";

// Current PayUni payment events are keyed TradeNo:TradeStatus (F-037).
const PAYUNI_TRADE_STATE_EVENT_ID = /^.+:[0-9]{1,2}$/;

/**
 * A PayUni paid decision stored before F-037 came from a normalizer that
 * ignored TradeStatus and PaymentType, and its stored snapshot never kept
 * them (nor the unsigned outer Status). The current contract cannot re-prove
 * such a decision, so it is never replayed automatically (R448-02).
 */
export function isUnprovableLegacyPayUniPaidEvent(event: { provider: string; eventId: string; eventType: string; payload: unknown }) {
  if (event.provider !== "payuni" || PAYUNI_TRADE_STATE_EVENT_ID.test(event.eventId)) return false;
  const payload = event.payload && typeof event.payload === "object" && !Array.isArray(event.payload)
    ? event.payload as { normalized?: { eventType?: unknown } } : {};
  return event.eventType === "paid" || payload.normalized?.eventType === "paid";
}

const WEBHOOK_RETRY_LEASE_MS = 1000 * 60 * 10;

function nextRetryDate() {
  return new Date(Date.now() + 1000 * 60 * 15);
}

export type WebhookRetryAlertReason = "exhausted" | "inventory_unavailable";

const SAFE_ALERT_IDENTIFIER = /^[A-Za-z0-9_.:@+-]{1,128}$/u;

function safeAlertIdentifier(value: unknown) {
  return typeof value === "string" && SAFE_ALERT_IDENTIFIER.test(value) ? value : "unavailable";
}

/** Reads only the order number from a stored webhook payload; never other fields. */
function storedOrderNumber(payload: unknown) {
  if (!payload || typeof payload !== "object") return undefined;
  const normalized = (payload as { normalized?: unknown }).normalized;
  const source = normalized && typeof normalized === "object" ? normalized : payload;
  return (source as { orderNumber?: unknown }).orderNumber;
}

/**
 * Error-level Sentry alert for a payment webhook that needs a human (PR #447
 * review M2 / B03-07): the retry budget is exhausted, or a late `paid` found its
 * released inventory sold out. Only the internal event id and the order number
 * are attached; no buyer data, payload or provider message.
 */
export function reportWebhookRetryAlert(input: {
  eventId: string;
  orderNumber: unknown;
  provider: string;
  reason: WebhookRetryAlertReason;
}) {
  try {
    Sentry.captureMessage("webhook_retry_requires_attention", {
      level: "error",
      fingerprint: ["webhook-retry-requires-attention", input.reason],
      tags: { source: "webhook_retry", reason: input.reason, provider: safeAlertIdentifier(input.provider) },
      extra: { eventId: safeAlertIdentifier(input.eventId), orderNumber: safeAlertIdentifier(input.orderNumber) },
    });
  } catch {
    // Alerting must never change the retry state machine.
  }
}

type RetryableWebhookEvent = {
  id: string;
  vendorId: string | null;
  provider: string;
  status: string;
  retryCount: number;
  maxRetries: number;
  updatedAt: Date;
  payload?: unknown;
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
  if (exhausted) {
    reportWebhookRetryAlert({ eventId: event.id, orderNumber: storedOrderNumber(event.payload), provider: event.provider, reason: "exhausted" });
    return { status: "exhausted" as const, event };
  }
  return retryWebhookEvent(event.id);
}

export async function retryWebhookEvent(eventId: string, actorLabel = "job:webhook-retry", expectedVersion?: { retryCount: number; updatedAt: Date; paymentScope?: PaymentWebhookExpectedScope }) {
  const db = getDb();
  const event = await db.webhookEvent.findUnique({ where: { id: eventId } });
  if (!event) return { status: "missing" as const };
  // Fixed recovery validates a particular stored payload/version before dispatch.
  // A scheduler or callback that changed it must win rather than being retried here.
  if (expectedVersion && (event.retryCount !== expectedVersion.retryCount
    || event.updatedAt.getTime() !== expectedVersion.updatedAt.getTime())) return { status: "claimed_elsewhere" as const, event };
  if (isUnprovableLegacyPayUniPaidEvent(event)) {
    const held = await db.webhookEvent.updateMany({
      where: { id: event.id, status: "failed", retryCount: event.retryCount, updatedAt: event.updatedAt },
      data: {
        status: MANUAL_RECONCILIATION_STATUS,
        nextRetryAt: null,
        errorMessage: "Legacy PayUni paid decision cannot be re-proven; manual reconciliation required",
      },
    });
    if (held.count !== 1) return { status: "claimed_elsewhere" as const, event };
    captureOperationalError(new Error("Legacy PayUni payment event requires manual reconciliation"), {
      source: "webhook_retry", operation: "manual_reconciliation", provider: event.provider,
      status: MANUAL_RECONCILIATION_STATUS, webhookEventId: event.id,
    }, { level: "error", fingerprint: ["webhook-retry-legacy-payuni-paid"] });
    await writeAuditLog({
      vendorId: event.vendorId,
      actorLabel,
      action: "webhook_retry_manual_reconciliation",
      targetType: "WebhookEvent",
      targetId: event.id,
      after: auditSnapshot({ errorCode: "legacy_payuni_paid_unprovable", status: MANUAL_RECONCILIATION_STATUS }),
    });
    return { status: MANUAL_RECONCILIATION_STATUS, event };
  }
  if (event.retryCount >= event.maxRetries) {
    const exhausted = await db.webhookEvent.updateMany({
      where: { id: event.id, status: "failed", retryCount: event.retryCount, updatedAt: event.updatedAt },
      data: { status: "exhausted", nextRetryAt: null },
    });
    if (exhausted.count !== 1) return { status: "claimed_elsewhere" as const, event };
    reportWebhookRetryAlert({ eventId: event.id, orderNumber: storedOrderNumber(event.payload), provider: event.provider, reason: "exhausted" });
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
    if (status === "exhausted") {
      reportWebhookRetryAlert({ eventId: event.id, orderNumber: storedOrderNumber(event.payload), provider: event.provider, reason: "exhausted" });
    }
    return { status, event };
  }

  try {
    const scope = expectedVersion?.paymentScope;
    if (scope && parsed.data.vendorId !== undefined && parsed.data.vendorId !== scope.vendorId) {
      throw new Error("Recovery webhook tenant does not match the reserved payment.");
    }
    // Bind an omitted provider tenant to the validated server payment, while
    // retaining vendorSlug so the core rejects a reassigned/conflicting slug.
    const result = scope
      ? await processPaymentWebhook({ ...parsed.data, vendorId: scope.vendorId }, claimedEvent, scope)
      : await processPaymentWebhook(parsed.data, claimedEvent);
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
    const errorClass = classifyPaymentWebhookErrorClass(error);
    const errorStage = paymentWebhookErrorStage(error);
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
    // B03-07: a late paid whose released reservation can no longer be
    // re-acquired rolls back. Alert on every such attempt, not only the last.
    const inventoryUnavailable = error instanceof InventoryUnavailableError;
    if (inventoryUnavailable || status === "exhausted") {
      reportWebhookRetryAlert({
        eventId: event.id,
        orderNumber: parsed.data.orderNumber,
        provider: event.provider,
        reason: inventoryUnavailable ? "inventory_unavailable" : "exhausted",
      });
    }
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
      after: auditSnapshot({ errorCode, errorClass, errorStage, status }),
    });
    return { status, event: claimedEvent, error: message, errorCode, inventoryUnavailable };
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
    results.push({ eventId: event.id, status: result.status, inventoryUnavailable: false });
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
    results.push({
      eventId: event.id,
      status: result.status,
      inventoryUnavailable: "inventoryUnavailable" in result && result.inventoryUnavailable === true,
    });
  }

  return results;
}
