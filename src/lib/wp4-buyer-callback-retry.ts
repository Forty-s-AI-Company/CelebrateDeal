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
    const events = await tx.webhookEvent.findMany({ where: { vendorId: WP4_SANDBOX_FIXTURE.vendorId, provider: "payuni", eventType: "paid",
      payload: { path: ["normalized", "orderNumber"], equals: payment.orderNumber } }, take: 2 });
    if (events.length !== 1) return { status: "EVENT_UNAVAILABLE" };
    const event = events[0]!;
    const envelope = event.payload;
    const normalized = envelope && typeof envelope === "object" && !Array.isArray(envelope) ? envelope.normalized : null;
    const parsed = PaymentWebhookPayload.safeParse(normalized);
    if (!parsed.success || parsed.data.provider !== "payuni" || parsed.data.eventId !== event.eventId || parsed.data.eventType !== "paid"
      || parsed.data.vendorId !== WP4_SANDBOX_FIXTURE.vendorId || parsed.data.orderNumber !== payment.orderNumber
      || parsed.data.grossAmountCents !== 100 || parsed.data.currency !== "TWD") return { status: "RETRY_REJECTED" };
    if (event.status === "processed") return { status: "ALREADY_PROCESSED" };
    const metadata = payment.metadata;
    if (!metadata || typeof metadata !== "object" || Array.isArray(metadata) || metadata.wp4CallbackRetryReserved === true
      || event.status !== "failed" || event.retryCount >= event.maxRetries || event.retryCount !== 0) return { status: "RETRY_REJECTED" };
    await tx.paymentTransaction.update({ where: { id: payment.id, vendorId: WP4_SANDBOX_FIXTURE.vendorId },
      data: { metadata: { ...metadata, wp4CallbackRetryReserved: true } as Prisma.InputJsonObject } });
    return { status: "RESERVED", eventId: event.id };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  if (reserved.status !== "RESERVED" || !reserved.eventId) return { status: reserved.status, retryAttempts: 0, failureCode: reserved.status === "ALREADY_PROCESSED" ? "NONE" : "UNKNOWN" };
  try {
    const outcome = await retryWebhookEvent(reserved.eventId, "wp4_sandbox_fixed_callback_retry");
    return outcome.status === "processed" ? { status: "PROCESSED", retryAttempts: 1, failureCode: "NONE" }
      : { status: "RETRY_FAILED", retryAttempts: 1, failureCode: "processing_failed" };
  } catch { return { status: "RETRY_FAILED", retryAttempts: 1, failureCode: "processing_failed" }; }
}
