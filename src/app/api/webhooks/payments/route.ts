import { NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";
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

function webhookJson(requestUrl: URL, status: number, payload: unknown) {
  observeCallbackRequest(requestUrl, "POST", status);
  return NextResponse.json(payload, { status });
}

export async function HEAD(request: Request) {
  const requestUrl = new URL(request.url);
  observeCallbackRequest(requestUrl, observedMethod(request.method), 405);
  return new NextResponse(null, { status: 405, headers: { Allow: "POST" } });
}

export async function POST(request: Request) {
  const requestUrl = new URL(request.url);
  let adapter: PaymentProviderAdapter;
  try {
    adapter = getPaymentProvider(process.env.PAYMENT_PROVIDER ?? "demo");
  } catch {
    return webhookJson(requestUrl, 500, { error: "Invalid payment provider configuration" });
  }

  if (process.env.NODE_ENV === "production" && adapter.id === "demo") {
    return webhookJson(requestUrl, 403, { error: "Demo payment webhooks are not allowed in production" });
  }

  const providerIds = [
    requestUrl.searchParams.get("provider"),
    request.headers.get("x-payment-provider"),
    request.headers.get("x-webhook-provider"),
  ].filter((providerId): providerId is string => providerId !== null);

  if (providerIds.length === 0 || providerIds.some((providerId) => providerId !== adapter.id)) {
    return webhookJson(requestUrl, 400, { error: "Unsupported payment provider" });
  }

  const rawBody = await readTextBody(request);
  if (rawBody === null) {
    return webhookJson(requestUrl, 413, { error: "Webhook payload too large" });
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
    return webhookJson(requestUrl, 401, { error: "Invalid signature" });
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
    return webhookJson(requestUrl, 400, { error: "Invalid payment webhook payload", code: "invalid_payload" });
  }

  const payload = normalized.payload;
  const db = getDb();
  const existing = await db.webhookEvent.findUnique({
    where: { provider_eventId: { provider: payload.provider, eventId: payload.eventId } },
  });

  if (existing?.status === "processed") {
    return webhookJson(requestUrl, 200, { ok: true, duplicate: true, eventId: existing.id });
  }

  const event = existing ?? await db.webhookEvent.create({
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

  try {
    const result = await processPaymentWebhook(payload, event);
    return webhookJson(requestUrl, 200, {
      ok: true,
      eventId: event.id,
      vendorId: result.vendor.id,
      transactionId: result.transaction.id,
    });
  } catch (error) {
    try {
      const latestEvent = await db.webhookEvent.findUnique({ where: { id: event.id } });
      if (latestEvent?.status === "processed") {
        return webhookJson(requestUrl, 200, { ok: true, duplicate: true, eventId: event.id });
      }
    } catch {
      // Keep the original failure path when convergence cannot be confirmed.
    }

    const errorCode = classifyPaymentWebhookFailure(error);
    observePaymentWebhookFailure(requestUrl, errorCode);
    const message = paymentWebhookFailureMessage(errorCode);
    await db.webhookEvent.updateMany({
      where: { id: event.id, status: { not: "processed" } },
      data: {
        status: "failed",
        errorMessage: message,
        retryCount: { increment: 1 },
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
    return webhookJson(requestUrl, 500, { error: "Payment webhook processing failed", code: errorCode, eventId: event.id });
  }
}
