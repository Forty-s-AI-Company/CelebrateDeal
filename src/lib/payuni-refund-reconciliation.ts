import { createHash } from "node:crypto";
import { Prisma, type PaymentTransaction, type PrismaClient, type RefundRecord } from "@prisma/client";
import {
  applyPaymentRefundAccounting,
  calculateNetReferenceAmountCents,
} from "@/lib/payment-refund-accounting";
import type { PaymentQueryResult } from "@/lib/payment-providers/types";

export type RefundReconciliationDisposition = "reconciled" | "already_reconciled" | "provider_not_refunded";

export type RefundReconciliationResult = {
  disposition: RefundReconciliationDisposition;
  transactionId: string;
  processedRefundRecordCount: number;
  refundedAmountCents: number;
};

export class PayUniRefundReconciliationError extends Error {
  constructor(public readonly reason:
    | "provider_mismatch"
    | "transaction_not_found"
    | "unsupported_status"
    | "provider_amount_mismatch"
    | "provider_ref_mismatch"
    | "local_amount_mismatch"
    | "local_state_ambiguous") {
    super("PayUni refund reconciliation failed.");
  }
}

export type RefundReconciliationActor = {
  id: string;
  label: string;
};

export function validatePayUniRefundSnapshot(
  transaction: Pick<PaymentTransaction, "providerName" | "providerTradeNo" | "orderNumber" | "grossAmountCents">,
  snapshot: PaymentQueryResult,
) {
  if (transaction.providerName !== "payuni") {
    throw new PayUniRefundReconciliationError("provider_mismatch");
  }
  if (!transaction.providerTradeNo || snapshot.providerTradeNo !== transaction.providerTradeNo) {
    throw new PayUniRefundReconciliationError("provider_ref_mismatch");
  }
  if (!transaction.orderNumber || snapshot.orderNumber !== transaction.orderNumber) {
    throw new PayUniRefundReconciliationError("provider_ref_mismatch");
  }
  if (snapshot.grossAmountCents !== transaction.grossAmountCents) {
    throw new PayUniRefundReconciliationError("provider_amount_mismatch");
  }
  const isFullRefund = snapshot.status === "refunded"
    && snapshot.refundedAmountCents === snapshot.grossAmountCents
    && snapshot.remainingRefundableAmountCents === 0;
  const isPartialRefund = snapshot.status === "partially_refunded"
    && snapshot.refundedAmountCents > 0
    && snapshot.refundedAmountCents < snapshot.grossAmountCents
    && snapshot.remainingRefundableAmountCents === snapshot.grossAmountCents - snapshot.refundedAmountCents;
  const isPaid = snapshot.status === "paid"
    && snapshot.refundedAmountCents === 0
    && snapshot.remainingRefundableAmountCents === snapshot.grossAmountCents;
  if (!isFullRefund && !isPartialRefund && !isPaid) {
    throw new PayUniRefundReconciliationError("unsupported_status");
  }
}

type ReconciliationDb = Pick<PrismaClient, "paymentTransaction" | "refundRecord" | "auditLog" | "$transaction">;

type TransactionRow = Pick<PaymentTransaction,
  "id" | "vendorId" | "providerName" | "providerTradeNo" | "orderNumber" | "grossAmountCents" | "netAmountCents" | "refundedAmountCents" | "status" | "refundReason" | "refundedAt" | "occurredAt"
>;

type RefundRow = Pick<RefundRecord, "id" | "refundAmountCents" | "status" | "providerEventId">;

function isRequestReservationId(value: string | null): value is string {
  return typeof value === "string" && /^request:[a-f0-9]{32}$/.test(value);
}

function isAmbiguousReservationId(value: string | null): value is string {
  return typeof value === "string" && /^ambiguous:[a-f0-9]{32}$/.test(value);
}

function isRefundReservationId(value: string | null): value is string {
  return isRequestReservationId(value) || isAmbiguousReservationId(value);
}

