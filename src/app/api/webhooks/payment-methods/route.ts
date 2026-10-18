import type { Prisma } from "@prisma/client";
import { NextResponse } from "next/server";
import { readTextBody } from "@/lib/api-security";
import { auditSnapshot, writeAuditLog } from "@/lib/audit";
import { getDb } from "@/lib/db";
import { captureOperationalError } from "@/lib/monitoring";
import { getPaymentProvider, type PaymentProviderAdapter } from "@/lib/payment-providers";
import { PaymentMethodSetupProviderResultError } from "@/lib/payment-providers/types";
import {
  applyVerifiedPaymentMethodSetup,
  PaymentMethodReferenceValidationError,
  PaymentMethodSetupConflictError,
} from "@/lib/payment-method-reference";
import { consumePaymentMethodSetupIntent, PaymentMethodSetupIntentRejectedError } from "@/lib/payment-method-setup-intent";
import { PAYUNI_LIVE_PROBE_AMOUNT_CENTS, PAYUNI_LIVE_PROBE_DELAY_MS } from "@/lib/payuni-live-probe";

const SETUP_EVENT_TYPE = "payment_method_setup_verified";
// Fixed, path-only destination: the Location header is relative, so a forged
// Host header or callback parameter can never turn this into an open redirect.
const SETUP_RETURN_PATH = "/billing/payment-methods";

type CallbackSource = "return" | "notify" | "unknown";

/** Closed set of browser-visible failure reasons; the page maps each to fixed copy. */
type PaymentMethodSetupReturnReason =
  | "provider_declined"
  | "provider_pending"
  | "invalid_payload"
  | "unverified"
  | "rejected"
  | "processing_failed"
  | "unavailable";

type BrowserOutcome = { setup: "success" } | { setup: "failed"; reason: PaymentMethodSetupReturnReason };

const SUCCESS: BrowserOutcome = { setup: "success" };

function failed(reason: PaymentMethodSetupReturnReason): BrowserOutcome {
  return { setup: "failed", reason };
}

function callbackSource(url: URL): CallbackSource {
  const values = url.searchParams.getAll("source");
  if (values.length !== 1) return "unknown";
  return values[0] === "return" || values[0] === "notify" ? values[0] : "unknown";
}

function browserRedirect(outcome: BrowserOutcome) {
  const query = new URLSearchParams({ setup: outcome.setup });
  if (outcome.setup === "failed") query.set("reason", outcome.reason);
  return new NextResponse(null, {
    status: 303,
    headers: {
      Location: `${SETUP_RETURN_PATH}?${query.toString()}`,
      "Cache-Control": "no-store",
      "Referrer-Policy": "no-referrer",
    },
  });
}

/**
 * `source=return` is the payer's browser posting PAYUNi's ReturnURL form, so it
 * always gets a 303 to the fixed billing page. Notify and unknown callers keep
 * the server-to-server JSON contract and status codes.
 */
