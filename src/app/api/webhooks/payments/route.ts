import { NextResponse } from "next/server";
import type { Prisma, WebhookEvent } from "@prisma/client";
import { readTextBody } from "@/lib/api-security";
import { auditSnapshot, writeAuditLog } from "@/lib/audit";
import { getDb } from "@/lib/db";
import { getPaymentProvider, type PaymentProviderAdapter } from "@/lib/payment-providers";
import { buildPaymentWebhookDiagnostics } from "@/lib/payment-webhook-diagnostics";
import { classifyPaymentWebhookFailure, paymentWebhookFailureMessage } from "@/lib/payment-webhook-errors";
import { processPaymentWebhook } from "@/lib/payment-webhooks";
import { redactedJsonSnapshot } from "@/lib/redaction";

type CallbackSource = "return" | "notify" | "unknown";
type ObservedMethod = "POST" | "HEAD" | "OTHER";
type PayerReturnOutcome = "updated" | "pending" | "unverified";

function classifyCallbackSource(searchParams: URLSearchParams): CallbackSource {
  const values = searchParams.getAll("source");
  if (values.length !== 1) return "unknown";
  return values[0] === "return" || values[0] === "notify" ? values[0] : "unknown";
}

function observedMethod(method: string): ObservedMethod {
  if (method === "POST" || method === "HEAD") return method;
  return "OTHER";
}

/**
 * Vercel request records omit query strings. For preview-only callback proof,
 * emit a fixed schema that keeps only an allowlisted source enum. Never pass
 * request URL, body, headers, identifiers, or exception data to this log.
 */
function observeCallbackRequest(requestUrl: URL, method: ObservedMethod, status: number) {
  if (process.env.VERCEL_ENV !== "preview") return;

  try {
    console.info(JSON.stringify({
      event: "payment_webhook_request_v1",
      method,
      path: "/api/webhooks/payments",
      source: classifyCallbackSource(requestUrl.searchParams),
      status,
      timestamp: new Date().toISOString(),
    }));
  } catch {
    // Observability must not change webhook response semantics.
  }
}

function observePaymentWebhookFailure(requestUrl: URL, code: ReturnType<typeof classifyPaymentWebhookFailure>) {
  if (process.env.VERCEL_ENV !== "preview") return;

  try {
    console.info(JSON.stringify({
      event: "payment_webhook_failure_v1",
      method: "POST",
      path: "/api/webhooks/payments",
      source: classifyCallbackSource(requestUrl.searchParams),
      status: 500,
      code,
      timestamp: new Date().toISOString(),
    }));
  } catch {
    // Observability must not change webhook response semantics.
  }
}

function isPayUniPayerReturn(requestUrl: URL) {
  const providerValues = requestUrl.searchParams.getAll("provider");
  return classifyCallbackSource(requestUrl.searchParams) === "return"
    && providerValues.length === 1
    && providerValues[0] === "payuni";
}

function payerReturnOutcome(status: number): PayerReturnOutcome {
  if (status >= 200 && status < 300) return "updated";
  if (status >= 500) return "pending";
  return "unverified";
}

function webhookResponse(requestUrl: URL, status: number, payload: unknown) {
  if (isPayUniPayerReturn(requestUrl)) {
    const destination = new URL("/checkout/result", requestUrl.origin);
    destination.searchParams.set("payment", payerReturnOutcome(status));
    observeCallbackRequest(requestUrl, "POST", 303);
    const response = NextResponse.redirect(destination, 303);
    response.headers.set("cache-control", "no-store");
    response.headers.set("referrer-policy", "no-referrer");
    return response;
  }

  observeCallbackRequest(requestUrl, "POST", status);
  return NextResponse.json(payload, { status });
}

export async function HEAD(request: Request) {
  const requestUrl = new URL(request.url);
  observeCallbackRequest(requestUrl, observedMethod(request.method), 405);
  return new NextResponse(null, { status: 405, headers: { Allow: "POST" } });
}

async function claimWebhookEvent(db: ReturnType<typeof getDb>, event: WebhookEvent) {
  if (event.status === "processed") return { status: "processed" as const, event };
  if (event.status !== "received" && event.status !== "failed") return { status: "pending" as const, event };
  if (event.status === "failed" && event.retryCount >= event.maxRetries) return { status: "pending" as const, event };

  // A created event is visible before its first callback finishes. Claim it
  // atomically; a later signed provider retry may reclaim only a failed event.
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
    return { status: latestEvent?.status === "processed" ? "processed" as const : "pending" as const, event };
  }
  return {
    status: "claimed" as const,
    event: { ...event, status: "retrying", retryCount: event.retryCount + (isRetry ? 1 : 0) },
    isRetry,
  };
}

