import { Prisma, type PrismaClient } from "@prisma/client";

import type { PaymentQueryResult } from "@/lib/payment-providers/types";
import {
  isRefundReservationId,
  PayUniRefundReconciliationError,
  validatePayUniRefundSnapshot,
  type RefundReconciliationActor,
} from "@/lib/payuni-refund-reconciliation";

/**
 * F-046 (B03-11): manual release of a PayUni refund reservation that PayUni
 * repeatedly confirms never happened.
 *
 * A pending reservation (`request:` or `ambiguous:`) blocks every further
 * refund of its trade, and `reconcilePayUniRefund` deliberately refuses to
 * infer "no refund" from one unchanged snapshot because PayUni's query can lag
 * a successful close. This module records each validated query whose
 * cumulative state still equals the local processed state ("no refund"
 * confirmation) and lets a finance admin release the hold only when:
 *
 * - at least `requiredConfirmations` consecutive *counted* confirmations
 *   exist, including the fresh query made by the release action itself;
 * - a confirmation counts only once the reservation is older than the window
 *   (default 24 hours) and at least `minIntervalMs` (default 6 hours) after
 *   the previous counted one, so the earliest release with the defaults is
 *   24 + 2 x 6 = 36 hours after the reservation (review M-1: three clicks in
 *   a minute must never release a hold);
 * - the trade still has exactly that one pending reservation.
 *
 * A query that is too early or too soon after the last counted one is still
 * audited (`counted: false`) but does not change the streak.
 *
 * Nothing here runs automatically. A validated snapshot that shows any other
 * state, or a local ledger mismatch, resets the streak. A provider transport
 * failure never reaches this module and is neither counted nor a reset.
 * Release marks the reservation `failed` (it never reached PayUni) with
 * `holdReleasedAt`, and every confirmation or release writes AuditLog in the
 * same serializable transaction.
 */
export const DEFAULT_REFUND_HOLD_RELEASE_CONFIRMATIONS = 3;
export const DEFAULT_REFUND_HOLD_RELEASE_WINDOW_HOURS = 24;
export const DEFAULT_REFUND_HOLD_CONFIRMATION_INTERVAL_HOURS = 6;

export type PayUniRefundHoldPolicy = { requiredConfirmations: number; windowMs: number; minIntervalMs: number };

function boundedInteger(raw: string | undefined, fallback: number, min: number, max: number) {
  const value = raw?.trim();
  if (!value || !/^\d{1,4}$/.test(value)) return fallback;
  const parsed = Number(value);
  return parsed >= min && parsed <= max ? parsed : fallback;
}

/** Invalid or too-permissive overrides fall back to the defaults. */
export function payUniRefundHoldPolicy(env: Record<string, string | undefined> = process.env): PayUniRefundHoldPolicy {
  const requiredConfirmations = boundedInteger(
    env.PAYUNI_REFUND_HOLD_RELEASE_CONFIRMATIONS, DEFAULT_REFUND_HOLD_RELEASE_CONFIRMATIONS, 2, 20,
  );
  const hours = boundedInteger(env.PAYUNI_REFUND_HOLD_RELEASE_WINDOW_HOURS, DEFAULT_REFUND_HOLD_RELEASE_WINDOW_HOURS, 1, 720);
  const intervalHours = boundedInteger(
    env.PAYUNI_REFUND_HOLD_CONFIRMATION_INTERVAL_HOURS, DEFAULT_REFUND_HOLD_CONFIRMATION_INTERVAL_HOURS, 1, 168,
  );
  return { requiredConfirmations, windowMs: hours * HOUR_MS, minIntervalMs: intervalHours * HOUR_MS };
}

const HOUR_MS = 60 * 60 * 1000;

/** Earliest moment a release query could complete the streak, assuming every check confirms "no refund". */
export function payUniRefundHoldEarliestReleaseAt(
  refund: { createdAt: Date; providerNoRefundCheckCount: number; providerNoRefundLastCheckedAt: Date | null },
  policy: PayUniRefundHoldPolicy,
) {
  const remaining = Math.max(0, policy.requiredConfirmations - refund.providerNoRefundCheckCount - 1);
  return new Date(payUniRefundHoldNextCountableAt(refund, policy).getTime() + remaining * policy.minIntervalMs);
}

