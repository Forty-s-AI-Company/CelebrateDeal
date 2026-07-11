import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { auditSnapshot, writeAuditLog } from "@/lib/audit";
import { getDb } from "@/lib/db";
import { getPaymentProvider, UnsupportedPaymentProviderError } from "@/lib/payment-providers";
import { buildPaymentWebhookDiagnostics } from "@/lib/payment-webhook-diagnostics";
import { processPaymentWebhook } from "@/lib/payment-webhooks";
import { redactedJsonSnapshot } from "@/lib/redaction";

export async function POST(request: Request) {
  const rawBody = await request.text();
  const requestUrl = new URL(request.url);
  const providerId = requestUrl.searchParams.get("provider")
    ?? request.headers.get("x-payment-provider")
    ?? request.headers.get("x-webhook-provider");
  let adapter: ReturnType<typeof getPaymentProvider>;
  try {
    adapter = getPaymentProvider(providerId);
  } catch (error) {
    if (!(error instanceof UnsupportedPaymentProviderError)) throw error;
    await writeAuditLog({
      actorLabel: "webhook:rejected",
      action: "payment_webhook_provider_rejected",
      targetType: "WebhookEvent",
      before: auditSnapshot({ providerId: providerId ?? null, bodyBytes: rawBody.length }),
    });
    return NextResponse.json({ error: "Unsupported payment provider" }, { status: 400 });
  }
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
  if (payload.provider !== adapter.id) {
    await writeAuditLog({
      actorLabel: `webhook:${adapter.id}`,
      action: "payment_webhook_provider_mismatch",
      targetType: "WebhookEvent",
      before: auditSnapshot({ adapter: adapter.id, normalizedProvider: payload.provider }),
    });
    return NextResponse.json({ error: "Payment provider mismatch" }, { status: 400 });
  }
  const db = getDb();
  let event;
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
    if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== "P2002") throw error;
    event = await db.webhookEvent.findUniqueOrThrow({
      where: { provider_eventId: { provider: payload.provider, eventId: payload.eventId } },
    });
  }
  if (event.status === "processed") {
    return NextResponse.json({ ok: true, duplicate: true, eventId: event.id });
  }
  const claimed = await db.webhookEvent.updateMany({
    where: { id: event.id, status: { in: ["received", "failed"] } },
    data: { status: "processing", nextRetryAt: null },
  });
  if (claimed.count !== 1) {
    return NextResponse.json({ ok: true, duplicate: true, processing: true, eventId: event.id }, { status: 202 });
  }

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
