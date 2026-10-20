import { Prisma, type PrismaClient, type Settlement, type SettlementAdjustmentRequest } from "@prisma/client";

import { auditSnapshot } from "@/lib/audit";
import { parseWholeYuanToCents } from "@/lib/money-input";
import { SettlementCarryForwardError, settleNetPayable } from "@/lib/settlement-period";

/**
 * F-049 (B03-15): settlement adjustments.
 *
 * - The amount is strict whole NT$ (see money-input.ts) and a reason is
 *   mandatory (trimmed, at most 500 characters).
 * - If both |new amount| and |new amount - current amount| are at or below
 *   FINANCE_SECOND_APPROVAL_THRESHOLD_CENTS (default 5,000,000 cents =
 *   NT$50,000) the adjustment is applied at once, as before. Comparing the
 *   change as well stops one admin from swinging -T to +T (review n-2).
 * - Otherwise it becomes a pending SettlementAdjustmentRequest and does not
 *   touch the settlement until a different platform admin approves it. The
 *   database repeats the second-person rule in a CHECK constraint.
 * - Locking a settlement closes its pending request as `rejected_by_lock`
 *   with an AuditLog row (review m-4); the settlements page lists it.
 * - F-039 (D-32): a negative adjustment may not push the payout below zero,
 *   but a positive one may reduce a negative balance that carries forward;
 *   the carry ledger row is updated in the same transaction.
 *
 * Every write runs in one serializable transaction with its AuditLog row.
 */
export const DEFAULT_FINANCE_SECOND_APPROVAL_THRESHOLD_CENTS = 5_000_000;
export const SETTLEMENT_ADJUSTMENT_REASON_MAX_LENGTH = 500;

export function financeSecondApprovalThresholdCents(env: Record<string, string | undefined> = process.env) {
  const raw = env.FINANCE_SECOND_APPROVAL_THRESHOLD_CENTS?.trim();
  if (!raw || !/^\d{1,12}$/.test(raw)) return DEFAULT_FINANCE_SECOND_APPROVAL_THRESHOLD_CENTS;
  const value = Number(raw);
  return Number.isSafeInteger(value) ? value : DEFAULT_FINANCE_SECOND_APPROVAL_THRESHOLD_CENTS;
}

export function requiresSecondApproval(
  amountCents: number,
  thresholdCents = financeSecondApprovalThresholdCents(),
  currentAmountCents = 0,
) {
  return Math.abs(amountCents) > thresholdCents || Math.abs(amountCents - currentAmountCents) > thresholdCents;
}

export type SettlementAdjustmentErrorCode =
  | "invalid_adjustment"
  | "adjustment_reason_required"
  | "missing"
  | "locked"
  | "negative_payout"
  | "conflict"
  | "same_approver"
  | "not_pending"
  | "carry_forward_target_locked";

export class SettlementAdjustmentError extends Error {
  constructor(public readonly code: SettlementAdjustmentErrorCode) {
    super(`Settlement adjustment rejected: ${code}`);
  }
}

export function parseSettlementAdjustmentInput(amountRaw: string, reasonRaw: string) {
  const amountCents = parseWholeYuanToCents(amountRaw, { allowNegative: true });
  if (amountCents === null) throw new SettlementAdjustmentError("invalid_adjustment");
  const reason = reasonRaw.trim();
  if (!reason || reason.length > SETTLEMENT_ADJUSTMENT_REASON_MAX_LENGTH) {
    throw new SettlementAdjustmentError("adjustment_reason_required");
  }
  return { amountCents, reason };
}

type AdjustmentDb = Pick<PrismaClient, "$transaction">;
type Actor = { id: string; label: string };

function isSerializableConflict(error: unknown) {
  return error instanceof Prisma.PrismaClientKnownRequestError && (error.code === "P2034" || error.code === "P2002");
}