/** When the next query can count: after the window, and one interval after the last counted confirmation. */
export function payUniRefundHoldNextCountableAt(
  refund: { createdAt: Date; providerNoRefundCheckCount: number; providerNoRefundLastCheckedAt: Date | null },
  policy: PayUniRefundHoldPolicy,
) {
  const windowEnd = payUniRefundHoldEligibleAt(refund.createdAt, policy).getTime();
  const afterLast = refund.providerNoRefundCheckCount > 0 && refund.providerNoRefundLastCheckedAt
    ? refund.providerNoRefundLastCheckedAt.getTime() + policy.minIntervalMs
    : windowEnd;
  return new Date(Math.max(windowEnd, afterLast));
}

export function payUniRefundHoldEligibleAt(reservedAt: Date, policy: PayUniRefundHoldPolicy) {
  return new Date(reservedAt.getTime() + policy.windowMs);
}

export class PayUniRefundHoldError extends Error {
  constructor(public readonly reason:
    | "transaction_not_found"
    | "no_single_pending_reservation"
    | "provider_reports_refund_activity"
    | "local_amount_mismatch"
    | "concurrent_update") {
    super("PayUni refund hold check failed.");
  }
}

export type PayUniRefundHoldCheckResult = {
  disposition: "no_refund_confirmed" | "released";
  refundRecordId: string;
  confirmations: number;
  requiredConfirmations: number;
  eligibleAt: Date;
  /** False when the query was too early or too soon after the last counted one. */
  counted: boolean;
  nextCountableAt: Date;
  releasable: boolean;
};

type HoldDb = Pick<PrismaClient, "paymentTransaction" | "refundRecord" | "auditLog" | "$transaction">;

/** Breaks the "consecutive" streak after a contradicting provider answer. */
export async function resetPayUniRefundHoldChecks(db: Pick<PrismaClient, "refundRecord">, transactionId: string) {
  await db.refundRecord.updateMany({
    where: { paymentTransactionId: transactionId, status: "pending", providerNoRefundCheckCount: { gt: 0 } },
    data: { providerNoRefundCheckCount: 0, providerNoRefundFirstCheckedAt: null, providerNoRefundLastCheckedAt: null },
  });
}

function breaksStreak(error: unknown) {
  if (error instanceof PayUniRefundReconciliationError) return error.reason !== "transaction_not_found";
  return error instanceof PayUniRefundHoldError
    && (error.reason === "provider_reports_refund_activity" || error.reason === "local_amount_mismatch");
}

