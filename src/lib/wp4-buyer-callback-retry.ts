import { Prisma, type PrismaClient } from "@prisma/client";
import { PaymentWebhookPayload } from "./payment-webhooks";
import { retryWebhookEvent } from "./webhook-retry";
import { wp4HistoricalBuyerWhere } from "./wp4-buyer-recovery";
import { WP4_SANDBOX_FIXTURE } from "./wp4-sandbox-fixture";
/** Reserve one retry durably before dispatch; a lost response cannot reopen it. */
export async function retryWp4HistoricalBuyerCallback(db: Pick<PrismaClient, "$transaction">) {
  const reserved = await db.$transaction(async tx => {
    const payments = await tx.paymentTransaction.findMany({ where: wp4HistoricalBuyerWhere(), take: 2 });
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
    if (!parsed.success || parsed.data.provider !== "payuni" || parsed.data.eventId !== event.eventId || parsed.data.eventType !== "paid"
      || (event.vendorId !== null && event.vendorId !== payment.vendorId)
      || (parsed.data.vendorId !== undefined && parsed.data.vendorId !== payment.vendorId) || parsed.data.orderNumber !== payment.orderNumber
      || (parsed.data.vendorSlug !== undefined && parsed.data.vendorSlug !== WP4_SANDBOX_FIXTURE.vendorSlug)
      || (parsed.data.providerTradeNo !== undefined && payment.providerTradeNo !== null && parsed.data.providerTradeNo !== payment.providerTradeNo)
      || parsed.data.grossAmountCents !== payment.grossAmountCents
      || (parsed.data.currency !== undefined && parsed.data.currency !== payment.currency)) return { status: "RETRY_REJECTED" };
    if (parsed.data.vendorSlug !== undefined) {
      const vendor = await tx.vendor.findUnique({ where: { id: payment.vendorId }, select: { slug: true } });
      if (!vendor || vendor.slug !== parsed.data.vendorSlug) return { status: "RETRY_REJECTED" };
    }
    if (event.status === "processed") return { status: "ALREADY_PROCESSED" };
    const metadata = payment.metadata;
    if (!metadata || typeof metadata !== "object" || Array.isArray(metadata) || metadata.wp4CallbackRetryReserved === true
      || event.status !== "failed" || event.retryCount >= event.maxRetries || event.retryCount > 1) return { status: "RETRY_REJECTED" };
    const updatedAt = new Date();
    const fenced = await tx.webhookEvent.updateMany({ where: { id: event.id, status: "failed", retryCount: event.retryCount, updatedAt: event.updatedAt }, data: { updatedAt } });
    if (fenced.count !== 1) return { status: "RETRY_REJECTED" };
    await tx.paymentTransaction.update({ where: { id: payment.id, vendorId: WP4_SANDBOX_FIXTURE.vendorId },
      data: { metadata: { ...metadata, wp4CallbackRetryReserved: true } as Prisma.InputJsonObject } });
    return { status: "RESERVED", eventId: event.id, expectedVersion: { retryCount: event.retryCount, updatedAt } };
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
