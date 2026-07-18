import { NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";
import { auditSnapshot, writeAuditLog } from "@/lib/audit";
import { getDb } from "@/lib/db";
import { getPaymentProvider, type PaymentProviderAdapter } from "@/lib/payment-providers";
import { buildPaymentWebhookDiagnostics } from "@/lib/payment-webhook-diagnostics";
import { processPaymentWebhook } from "@/lib/payment-webhooks";
import { redactedJsonSnapshot } from "@/lib/redaction";

export async function POST(request: Request) {
  const requestUrl = new URL(request.url);
  const providerId = requestUrl.searchParams.get("provider")
    ?? request.headers.get("x-payment-provider")
    ?? request.headers.get("x-webhook-provider");
  let adapter: PaymentProviderAdapter;
  try {
    adapter = getPaymentProvider(providerId);
  } catch {
    return NextResponse.json({ error: "Unsupported payment provider" }, { status: 400 });
  }

  const rawBody = await request.text();
  const diagnostics = buildPaymentWebhookDiagnostics(adapter.id, rawBody);
  const verified = await adapter.verifySignature(request, rawBody);

  if (!verified) {
    await writeAuditLog({
      actorLabel: `webhook:${adapter.id}`,
      action: "payment_webhook_signature_failed",
      targetType: "WebhookEvent",
      before: auditSnapshot({ providerId, bodyBytes: rawBody.length }),
    });
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
  }

  let normalized;
  try {
    normalized = await adapter.normalizePayload(rawBody);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Invalid webhook payload";
    await writeAuditLog({
      actorLabel: `webhook:${adapter.id}`,
      action: "payment_webhook_invalid",
      targetType: "WebhookEvent",
      before: auditSnapshot({ providerId, bodyBytes: rawBody.length }),
      after: auditSnapshot({ error: message }),
    });
    return NextResponse.json({ error: message }, { status: 400 });
  }

  const payload = normalized.payload;
  const db = getDb();
  const existing = await db.webhookEvent.findUnique({
    where: { provider_eventId: { provider: payload.provider, eventId: payload.eventId } },
  });

  if (existing?.status === "processed") {
    return NextResponse.json({ ok: true, duplicate: true, eventId: existing.id });
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
    return NextResponse.json({
      ok: true,
      eventId: event.id,
      vendorId: result.vendor.id,
      transactionId: result.transaction.id,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown webhook error";
    await db.webhookEvent.update({
      where: { id: event.id },
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
      after: auditSnapshot({ error: message }),
    });
    return NextResponse.json({ error: message, eventId: event.id }, { status: 500 });
  }
}