function respond(source: CallbackSource, payload: unknown, status: number, outcome: BrowserOutcome) {
  if (source === "return") return browserRedirect(outcome);
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

/**
 * Records why a signed callback could not be normalized. An authenticated
 * provider decision (decline, request rejection, pending) is kept apart from a
 * malformed payload, and only bounded provider codes are recorded.
 */
async function rejectUnnormalizedSetup(error: unknown, providerId: string, bodyBytes: number, source: CallbackSource) {
  const notifyBody = { error: "Invalid payment method setup payload", code: "invalid_payload" };
  if (error instanceof PaymentMethodSetupProviderResultError) {
    const errorCode = error.outcome === "pending" ? "provider_pending" : "provider_declined";
    const providerCodes = {
      providerOuterStatus: error.diagnostics.outerStatus,
      providerStatus: error.diagnostics.status,
      providerMessageCode: error.diagnostics.messageCode,
      providerTradeStatus: error.diagnostics.tradeStatus,
      providerResCode: error.diagnostics.resCode,
    };
    await writeAuditLog({
      vendorId: error.scope?.vendorId ?? null,
      actorLabel: `payment-method-webhook:${providerId}`,
      action: `payment_method_setup_${errorCode}`,
      targetType: error.scope ? "PaymentMethodSetupIntent" : "WebhookEvent",
      targetId: error.scope?.setupIntentId ?? null,
      before: auditSnapshot({ providerId, bodyBytes, callbackSource: source }),
      after: auditSnapshot({ errorCode, ...providerCodes }),
    });
    captureOperationalError(new Error("provider_rejected"), {
      source: "payment_method_setup_webhook",
      operation: errorCode,
      provider: providerId,
      callbackSource: source,
      ...providerCodes,
    }, { fingerprint: ["payment-method-setup", errorCode, providerCodes.providerStatus ?? providerCodes.providerOuterStatus ?? "none"] });
    // The notify contract predates this distinction and stays a 400.
    return respond(source, notifyBody, 400, failed(errorCode));
  }
  await writeAuditLog({
    actorLabel: `payment-method-webhook:${providerId}`,
    action: "payment_method_setup_invalid",
    targetType: "WebhookEvent",
    before: auditSnapshot({ providerId, bodyBytes, callbackSource: source }),
    after: auditSnapshot({ errorCode: "invalid_payload" }),
  });
  captureOperationalError(new Error("payment_method_setup_invalid_payload"), {
    source: "payment_method_setup_webhook",
    operation: "invalid_payload",
    provider: providerId,
    callbackSource: source,
  }, { fingerprint: ["payment-method-setup", "invalid_payload"] });
  return respond(source, notifyBody, 400, failed("invalid_payload"));
}

export async function POST(request: Request) {
  const requestUrl = new URL(request.url);
  const source = callbackSource(requestUrl);
  let provider: PaymentProviderAdapter;
  try {
    provider = getPaymentProvider(process.env.PAYMENT_PROVIDER ?? "demo");
  } catch {
    return respond(source, { error: "Invalid payment provider configuration" }, 500, failed("unavailable"));
  }

  if (process.env.NODE_ENV === "production" && provider.id === "demo") {
    return respond(source, { error: "Demo payment method webhooks are not allowed in production" }, 403, failed("unavailable"));
  }

  const ids = providerIds(request, requestUrl);
  if (ids.length === 0 || ids.some((providerId) => providerId !== provider.id)) {
    return respond(source, { error: "Unsupported payment provider" }, 400, failed("unavailable"));
  }
  if (!supportsSetupWebhook(provider)) {
    return respond(source, { error: "Payment method setup webhook is not configured" }, 501, failed("unavailable"));
  }

  const rawBody = await readTextBody(request);
  if (rawBody === null) return respond(source, { error: "Setup payload too large" }, 413, failed("invalid_payload"));

  if (!await provider.verifyPaymentMethodSetupSignature(request, rawBody)) {
    await writeAuditLog({
      actorLabel: `payment-method-webhook:${provider.id}`,
      action: "payment_method_setup_signature_failed",
      targetType: "WebhookEvent",
      before: auditSnapshot({ providerId: provider.id, bodyBytes: rawBody.length }),
    });
    return respond(source, { error: "Invalid signature" }, 401, failed("unverified"));
  }

  let event;
  try {
    event = await provider.normalizePaymentMethodSetupPayload(rawBody);
  } catch (error) {
    return rejectUnnormalizedSetup(error, provider.id, rawBody.length, source);
  }

  if (event.providerName !== provider.id) {
    return respond(source, { error: "Invalid payment method setup provider" }, 400, failed("invalid_payload"));
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
        setupIntentId: event.setupIntentId,
      } as Prisma.InputJsonObject,
      maxRetries: 5,
    },
    update: {},
  });

  // A provider event ID is global. A duplicate is safe only for the same
  // server-owned intent and tenant, even when the new callback is signed.
  const savedPayload = eventRecord.payload && typeof eventRecord.payload === "object" && !Array.isArray(eventRecord.payload)
    ? eventRecord.payload as Record<string, unknown>
    : {};
  if (eventRecord.eventType !== SETUP_EVENT_TYPE
    || eventRecord.vendorId !== event.vendorId
    || savedPayload.setupIntentId !== event.setupIntentId) {
    await writeAuditLog({
      vendorId: event.vendorId,
      actorLabel: `payment-method-webhook:${provider.id}`,
      action: "payment_method_setup_event_collision",
      targetType: "WebhookEvent",
      targetId: eventRecord.id,
      before: safeEventSnapshot(event),
      after: { errorCode: "event_id_collision" },
    });
    return respond(source, { error: "Payment method setup processing failed", code: "event_id_collision" }, 409, failed("rejected"));
  }

  if (eventRecord.status === "processed") {
    // Return and notify carry the same signed result; whichever arrives second
    // converges here without touching the intent or reference again.
    return respond(source, { ok: true, duplicate: true, eventId: eventRecord.id }, 200, SUCCESS);
  }

  try {
    await db.$transaction(async (tx) => {
      await consumePaymentMethodSetupIntent(tx, event);
      await applyVerifiedPaymentMethodSetup(tx, event);
      if (provider.id === "payuni") {
        const probe = await tx.payUniLiveProbe.findUnique({
          where: { setupIntentId: event.setupIntentId },
          select: { id: true, vendorId: true, status: true, firstAmountCents: true, secondAmountCents: true },
        });
        if (probe) {
          if (probe.vendorId !== event.vendorId || probe.status !== "awaiting_setup"
            || probe.firstAmountCents !== PAYUNI_LIVE_PROBE_AMOUNT_CENTS
            || probe.secondAmountCents !== PAYUNI_LIVE_PROBE_AMOUNT_CENTS) {
            throw new PaymentMethodSetupConflictError();
          }
          const reference = await tx.paymentMethodReference.findUnique({
            where: {
              vendorId_providerName_providerPaymentMethodRef: {
                vendorId: event.vendorId,
                providerName: "payuni",
                providerPaymentMethodRef: event.providerPaymentMethodRef,
              },
            },
            select: { id: true, status: true },
          });
          if (!reference || reference.status !== "verified") throw new PaymentMethodSetupConflictError();
          await tx.payUniLiveProbe.update({
            where: { id: probe.id },
            data: {
              status: "scheduled",
              paymentMethodReferenceId: reference.id,
              dueAt: new Date(Date.now() + PAYUNI_LIVE_PROBE_DELAY_MS),
            },
          });
        }
      }
      await tx.webhookEvent.update({
        where: { id: eventRecord.id },
        data: { status: "processed", processedAt: new Date(), errorMessage: null },
      });
    }, { isolationLevel: "Serializable" });
  } catch (error) {
    const isRejected = error instanceof PaymentMethodReferenceValidationError
      || error instanceof PaymentMethodSetupConflictError
      || error instanceof PaymentMethodSetupIntentRejectedError;
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
    return processingFailureResponse(db, source, eventRecord.id, isRejected);
  }

  return respond(source, { ok: true, eventId: eventRecord.id }, 200, SUCCESS);
}

async function processingFailureResponse(db: ReturnType<typeof getDb>, source: CallbackSource, eventId: string, isRejected: boolean) {
  if (source === "return" && isRejected && await setupEventProcessed(db, eventId)) {
    // A concurrent notify consumed the intent first and committed the same
    // event; the payer's setup did succeed.
    return browserRedirect(SUCCESS);
  }
  return respond(
    source,
    { error: "Payment method setup processing failed", code: isRejected ? "payment_method_setup_rejected" : "processing_failed" },
    isRejected ? 409 : 500,
    failed(isRejected ? "rejected" : "processing_failed"),
  );
}

async function setupEventProcessed(db: ReturnType<typeof getDb>, eventId: string) {
  try {
    const latest = await db.webhookEvent.findUnique({ where: { id: eventId }, select: { status: true, eventType: true } });
    return latest?.status === "processed" && latest.eventType === SETUP_EVENT_TYPE;
  } catch {
    return false;
  }
}