function reconciliationEventId(providerTradeNo: string, refundRecordId: string, requestReservationId: string) {
  // PayUni's query snapshot is cumulative and does not expose a stable
  // provider-side ID for each refund. Bind the durable event identity to the
  // locally reserved refund instead, so two legitimate partial refunds on the
  // same trade remain distinct while a retry of either reservation is stable.
  const identity = `${providerTradeNo}\u0000${refundRecordId}\u0000${requestReservationId}`;
  return `reconcile:payuni:${createHash("sha256").update(identity, "utf8").digest("hex")}`;
}

export async function reconcilePayUniRefund(input: {
  db: ReconciliationDb;
  transactionId: string;
  providerSnapshot: PaymentQueryResult;
  actor: RefundReconciliationActor;
  now?: Date;
}): Promise<RefundReconciliationResult> {
  return input.db.$transaction(async (tx) => {
    const transaction = await tx.paymentTransaction.findUnique({ where: { id: input.transactionId } }) as TransactionRow | null;
    if (!transaction) throw new PayUniRefundReconciliationError("transaction_not_found");
    validatePayUniRefundSnapshot(transaction, input.providerSnapshot);

    const pending = await tx.refundRecord.findMany({
      where: { paymentTransactionId: transaction.id, status: "pending" },
      orderBy: { createdAt: "asc" },
      select: { id: true, refundAmountCents: true, status: true, providerEventId: true },
    }) as RefundRow[];
    const records = await tx.refundRecord.aggregate({
      where: { paymentTransactionId: transaction.id, status: { in: ["pending", "processed"] } },
      _sum: { refundAmountCents: true, gatewayFeeRefundCents: true, platformFeeRefundCents: true },
    });
    const reservedAmountCents = records._sum.refundAmountCents ?? 0;
    const pendingAmountCents = pending.reduce((sum, refund) => sum + refund.refundAmountCents, 0);
    const processedAmountCents = reservedAmountCents - pendingAmountCents;

    if (
      pending.length === 0
      && (transaction.status === "refunded" || transaction.status === "partially_refunded")
      && processedAmountCents === transaction.refundedAmountCents
      && transaction.refundedAmountCents === input.providerSnapshot.refundedAmountCents
      && reservedAmountCents === input.providerSnapshot.refundedAmountCents
    ) {
      return {
        disposition: "already_reconciled",
        transactionId: transaction.id,
        processedRefundRecordCount: 0,
        refundedAmountCents: transaction.refundedAmountCents,
      };
    }
    if (pending.length === 0 && (transaction.status === "refunded" || transaction.status === "partially_refunded")) {
      throw new PayUniRefundReconciliationError("local_amount_mismatch");
    }
    if (transaction.status !== "paid" && transaction.status !== "partially_refunded") {
      throw new PayUniRefundReconciliationError("local_state_ambiguous");
    }
    if (pending.length !== 1 || pendingAmountCents <= 0) {
      throw new PayUniRefundReconciliationError("local_state_ambiguous");
    }
    const pendingRefund = pending[0];
    if (!pendingRefund || !isRefundReservationId(pendingRefund.providerEventId)) {
      throw new PayUniRefundReconciliationError("local_state_ambiguous");
    }
    if (processedAmountCents !== transaction.refundedAmountCents) {
      throw new PayUniRefundReconciliationError("local_amount_mismatch");
    }
    const now = input.now ?? new Date();
    // A no-refund snapshot may only release a reservation after the issuing
    // action has durably marked its provider outcome ambiguous. A plain
    // request:* reservation may still be in-flight, so it must remain locked.
    if (
      input.providerSnapshot.status === transaction.status
      && input.providerSnapshot.refundedAmountCents === transaction.refundedAmountCents
    ) {
      if (!isAmbiguousReservationId(pendingRefund.providerEventId)) {
        throw new PayUniRefundReconciliationError("local_state_ambiguous");
      }
      await tx.refundRecord.update({
        where: {
          id: pendingRefund.id,
          status: "pending",
          providerEventId: pendingRefund.providerEventId,
        },
        data: { status: "failed" },
      });
      await tx.auditLog.create({
        data: {
          vendorId: transaction.vendorId,
          actorId: input.actor.id,
          actorLabel: input.actor.label,
          action: "resolve_payuni_refund_not_processed",
          targetType: "PaymentTransaction",
          targetId: transaction.id,
          before: {
            status: transaction.status,
            refundedAmountCents: transaction.refundedAmountCents,
            pendingRefundRecordCount: pending.length,
          } satisfies Prisma.InputJsonValue,
          after: {
            status: transaction.status,
            refundedAmountCents: transaction.refundedAmountCents,
            failedRefundRecordCount: pending.length,
          } satisfies Prisma.InputJsonValue,
        },
      });
      return {
        disposition: "provider_not_refunded",
        transactionId: transaction.id,
        processedRefundRecordCount: 0,
        refundedAmountCents: transaction.refundedAmountCents,
      };
    }
    if (reservedAmountCents !== input.providerSnapshot.refundedAmountCents) {
      throw new PayUniRefundReconciliationError("local_amount_mismatch");
    }
    if (transaction.refundedAmountCents + pendingAmountCents !== input.providerSnapshot.refundedAmountCents) {
      throw new PayUniRefundReconciliationError("local_amount_mismatch");
    }

    const eventIdentity = reconciliationEventId(
      input.providerSnapshot.providerTradeNo,
      pendingRefund.id,
      pendingRefund.providerEventId,
    );
    await tx.refundRecord.update({
      where: {
        id: pendingRefund.id,
        status: "pending",
        providerEventId: pendingRefund.providerEventId,
      },
      data: {
        status: "processed",
        processedAt: now,
        providerEventId: eventIdentity,
      },
    });
    const updated = await tx.paymentTransaction.update({
      where: { id: transaction.id },
      data: {
        status: input.providerSnapshot.status,
        refundedAmountCents: input.providerSnapshot.refundedAmountCents,
        refundedAt: now,
      },
    });
    await applyPaymentRefundAccounting(tx, {
      vendorId: transaction.vendorId,
      transactionId: transaction.id,
      orderNumber: transaction.orderNumber,
      providerName: transaction.providerName,
      eventIdentity,
      refundRecordId: pendingRefund.id,
      refundAmountCents: pendingAmountCents,
      netReferenceAmountCents: calculateNetReferenceAmountCents({
        netAmountCents: Number.isSafeInteger(transaction.netAmountCents)
          ? transaction.netAmountCents
          : transaction.grossAmountCents,
        refundedAmountCents: updated.refundedAmountCents,
        gatewayFeeRefundCents: records._sum.gatewayFeeRefundCents ?? 0,
        platformFeeRefundCents: records._sum.platformFeeRefundCents ?? 0,
      }),
      isFullRefund: updated.status === "refunded",
      transactionOccurredAt: transaction.occurredAt instanceof Date ? transaction.occurredAt : now,
      occurredAt: now,
    });
    await tx.auditLog.create({
      data: {
        vendorId: transaction.vendorId,
        actorId: input.actor.id,
        actorLabel: input.actor.label,
        action: "reconcile_payuni_refund",
        targetType: "PaymentTransaction",
        targetId: transaction.id,
        before: {
          status: transaction.status,
          refundedAmountCents: transaction.refundedAmountCents,
          pendingRefundRecordCount: pending.length,
        } satisfies Prisma.InputJsonValue,
        after: {
          status: updated.status,
          refundedAmountCents: updated.refundedAmountCents,
          processedRefundRecordCount: pending.length,
        } satisfies Prisma.InputJsonValue,
      },
    });

    return {
      disposition: "reconciled",
      transactionId: transaction.id,
      processedRefundRecordCount: pending.length,
      refundedAmountCents: updated.refundedAmountCents,
    };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}
