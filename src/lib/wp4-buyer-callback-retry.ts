import { Prisma, type PrismaClient, type PaymentTransaction, type WebhookEvent } from "@prisma/client";
import { PaymentWebhookPayload, type PaymentWebhookPayloadInput } from "./payment-webhooks";
import { retryWebhookEvent } from "./webhook-retry";
import { wp4HistoricalBuyerWhere, WP4_BUYER_CONTINUATION_SOURCE } from "./wp4-buyer-recovery";
import { WP4_SANDBOX_FIXTURE } from "./wp4-sandbox-fixture";

/** Every supplied provider selector must agree with the server-owned payment. */
function matchesFixedPayment(payload: PaymentWebhookPayloadInput,
  event: Pick<WebhookEvent, "eventId" | "vendorId">,
  payment: Pick<PaymentTransaction, "vendorId" | "orderNumber" | "providerTradeNo" | "grossAmountCents" | "currency">) {
  return payload.provider === "payuni" && payload.eventId === event.eventId && payload.eventType === "paid"
    && (event.vendorId === null || event.vendorId === payment.vendorId)
    && (payload.vendorId === undefined || payload.vendorId === payment.vendorId)
    && payload.orderNumber === payment.orderNumber
    && (payload.vendorSlug === undefined || payload.vendorSlug === WP4_SANDBOX_FIXTURE.vendorSlug)
    && (payload.providerTradeNo === undefined || payment.providerTradeNo === null || payload.providerTradeNo === payment.providerTradeNo)
    && payload.grossAmountCents === payment.grossAmountCents
    && (payload.currency === undefined || payload.currency === payment.currency);
}
/** Reserve one retry durably before dispatch; a lost response cannot reopen it. */
async function retryFixedBuyerCallback(db: Pick<PrismaClient, "$transaction">, source: string) {
  const reserved = await db.$transaction(async tx => {
    const payments = await tx.paymentTransaction.findMany({ where: wp4HistoricalBuyerWhere(source), take: 2 });
    if (payments.length !== 1) return { status: payments.length ? "CANDIDATE_AMBIGUOUS" : "FIXTURE_UNAVAILABLE" };
    const payment = payments[0]!;
    if (!payment.orderNumber) return { status: "EVENT_UNAVAILABLE" };
    // Initial verified PayUni callbacks have no tenant projection until processing succeeds.
    // Resolve by the authoritative fixed payment; explicit conflicting scope still fails.
    const events = await tx.webhookEvent.findMany({ where: { provider: "payuni", eventType: "paid",
      payload: { path: ["normalized", "orderNumber"], equals: payment.orderNumber } }, take: 2 });
    if (events.length !== 1) return { status: "EVENT_UNAVAILABLE" };
    const event = events[0]!;
    const envelope = event.payload;
    const normalized = envelope && typeof envelope === "object" && !Array.isArray(envelope) ? envelope.normalized : null;
    const parsed = PaymentWebhookPayload.safeParse(normalized);
    if (!parsed.success || !matchesFixedPayment(parsed.data, event, payment)) return { status: "RETRY_REJECTED" };
    if (parsed.data.vendorSlug !== undefined) {
      const vendor = await tx.vendor.findUnique({ where: { id: payment.vendorId }, select: { slug: true } });
      if (!vendor || vendor.slug !== parsed.data.vendorSlug) return { status: "RETRY_REJECTED" };
    }
    if (event.status === "processed") return { status: "ALREADY_PROCESSED" };
    const metadata = payment.metadata;
    if (!metadata || typeof metadata !== "object" || Array.isArray(metadata) || metadata.wp4CallbackRetryReserved === true
      || event.status !== "failed" || !Number.isSafeInteger(event.retryCount) || !Number.isSafeInteger(event.maxRetries)
      || event.retryCount < 0 || event.maxRetries <= 0 || event.retryCount >= event.maxRetries) return { status: "RETRY_REJECTED" };
    // NotifyURL and ReturnURL can already have consumed retries. The actual remaining
    // event budget governs eligibility; the payment marker and CAS still allow only
    // one fixed recovery. Never reset or increase the provider event's retry budget.
    const updatedAt = new Date();
    const fenced = await tx.webhookEvent.updateMany({ where: { id: event.id, status: "failed", retryCount: event.retryCount, updatedAt: event.updatedAt }, data: { updatedAt } });
    if (fenced.count !== 1) return { status: "RETRY_REJECTED" };
    await tx.paymentTransaction.update({ where: { id: payment.id, vendorId: WP4_SANDBOX_FIXTURE.vendorId },
      data: { metadata: { ...metadata, wp4CallbackRetryReserved: true } as Prisma.InputJsonObject } });
    return { status: "RESERVED", eventId: event.id, expectedVersion: { retryCount: event.retryCount, updatedAt,
      paymentScope: { vendorId: payment.vendorId, paymentTransactionId: payment.id, providerName: payment.providerName, orderNumber: payment.orderNumber } } };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }).catch(error => {
    // A competing serializable reservation is a rejected retry, not a new dispatch.
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2034") {
      return { status: "RETRY_REJECTED", eventId: undefined, expectedVersion: undefined };
    }
    throw error;
  });
  if (reserved.status !== "RESERVED" || !reserved.eventId) return { status: reserved.status, retryAttempts: 0, failureCode: reserved.status === "ALREADY_PROCESSED" ? "NONE" : "UNKNOWN" };
  try {
    const outcome = await retryWebhookEvent(reserved.eventId, "wp4_sandbox_fixed_callback_retry", reserved.expectedVersion);
    return outcome.status === "processed" ? { status: "PROCESSED", retryAttempts: 1, failureCode: "NONE" }
      : { status: "RETRY_FAILED", retryAttempts: 1, failureCode: "processing_failed" };
  } catch { return { status: "RETRY_FAILED", retryAttempts: 1, failureCode: "processing_failed" }; }
}

/** Preserve the previously delivered historical recovery scope. */
export function retryWp4HistoricalBuyerCallback(db: Pick<PrismaClient, "$transaction">) {
  return retryFixedBuyerCallback(db, WP4_BUYER_CONTINUATION_SOURCE);
}

/** Original Q1 payment is catalog-owned; callers cannot supply a source or ID.
 * Replays only its existing verified callback, never submits another payment. */
export function retryQ1OriginalBuyerCallback(db: Pick<PrismaClient, "$transaction">) {
  return retryFixedBuyerCallback(db, "9acfe8d2dba62430e950cff2c0387841ab91f44b");
}
