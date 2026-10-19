import type { Prisma } from "@prisma/client";
import { getDb } from "@/lib/db";
import type { PaymentWebhookNotActionableError } from "@/lib/payment-providers/types";
import { redactedJsonSnapshot } from "@/lib/redaction";

/**
 * WebhookEvent status for an authentic provider callback that reports a
 * completed collection this system refuses to apply automatically (R448-01),
 * or a legacy stored decision that the current contract cannot re-prove
 * (R448-02). Neither the callback claim nor the retry job processes this
 * status; a finance administrator reconciles it manually.
 */
export const MANUAL_RECONCILIATION_STATUS = "needs_manual_reconciliation";
export const MANUAL_RECONCILIATION_EVENT_TYPE = "manual_reconciliation";

/** Metadata key on a pending PaymentTransaction that holds it from automatic expiry. */
export const PAYMENT_MANUAL_RECONCILIATION_METADATA_KEY = "paymentManualReconciliation";

function metadataObject(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

export function paymentHeldForManualReconciliation(metadata: unknown) {
  const hold = metadataObject(metadata)[PAYMENT_MANUAL_RECONCILIATION_METADATA_KEY];
  return Boolean(hold && typeof hold === "object" && !Array.isArray(hold));
}

function isUniqueConflict(error: unknown) {
  return typeof error === "object" && error !== null && "code" in error && error.code === "P2002";
}

/**
 * Records one reconciliation event per provider trade state. Return and
 * Notify of the same callback converge on the same event. The matching
 * pending transaction (resolved only from server records by provider and
 * order number) is held so inventory expiry cannot release a captured
 * payment. No payment, order, commission or inventory state is changed.
 */
export async function recordPaymentWebhookManualReconciliation(input: {
  provider: string;
  error: PaymentWebhookNotActionableError;
  diagnostics: unknown;
}) {
  const { orderNumber, providerTradeNo, tradeStatus, paymentType } = input.error.identifiers;
  if (!orderNumber || !tradeStatus) return null;
  const db = getDb();
  const eventId = `${providerTradeNo ?? orderNumber}:${tradeStatus}`;
  const matches = await db.paymentTransaction.findMany({
    where: { providerName: input.provider, orderNumber },
    select: { id: true, vendorId: true, status: true, metadata: true, providerName: true, orderNumber: true, paymentMode: true },
    take: 2,
  });
  // An ambiguous order number is never attributed to a tenant.
  const transaction = matches.length === 1 ? matches[0]! : null;
  const key = { provider_eventId: { provider: input.provider, eventId } };
  let event = await db.webhookEvent.findUnique({ where: key });
  if (!event) {
    try {
      event = await db.webhookEvent.create({
        data: {
          provider: input.provider,
          eventId,
          eventType: MANUAL_RECONCILIATION_EVENT_TYPE,
          vendorId: transaction?.vendorId ?? null,
          status: MANUAL_RECONCILIATION_STATUS,
          maxRetries: 0,
          errorMessage: `Manual reconciliation required: ${input.error.reason}`,
          payload: {
            raw: redactedJsonSnapshot(input.error.rawSnapshot ?? {}),
            reconciliation: redactedJsonSnapshot({
              reason: input.error.reason,
              orderNumber,
              providerTradeNo: providerTradeNo ?? null,
              tradeStatus,
              paymentType: paymentType ?? null,
              matchedTransaction: transaction ? transaction.id : null,
            }),
            diagnostics: redactedJsonSnapshot(input.diagnostics),
          } as Prisma.InputJsonObject,
        },
      });
    } catch (error) {
      if (!isUniqueConflict(error)) throw error;
      event = await db.webhookEvent.findUnique({ where: key });
      if (!event) throw error;
    }
  }
  if (transaction && transaction.status === "pending" && !paymentHeldForManualReconciliation(transaction.metadata)) {
    await db.paymentTransaction.updateMany({
      where: { id: transaction.id, vendorId: transaction.vendorId, status: "pending" },
      data: {
        metadata: {
          ...metadataObject(transaction.metadata),
          [PAYMENT_MANUAL_RECONCILIATION_METADATA_KEY]: { reason: input.error.reason, webhookEventId: event.id },
        } as Prisma.InputJsonObject,
      },
    });
  }
  return { event, transaction };
}
