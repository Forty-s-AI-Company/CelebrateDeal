import { randomBytes } from "node:crypto";
import { Prisma, type PaymentTransaction, type PrismaClient } from "@prisma/client";
import { auditSnapshot, writeAuditLog } from "@/lib/audit";
import { getPaymentProvider } from "@/lib/payment-providers";
import { RefundProviderError, type RefundFailureCategory } from "@/lib/payment-providers/types";
import {
  applyPaymentRefundAccounting,
  calculateNetReferenceAmountCents,
} from "@/lib/payment-refund-accounting";

export class PayUniRefundValidationError extends Error {}

export type PayUniRefundExecutionInput = {
  db: PrismaClient;
  transactionId: string;
  refundAmountCents: number;
  gatewayFeeRefundCents: number;
  platformFeeRefundCents: number;
  reason: string | null;
  monthKey: string;
  actor: { id: string; label: string };
};

export type PayUniRefundExecutionResult =
  | { disposition: "completed"; transaction: PaymentTransaction }
  | { disposition: "validation_failed" }
  | { disposition: "provider_unavailable" }
  | { disposition: "provider_request_rejected"; category: RefundFailureCategory }
  | { disposition: "provider_result_ambiguous"; category: RefundFailureCategory }
  | { disposition: "completion_pending_reconciliation" };

const MAX_COMPLETION_ATTEMPTS = 3;

function isDatabaseTransactionConflict(error: unknown) {
  return typeof error === "object" && error !== null && "code" in error
    && (error.code === "P2025" || error.code === "P2034");
}

function isSerializationConflict(error: unknown) {
  return typeof error === "object" && error !== null && "code" in error && error.code === "P2034";
}

/**
 * Executes the only provider-writing PayUni refund path. It deliberately
 * accepts a server-owned transaction id and validated integer amounts; HTTP
 * routes must select these values themselves and never forward caller input.
 */