export async function POST(request: Request) {
  const requestUrl = new URL(request.url);
  let adapter: PaymentProviderAdapter;
  try {
    adapter = getPaymentProvider(process.env.PAYMENT_PROVIDER ?? "demo");
  } catch {
    return webhookResponse(requestUrl, 500, { error: "Invalid payment provider configuration" });
  }

  if (process.env.NODE_ENV === "production" && adapter.id === "demo") {
    return webhookResponse(requestUrl, 403, { error: "Demo payment webhooks are not allowed in production" });
  }

  const providerIds = [
    requestUrl.searchParams.get("provider"),
    request.headers.get("x-payment-provider"),
    request.headers.get("x-webhook-provider"),
  ].filter((providerId): providerId is string => providerId !== null);

  if (providerIds.length === 0 || providerIds.some((providerId) => providerId !== adapter.id)) {
    return webhookResponse(requestUrl, 400, { error: "Unsupported payment provider" });
  }

  const rawBody = await readTextBody(request);
  if (rawBody === null) {
    return webhookResponse(requestUrl, 413, { error: "Webhook payload too large" });
  }

  const diagnostics = buildPaymentWebhookDiagnostics(adapter.id, rawBody);
  const verified = await adapter.verifySignature(request, rawBody);

  if (!verified) {
    await writeAuditLog({
      actorLabel: `webhook:${adapter.id}`,
      action: "payment_webhook_signature_failed",
      targetType: "WebhookEvent",
      before: auditSnapshot({ providerId: adapter.id, bodyBytes: rawBody.length }),
    });
    return webhookResponse(requestUrl, 401, { error: "Invalid signature" });
  }

  let normalized;
  try {
    normalized = await adapter.normalizePayload(rawBody);
  } catch {
    await writeAuditLog({
      actorLabel: `webhook:${adapter.id}`,
      action: "payment_webhook_invalid",
      targetType: "WebhookEvent",
      before: auditSnapshot({ providerId: adapter.id, bodyBytes: rawBody.length }),
      after: auditSnapshot({ errorCode: "invalid_payload" }),
    });
    return webhookResponse(requestUrl, 400, { error: "Invalid payment webhook payload", code: "invalid_payload" });
  }

  const payload = normalized.payload;
  const db = getDb();
  const eventKey = { provider_eventId: { provider: payload.provider, eventId: payload.eventId } };
  let event = await db.webhookEvent.findUnique({ where: eventKey });
  if (!event) {
    try {
      event = await db.webhookEvent.create({
        data: {
          provider: payload.provider,
          eventId: payload.eventId,
          eventType: payload.eventType,
          status: "received",
          maxRetries: 5,
          payload: {
            raw: redactedJsonSnapshot(normalized.rawPayload),
            normalized: redactedJsonSnapshot(payload),
            diagnostics: redactedJsonSnapshot(diagnostics),
          } as Prisma.InputJsonObject,
        },
      });
    } catch (error) {
      // ReturnURL and NotifyURL can both miss the first read. Only converge a
      // unique-key race when the same provider event is visible after the loss.
      if (typeof error !== "object" || error === null || !("code" in error) || error.code !== "P2002") {
        throw error;
      }
      event = await db.webhookEvent.findUnique({ where: eventKey });
      if (!event) throw error;
    }
  }

  const claim = await claimWebhookEvent(db, event);
  if (claim.status === "processed") {
    return webhookResponse(requestUrl, 200, { ok: true, duplicate: true, eventId: event.id });
  }
  if (claim.status === "pending") {
    return webhookResponse(requestUrl, 503, { error: "Payment webhook processing pending", eventId: event.id });
  }
  event = claim.event;

  try {
    const result = await processPaymentWebhook(payload, event);
    return webhookResponse(requestUrl, 200, {
      ok: true,
      eventId: event.id,
      vendorId: result.vendor.id,
      transactionId: result.transaction.id,
    });
  } catch (error) {
    try {
      const latestEvent = await db.webhookEvent.findUnique({ where: { id: event.id } });
      if (latestEvent?.status === "processed") {
        return webhookResponse(requestUrl, 200, { ok: true, duplicate: true, eventId: event.id });
      }
    } catch {
      // Keep the original failure path when convergence cannot be confirmed.
    }

    const errorCode = classifyPaymentWebhookFailure(error);
    observePaymentWebhookFailure(requestUrl, errorCode);
    const message = paymentWebhookFailureMessage(errorCode);
    await db.webhookEvent.updateMany({
      where: { id: event.id, status: "retrying", retryCount: event.retryCount },
      data: {
        status: "failed",
        errorMessage: message,
        retryCount: claim.isRetry ? undefined : { increment: 1 },
        nextRetryAt: new Date(Date.now() + 1000 * 60 * 15),
      },
    });
    await writeAuditLog({
      actorLabel: `webhook:${payload.provider}`,
      action: "payment_webhook_failed",
      targetType: "WebhookEvent",
      targetId: event.id,
      before: auditSnapshot(payload),
      after: auditSnapshot({ errorCode }),
    });
    return webhookResponse(requestUrl, 500, { error: "Payment webhook processing failed", code: errorCode, eventId: event.id });
  }
}
