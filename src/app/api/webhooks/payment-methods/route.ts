import type { Prisma } from "@prisma/client";
import { NextResponse } from "next/server";
import { readTextBody } from "@/lib/api-security";
import { auditSnapshot, writeAuditLog } from "@/lib/audit";
import { getDb } from "@/lib/db";
import { getPaymentProvider, type PaymentProviderAdapter } from "@/lib/payment-providers";
import {
  applyVerifiedPaymentMethodSetup,
  PaymentMethodReferenceValidationError,
  PaymentMethodSetupConflictError,
} from "@/lib/payment-method-reference";

const SETUP_EVENT_TYPE = "payment_method_setup_verified";

function response(payload: unknown, status: number) {
  return NextResponse.json(payload, { status, headers: { "Cache-Control": "no-store" } });
}

function providerIds(request: Request, url: URL) {
  return [
    url.searchParams.get("provider"),
    request.headers.get("x-payment-provider"),
    request.headers.get("x-webhook-provider"),
  ].filter((value): value is string => Boolean(value));
}

function safeEventSnapshot(event: { providerName: string; eventId: string; vendorId: string; scopeType: string }) {
  return {
    provider: event.providerName,
    eventId: event.eventId,
    vendorId: event.vendorId,
    scopeType: event.scopeType,
  } as Prisma.InputJsonObject;
}

function supportsSetupWebhook(provider: PaymentProviderAdapter): provider is PaymentProviderAdapter & {
  verifyPaymentMethodSetupSignature: NonNullable<PaymentProviderAdapter["verifyPaymentMethodSetupSignature"]>;
  normalizePaymentMethodSetupPayload: NonNullable<PaymentProviderAdapter["normalizePaymentMethodSetupPayload"]>;
} {
  return Boolean(provider.verifyPaymentMethodSetupSignature && provider.normalizePaymentMethodSetupPayload);
}

export async function POST(request: Request) {
  const requestUrl = new URL(request.url);
  let provider: PaymentProviderAdapter;
  try {
    provider = getPaymentProvider(process.env.PAYMENT_PROVIDER ?? "demo");
  } catch {
    return response({ error: "Invalid payment provider configuration" }, 500);
  }

  if (process.env.NODE_ENV === "production" && provider.id === "demo") {
    return response({ error: "Demo payment method webhooks are not allowed in production" }, 403);
  }

  const ids = providerIds(request, requestUrl);
  if (ids.length === 0 || ids.some((providerId) => providerId !== provider.id)) {
    return response({ error: "Unsupported payment provider" }, 400);
  }
  if (!supportsSetupWebhook(provider)) {
    return response({ error: "Payment method setup webhook is not configured" }, 501);
  }

  const rawBody = await readTextBody(request);
  if (rawBody === null) return response({ error: "Setup payload too large" }, 413);

  if (!await provider.verifyPaymentMethodSetupSignature(request, rawBody)) {
    await writeAuditLog({
      actorLabel: `payment-method-webhook:${provider.id}`,
      action: "payment_method_setup_signature_failed",
      targetType: "WebhookEvent",
      before: auditSnapshot({ providerId: provider.id, bodyBytes: rawBody.length }),
    });
    return response({ error: "Invalid signature" }, 401);
  }

  let event;
  try {
    event = await provider.normalizePaymentMethodSetupPayload(rawBody);
  } catch {
    await writeAuditLog({
      actorLabel: `payment-method-webhook:${provider.id}`,
      action: "payment_method_setup_invalid",
      targetType: "WebhookEvent",
      before: auditSnapshot({ providerId: provider.id, bodyBytes: rawBody.length }),
      after: auditSnapshot({ errorCode: "invalid_payload" }),
    });
    return response({ error: "Invalid payment method setup payload", code: "invalid_payload" }, 400);
  }

  if (event.providerName !== provider.id) {
    return response({ error: "Invalid payment method setup provider" }, 400);
  }

  const db = getDb();
  const eventRecord = await db.webhookEvent.upsert({
    where: { provider_eventId: { provider: event.providerName, eventId: event.eventId } },
    create: {
      provider: event.providerName,
      eventId: event.eventId,
      eventType: SETUP_EVENT_TYPE,
      vendorId: event.vendorId,
      status: "received",
      payload: {
        schema: "payment-method-setup/v1",
        eventType: SETUP_EVENT_TYPE,
        provider: event.providerName,
        eventId: event.eventId,
        vendorId: event.vendorId,
        scopeType: event.scopeType,
      } as Prisma.InputJsonObject,
      maxRetries: 5,
    },
    update: {},
  });

  if (eventRecord.eventType !== SETUP_EVENT_TYPE) {
    await writeAuditLog({
      vendorId: event.vendorId,
      actorLabel: `payment-method-webhook:${provider.id}`,
      action: "payment_method_setup_event_collision",
      targetType: "WebhookEvent",
      targetId: eventRecord.id,
      before: safeEventSnapshot(event),
      after: { errorCode: "event_id_collision" },
    });
    return response({ error: "Payment method setup processing failed", code: "event_id_collision" }, 409);
  }

  if (eventRecord.status === "processed") {
    return response({ ok: true, duplicate: true, eventId: eventRecord.id }, 200);
  }

  try {
    await db.$transaction(async (tx) => {
      await applyVerifiedPaymentMethodSetup(tx, event);
      await tx.webhookEvent.update({
        where: { id: eventRecord.id },
        data: { status: "processed", processedAt: new Date(), errorMessage: null },
      });
    }, { isolationLevel: "Serializable" });
  } catch (error) {
    const isRejected = error instanceof PaymentMethodReferenceValidationError || error instanceof PaymentMethodSetupConflictError;
    await db.webhookEvent.updateMany({
      where: { id: eventRecord.id, status: { not: "processed" } },
      data: {
        status: "failed",
        errorMessage: isRejected ? "payment_method_setup_rejected" : "payment_method_setup_processing_failed",
        ...(isRejected ? {} : { retryCount: { increment: 1 }, nextRetryAt: new Date(Date.now() + 15 * 60 * 1000) }),
      },
    });
    await writeAuditLog({
      vendorId: event.vendorId,
      actorLabel: `payment-method-webhook:${provider.id}`,
      action: "payment_method_setup_failed",
      targetType: "WebhookEvent",
      targetId: eventRecord.id,
      before: safeEventSnapshot(event),
      after: { errorCode: isRejected ? "payment_method_setup_rejected" : "payment_method_setup_processing_failed" },
    });
    return response({ error: "Payment method setup processing failed", code: isRejected ? "payment_method_setup_rejected" : "processing_failed" }, isRejected ? 409 : 500);
  }

  return response({ ok: true, eventId: eventRecord.id }, 200);
}