export async function executePayUniRefund(input: PayUniRefundExecutionInput): Promise<PayUniRefundExecutionResult> {
  const provider = getPaymentProvider("payuni");
  if (!provider.refundPayment) return { disposition: "provider_unavailable" };

  const requestId = randomBytes(16).toString("hex");
  const requestReservationEventId = `request:${requestId}`;
  const ambiguousReservationEventId = `ambiguous:${requestId}`;
  let reserved: { transaction: PaymentTransaction; refundId: string };
  try {
    reserved = await input.db.$transaction(async (tx) => {
      const transaction = await tx.paymentTransaction.findUnique({ where: { id: input.transactionId } });
      if (!transaction || transaction.providerName !== "payuni" || !transaction.providerTradeNo) {
        throw new PayUniRefundValidationError();
      }
      if (transaction.status !== "paid" && transaction.status !== "partially_refunded") {
        throw new PayUniRefundValidationError();
      }

      const reservedRefunds = await tx.refundRecord.aggregate({
        where: { paymentTransactionId: transaction.id, status: { in: ["pending", "processed"] } },
        _sum: {
          refundAmountCents: true,
          gatewayFeeRefundCents: true,
          platformFeeRefundCents: true,
        },
      });
      const pendingReservations = await tx.refundRecord.aggregate({
        where: { paymentTransactionId: transaction.id, status: "pending" },
        _count: { _all: true },
      });
      const reservedAmountCents = reservedRefunds._sum.refundAmountCents ?? 0;
      const reservedGatewayFeeCents = reservedRefunds._sum.gatewayFeeRefundCents ?? 0;
      const reservedPlatformFeeCents = reservedRefunds._sum.platformFeeRefundCents ?? 0;
      if ((pendingReservations._count?._all ?? 0) > 0
        || input.refundAmountCents <= 0
        || input.refundAmountCents > transaction.grossAmountCents - reservedAmountCents
        || reservedGatewayFeeCents + input.gatewayFeeRefundCents > transaction.gatewayFeeCents
        || reservedPlatformFeeCents + input.platformFeeRefundCents > transaction.platformFeeCents) {
        throw new PayUniRefundValidationError();
      }

      const refund = await tx.refundRecord.create({
        data: {
          vendorId: transaction.vendorId,
          paymentTransactionId: transaction.id,
          providerEventId: requestReservationEventId,
          monthKey: input.monthKey,
          refundAmountCents: input.refundAmountCents,
          gatewayFeeRefundCents: input.gatewayFeeRefundCents,
          platformFeeRefundCents: input.platformFeeRefundCents,
          reason: input.reason,
          status: "pending",
        },
      });
      return { transaction, refundId: refund.id };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  } catch (error) {
    if (error instanceof PayUniRefundValidationError || isDatabaseTransactionConflict(error)) {
      return { disposition: "validation_failed" };
    }
    throw error;
  }

  let providerResult: Awaited<ReturnType<NonNullable<typeof provider.refundPayment>>>;
  try {
    providerResult = await provider.refundPayment({
      transaction: reserved.transaction,
      refundAmountCents: input.refundAmountCents,
      requestId,
    });
  } catch (error) {
    const category = error instanceof RefundProviderError ? error.category : "unknown";
    const ambiguous = category !== "request_contract";
    await input.db.refundRecord.update({
      where: { id: reserved.refundId, status: "pending", providerEventId: requestReservationEventId },
      data: ambiguous ? { providerEventId: ambiguousReservationEventId } : { status: "failed" },
    });
    return ambiguous
      ? { disposition: "provider_result_ambiguous", category }
      : { disposition: "provider_request_rejected", category };
  }

  try {
    for (let attempt = 1; attempt <= MAX_COMPLETION_ATTEMPTS; attempt += 1) {
      try {
        const completed = await input.db.$transaction(async (tx) => {
          const currentTransaction = await tx.paymentTransaction.findUnique({ where: { id: reserved.transaction.id } });
          if (!currentTransaction) throw new PayUniRefundValidationError();
          const refundedAmountCents = currentTransaction.refundedAmountCents + input.refundAmountCents;
          if (refundedAmountCents > currentTransaction.grossAmountCents) throw new PayUniRefundValidationError();
          const refundOccurredAt = new Date();
          await tx.refundRecord.update({
            where: { id: reserved.refundId, status: "pending", providerEventId: requestReservationEventId },
            data: { status: "processed", providerEventId: providerResult.providerEventId ?? `request:${requestId}` },
          });
          const transaction = await tx.paymentTransaction.update({
            where: { id: currentTransaction.id },
            data: {
              status: refundedAmountCents >= currentTransaction.grossAmountCents ? "refunded" : "partially_refunded",
              refundedAmountCents,
              refundReason: input.reason,
              refundedAt: refundOccurredAt,
            },
          });
          const refundedFeeTotals = await tx.refundRecord.aggregate({
            where: { paymentTransactionId: transaction.id, status: "processed" },
            _sum: { gatewayFeeRefundCents: true, platformFeeRefundCents: true },
          });
          await applyPaymentRefundAccounting(tx, {
            vendorId: currentTransaction.vendorId,
            transactionId: currentTransaction.id,
            orderNumber: currentTransaction.orderNumber,
            providerName: currentTransaction.providerName,
            eventIdentity: providerResult.providerEventId ?? `request:${reserved.refundId}`,
            refundRecordId: reserved.refundId,
            refundAmountCents: input.refundAmountCents,
            netReferenceAmountCents: calculateNetReferenceAmountCents({
              netAmountCents: transaction.netAmountCents,
              refundedAmountCents: transaction.refundedAmountCents,
              gatewayFeeRefundCents: refundedFeeTotals._sum.gatewayFeeRefundCents ?? 0,
              platformFeeRefundCents: refundedFeeTotals._sum.platformFeeRefundCents ?? 0,
            }),
            isFullRefund: refundedAmountCents >= currentTransaction.grossAmountCents,
            transactionOccurredAt: currentTransaction.occurredAt,
            occurredAt: refundOccurredAt,
          });
          const auditData = {
            vendorId: reserved.transaction.vendorId,
            actorId: input.actor.id,
            actorLabel: input.actor.label,
            action: "refund_payment_transaction",
            targetType: "PaymentTransaction",
            targetId: reserved.transaction.id,
            before: auditSnapshot(reserved.transaction),
            after: auditSnapshot(transaction),
          };
          // The application transaction always owns AuditLog. The fallback is
          // retained for the narrow transaction double used by legacy action
          // tests, and keeps the audit write after a successful DB commit.
          const auditLog = (tx as unknown as { auditLog?: { create?: (args: { data: typeof auditData }) => Promise<unknown> } }).auditLog;
          if (typeof auditLog?.create === "function") {
            await auditLog.create({ data: auditData });
          } else {
            await writeAuditLog(auditData);
          }
          return transaction;
        }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
        return { disposition: "completed", transaction: completed };
      } catch (error) {
        if (isSerializationConflict(error) && attempt < MAX_COMPLETION_ATTEMPTS) continue;
        throw error;
      }
    }
  } catch {
    return { disposition: "completion_pending_reconciliation" };
  }
  return { disposition: "completion_pending_reconciliation" };
}