async function serializable<T>(db: AdjustmentDb, operation: (tx: Prisma.TransactionClient) => Promise<T>) {
  try {
    return await db.$transaction(operation, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  } catch (error) {
    if (isSerializableConflict(error)) throw new SettlementAdjustmentError("conflict");
    throw error;
  }
}

async function supersedePending(tx: Prisma.TransactionClient, settlement: Settlement, actorId: string, now: Date) {
  return tx.settlementAdjustmentRequest.updateMany({
    where: { vendorId: settlement.vendorId, settlementId: settlement.id, status: "pending" },
    data: { status: "superseded", reviewedBy: actorId, reviewedAt: now },
  });
}

function assertAdjustmentKeepsPayout(settlement: Pick<Settlement, "payoutableAmountCents">, amountCents: number) {
  if (amountCents < 0 && settlement.payoutableAmountCents + amountCents < 0) {
    throw new SettlementAdjustmentError("negative_payout");
  }
}

async function applyAdjustment(
  tx: Prisma.TransactionClient,
  settlement: Settlement,
  input: { amountCents: number; reason: string; reviewerId: string },
) {
  assertAdjustmentKeepsPayout(settlement, input.amountCents);
  let carry: Awaited<ReturnType<typeof settleNetPayable>>;
  try {
    carry = await settleNetPayable(tx, {
      vendorId: settlement.vendorId,
      monthKey: settlement.monthKey,
      netPayableCents: settlement.payoutableAmountCents + input.amountCents,
    });
  } catch (error) {
    if (error instanceof SettlementCarryForwardError) throw new SettlementAdjustmentError("carry_forward_target_locked");
    throw error;
  }
  const { finalPayoutAmountCents, carriedOutCents } = carry;
  const result = await tx.settlement.updateMany({
    where: { id: settlement.id, vendorId: settlement.vendorId, lockedAt: null, updatedAt: settlement.updatedAt },
    data: {
      adjustmentAmountCents: input.amountCents,
      adjustmentReason: input.reason,
      reviewedBy: input.reviewerId,
      finalPayoutAmountCents,
      carriedOutCents,
    },
  });
  if (result.count !== 1) throw new SettlementAdjustmentError("conflict");
  const saved = await tx.settlement.findUnique({ where: { id: settlement.id } });
  if (!saved) throw new SettlementAdjustmentError("conflict");
  return saved;
}

async function unlockedSettlement(tx: Prisma.TransactionClient, settlementId: string) {
  const settlement = await tx.settlement.findUnique({ where: { id: settlementId } });
  if (!settlement) throw new SettlementAdjustmentError("missing");
  if (settlement.lockedAt) throw new SettlementAdjustmentError("locked");
  return settlement;
}

export type SubmitSettlementAdjustmentResult =
  | { outcome: "applied"; settlement: Settlement }
  | { outcome: "pending_approval"; request: SettlementAdjustmentRequest };

export async function submitSettlementAdjustment(db: AdjustmentDb, input: {
  settlementId: string;
  amountCents: number;
  reason: string;
  actor: Actor;
  now?: Date;
  thresholdCents?: number;
}): Promise<SubmitSettlementAdjustmentResult> {
  const now = input.now ?? new Date();
  const thresholdCents = input.thresholdCents ?? financeSecondApprovalThresholdCents();
  return serializable(db, async (tx) => {
    const settlement = await unlockedSettlement(tx, input.settlementId);
    assertAdjustmentKeepsPayout(settlement, input.amountCents);
    const superseded = await supersedePending(tx, settlement, input.actor.id, now);

    if (requiresSecondApproval(input.amountCents, thresholdCents, settlement.adjustmentAmountCents)) {
      const request = await tx.settlementAdjustmentRequest.create({
        data: {
          vendorId: settlement.vendorId,
          settlementId: settlement.id,
          amountCents: input.amountCents,
          reason: input.reason,
          requestedBy: input.actor.id,
          requestedAt: now,
        },
      });
      await tx.auditLog.create({
        data: {
          vendorId: settlement.vendorId,
          actorId: input.actor.id,
          actorLabel: input.actor.label,
          action: "request_settlement_adjustment",
          targetType: "Settlement",
          targetId: settlement.id,
          before: auditSnapshot({ settlement, supersededPendingRequests: superseded.count }),
          after: auditSnapshot({ request, thresholdCents }),
        },
      });
      return { outcome: "pending_approval", request };
    }

    const saved = await applyAdjustment(tx, settlement, { amountCents: input.amountCents, reason: input.reason, reviewerId: input.actor.id });
    await tx.auditLog.create({
      data: {
        vendorId: settlement.vendorId,
        actorId: input.actor.id,
        actorLabel: input.actor.label,
        action: "update_settlement_adjustment",
        targetType: "Settlement",
        targetId: settlement.id,
        before: auditSnapshot({ settlement, supersededPendingRequests: superseded.count }),
        after: auditSnapshot(saved),
      },
    });
    return { outcome: "applied", settlement: saved };
  });
}

async function pendingRequest(tx: Prisma.TransactionClient, requestId: string) {
  const request = await tx.settlementAdjustmentRequest.findUnique({ where: { id: requestId } });
  if (!request) throw new SettlementAdjustmentError("missing");
  if (request.status !== "pending") throw new SettlementAdjustmentError("not_pending");
  return request;
}

export async function approveSettlementAdjustment(db: AdjustmentDb, input: { requestId: string; actor: Actor; now?: Date }) {
  const now = input.now ?? new Date();
  return serializable(db, async (tx) => {
    const request = await pendingRequest(tx, input.requestId);
    if (request.requestedBy === input.actor.id) throw new SettlementAdjustmentError("same_approver");
    const settlement = await unlockedSettlement(tx, request.settlementId);
    if (settlement.vendorId !== request.vendorId) throw new SettlementAdjustmentError("missing");
    const saved = await applyAdjustment(tx, settlement, { amountCents: request.amountCents, reason: request.reason, reviewerId: input.actor.id });
    const closed = await tx.settlementAdjustmentRequest.updateMany({
      where: { id: request.id, vendorId: request.vendorId, status: "pending" },
      data: { status: "approved", reviewedBy: input.actor.id, reviewedAt: now },
    });
    if (closed.count !== 1) throw new SettlementAdjustmentError("conflict");
    await tx.auditLog.create({
      data: {
        vendorId: settlement.vendorId,
        actorId: input.actor.id,
        actorLabel: input.actor.label,
        action: "approve_settlement_adjustment",
        targetType: "Settlement",
        targetId: settlement.id,
        before: auditSnapshot({ settlement, request }),
        after: auditSnapshot({ settlement: saved, requestId: request.id, requestedBy: request.requestedBy, status: "approved" }),
      },
    });
    return { settlement: saved, request: { ...request, status: "approved", reviewedBy: input.actor.id, reviewedAt: now } };
  });
}

/**
 * Called inside the lock transaction after the settlement row was locked:
 * a pending request can no longer be approved, so close it visibly.
 */
export async function closePendingAdjustmentsOnLock(
  tx: Prisma.TransactionClient,
  input: { settlement: Pick<Settlement, "id" | "vendorId">; actor: Actor; now: Date },
) {
  const pending = await tx.settlementAdjustmentRequest.findMany({
    where: { vendorId: input.settlement.vendorId, settlementId: input.settlement.id, status: "pending" },
  });
  for (const request of pending) {
    const closed = await tx.settlementAdjustmentRequest.updateMany({
      where: { id: request.id, vendorId: request.vendorId, status: "pending" },
      data: { status: "rejected_by_lock", reviewedBy: input.actor.id, reviewedAt: input.now },
    });
    if (closed.count !== 1) throw new SettlementAdjustmentError("conflict");
    await tx.auditLog.create({
      data: {
        vendorId: request.vendorId,
        actorId: input.actor.id,
        actorLabel: input.actor.label,
        action: "reject_settlement_adjustment_on_lock",
        targetType: "Settlement",
        targetId: request.settlementId,
        before: auditSnapshot(request),
        after: auditSnapshot({ requestId: request.id, requestedBy: request.requestedBy, status: "rejected_by_lock" }),
      },
    });
  }
  return pending.length;
}

/** Any platform finance admin, including the requester, may reject or withdraw. */
export async function rejectSettlementAdjustment(db: AdjustmentDb, input: { requestId: string; actor: Actor; now?: Date }) {
  const now = input.now ?? new Date();
  return serializable(db, async (tx) => {
    const request = await pendingRequest(tx, input.requestId);
    const closed = await tx.settlementAdjustmentRequest.updateMany({
      where: { id: request.id, vendorId: request.vendorId, status: "pending" },
      data: { status: "rejected", reviewedBy: input.actor.id, reviewedAt: now },
    });
    if (closed.count !== 1) throw new SettlementAdjustmentError("conflict");
    await tx.auditLog.create({
      data: {
        vendorId: request.vendorId,
        actorId: input.actor.id,
        actorLabel: input.actor.label,
        action: "reject_settlement_adjustment",
        targetType: "Settlement",
        targetId: request.settlementId,
        before: auditSnapshot(request),
        after: auditSnapshot({ requestId: request.id, status: "rejected" }),
      },
    });
    return { requestId: request.id, settlementId: request.settlementId };
  });
}