export async function recordPayUniRefundHoldCheck(input: {
  db: HoldDb;
  transactionId: string;
  /** Required for release: the reservation the admin saw on the page. */
  refundRecordId?: string;
  providerSnapshot: PaymentQueryResult;
  actor: RefundReconciliationActor;
  release: boolean;
  now?: Date;
  policy?: PayUniRefundHoldPolicy;
}): Promise<PayUniRefundHoldCheckResult> {
  const now = input.now ?? new Date();
  const policy = input.policy ?? payUniRefundHoldPolicy();
  if (input.release && !input.refundRecordId) throw new PayUniRefundHoldError("no_single_pending_reservation");
  try {
    return await input.db.$transaction(async (tx) => {
      const transaction = await tx.paymentTransaction.findUnique({ where: { id: input.transactionId } });
      if (!transaction) throw new PayUniRefundHoldError("transaction_not_found");
      validatePayUniRefundSnapshot(transaction, input.providerSnapshot);
      if (transaction.status !== "paid" && transaction.status !== "partially_refunded") {
        throw new PayUniRefundHoldError("no_single_pending_reservation");
      }
      const pending = await tx.refundRecord.findMany({
        where: { vendorId: transaction.vendorId, paymentTransactionId: transaction.id, status: "pending" },
        orderBy: { createdAt: "asc" },
        take: 2,
      });
      const refund = pending.length === 1 ? pending[0] : undefined;
      if (!refund || !isRefundReservationId(refund.providerEventId)
        || (input.refundRecordId !== undefined && refund.id !== input.refundRecordId)) {
        throw new PayUniRefundHoldError("no_single_pending_reservation");
      }
      const processed = await tx.refundRecord.aggregate({
        where: { vendorId: transaction.vendorId, paymentTransactionId: transaction.id, status: "processed" },
        _sum: { refundAmountCents: true },
      });
      if ((processed._sum.refundAmountCents ?? 0) !== transaction.refundedAmountCents) {
        throw new PayUniRefundHoldError("local_amount_mismatch");
      }
      // "No refund" means PayUni's cumulative state equals the local processed
      // state exactly; anything else is refund activity to reconcile instead.
      if (input.providerSnapshot.status !== transaction.status
        || input.providerSnapshot.refundedAmountCents !== transaction.refundedAmountCents) {
        throw new PayUniRefundHoldError("provider_reports_refund_activity");
      }

      const eligibleAt = payUniRefundHoldEligibleAt(refund.createdAt, policy);
      const counted = now.getTime() >= payUniRefundHoldNextCountableAt(refund, policy).getTime();
      const confirmations = refund.providerNoRefundCheckCount + (counted ? 1 : 0);
      const releasable = counted && confirmations >= policy.requiredConfirmations;
      const release = input.release && releasable;
      if (counted) {
        const updated = await tx.refundRecord.updateMany({
          where: {
            id: refund.id,
            vendorId: transaction.vendorId,
            status: "pending",
            providerEventId: refund.providerEventId,
            providerNoRefundCheckCount: refund.providerNoRefundCheckCount,
          },
          data: {
            providerNoRefundCheckCount: confirmations,
            providerNoRefundFirstCheckedAt: refund.providerNoRefundFirstCheckedAt ?? now,
            providerNoRefundLastCheckedAt: now,
            ...(release ? { status: "failed", holdReleasedAt: now } : {}),
          },
        });
        if (updated.count !== 1) throw new PayUniRefundHoldError("concurrent_update");
      }
      const nextCountableAt = payUniRefundHoldNextCountableAt({
        createdAt: refund.createdAt,
        providerNoRefundCheckCount: confirmations,
        providerNoRefundLastCheckedAt: counted ? now : refund.providerNoRefundLastCheckedAt,
      }, policy);

      await tx.auditLog.create({
        data: {
          vendorId: transaction.vendorId,
          actorId: input.actor.id,
          actorLabel: input.actor.label,
          action: release ? "release_payuni_refund_hold" : "confirm_payuni_refund_no_refund",
          targetType: "RefundRecord",
          targetId: refund.id,
          before: {
            status: "pending",
            providerNoRefundCheckCount: refund.providerNoRefundCheckCount,
            transactionStatus: transaction.status,
            refundedAmountCents: transaction.refundedAmountCents,
          } satisfies Prisma.InputJsonValue,
          after: {
            status: release ? "failed" : "pending",
            providerNoRefundCheckCount: confirmations,
            counted,
            requiredConfirmations: policy.requiredConfirmations,
            eligibleAt: eligibleAt.toISOString(),
            nextCountableAt: nextCountableAt.toISOString(),
            refundAmountCents: refund.refundAmountCents,
            providerStatus: input.providerSnapshot.status,
            providerRefundedAmountCents: input.providerSnapshot.refundedAmountCents,
          } satisfies Prisma.InputJsonValue,
        },
      });
      return {
        disposition: release ? "released" : "no_refund_confirmed",
        refundRecordId: refund.id,
        confirmations,
        requiredConfirmations: policy.requiredConfirmations,
        eligibleAt,
        counted,
        nextCountableAt,
        releasable,
      } satisfies PayUniRefundHoldCheckResult;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  } catch (error) {
    if (breaksStreak(error)) await resetPayUniRefundHoldChecks(input.db, input.transactionId);
    throw error;
  }
}
