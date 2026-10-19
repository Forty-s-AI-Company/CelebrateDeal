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
/** Closed by a later verified paid event for the same trade (RR-01). */
export const MANUAL_RECONCILIATION_RESOLVED_STATUS = "manual_reconciliation_resolved";
const MANUAL_RECONCILIATION_EVENT_PREFIX = "manual:";
const PAID_STATUSES = new Set(["paid", "partially_refunded", "refunded"]);

/**
 * Reconciliation events live in their own eventId namespace. They must never
 * occupy the TradeNo:TradeStatus key of a real payment event, or a later
 * verified paid callback would be blocked (RR-01).
 */
export function manualReconciliationEventId(tradeRef: string, tradeStatus: string, paymentType: string | undefined) {
  return `${MANUAL_RECONCILIATION_EVENT_PREFIX}${tradeRef}:${tradeStatus}:${paymentType ?? "none"}`;
}
export const MANUAL_RECONCILIATION_EVENT_TYPE = "manual_reconciliation";

/** Metadata key on a pending PaymentTransaction that holds it from automatic expiry. */
export const PAYMENT_MANUAL_RECONCILIATION_METADATA_KEY = "paymentManualReconciliation";

function metadataObject(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

export function withoutManualReconciliationHold(metadata: Record<string, unknown>) {
  return Object.fromEntries(Object.entries(metadata).filter(([key]) => key !== PAYMENT_MANUAL_RECONCILIATION_METADATA_KEY));
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
  const eventId = manualReconciliationEventId(providerTradeNo ?? orderNumber, tradeStatus, paymentType);
  const matches = await db.paymentTransaction.findMany({
    where: { providerName: input.provider, orderNumber },
    select: { id: true, vendorId: true, status: true, metadata: true, providerName: true, orderNumber: true, paymentMode: true },
    take: 2,
  });
  // An ambiguous order number is never attributed to a tenant.
  const transaction = matches.length === 1 ? matches[0]! : null;
  // A verified paid callback already settled this trade (for example Notify
  // before a Return whose unsigned outer Status was altered): nothing to
  // reconcile, no hold and no alert (RR-02).
  if (transaction && tradeStatus === "1" && PAID_STATUSES.has(transaction.status)) {
    return { event: null, transaction, alreadyPaid: true as const };
  }
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
  return { event, transaction, alreadyPaid: false as const };
}

/**
 * Called inside the serializable paid transition: closes reconciliation
 * events recorded for the same trade before the verified paid event arrived.
 * The caller removes the transaction hold in the same write.
 */
export async function resolveManualReconciliationForPaidTrade(
  tx: Pick<Prisma.TransactionClient, "webhookEvent">,
  input: { provider: string; orderNumber: string; providerTradeNo?: string; resolvedByEventId: string },
) {
  const refs = [...new Set([input.providerTradeNo, input.orderNumber].filter((value): value is string => Boolean(value)))];
  return tx.webhookEvent.updateMany({
    where: {
      provider: input.provider,
      status: MANUAL_RECONCILIATION_STATUS,
      OR: refs.map((ref) => ({ eventId: { startsWith: `${MANUAL_RECONCILIATION_EVENT_PREFIX}${ref}:1:` } })),
    },
    data: {
      status: MANUAL_RECONCILIATION_RESOLVED_STATUS,
      processedAt: new Date(),
      errorMessage: `Resolved by verified provider payment event ${input.resolvedByEventId}`.slice(0, 500),
    },
  });
}
