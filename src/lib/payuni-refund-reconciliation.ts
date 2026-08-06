import { createHash } from "node:crypto";
import { Prisma, type PaymentTransaction, type PrismaClient, type RefundRecord } from "@prisma/client";
import type { PaymentQueryResult } from "@/lib/payment-providers/types";

export type RefundReconciliationDisposition = "reconciled" | "already_reconciled";

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
  if (!isFullRefund && !isPartialRefund) {
    throw new PayUniRefundReconciliationError("unsupported_status");
  }
}

type ReconciliationDb = Pick<PrismaClient, "paymentTransaction" | "refundRecord" | "auditLog" | "$transaction">;

type TransactionRow = Pick<PaymentTransaction,
  "id" | "vendorId" | "providerName" | "providerTradeNo" | "orderNumber" | "grossAmountCents" | "refundedAmountCents" | "status" | "refundReason" | "refundedAt"
>;

type RefundRow = Pick<RefundRecord, "id" | "refundAmountCents" | "status" | "providerEventId">;

function isRequestReservationId(value: string | null): value is string {
  return typeof value === "string" && /^request:[a-f0-9]{32}$/.test(value);
}

function reconciliationEventId(providerTradeNo: string) {
  return `reconcile:payuni:${createHash("sha256").update(providerTradeNo, "utf8").digest("hex")}`;
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
      _sum: { refundAmountCents: true },
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
    if (!pendingRefund || !isRequestReservationId(pendingRefund.providerEventId)) {
      throw new PayUniRefundReconciliationError("local_state_ambiguous");
    }
    if (
      processedAmountCents !== transaction.refundedAmountCents
      || reservedAmountCents !== input.providerSnapshot.refundedAmountCents
    ) {
      throw new PayUniRefundReconciliationError("local_amount_mismatch");
    }
    if (transaction.refundedAmountCents + pendingAmountCents !== input.providerSnapshot.refundedAmountCents) {
      throw new PayUniRefundReconciliationError("local_amount_mismatch");
    }

    const now = input.now ?? new Date();
    await tx.refundRecord.update({
      where: { id: pendingRefund.id },
      data: {
        status: "processed",
        processedAt: now,
        providerEventId: reconciliationEventId(input.providerSnapshot.providerTradeNo),
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
