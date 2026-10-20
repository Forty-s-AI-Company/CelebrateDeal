import type { Prisma, Settlement } from "@prisma/client";

import { SETTLEMENT_REVENUE_TRANSACTION_WHERE } from "@/lib/billing";

/**
 * F-039 / B03-03 (owner decision D-32): which settlement month a refund
 * belongs to, and how a negative month carries into the next one.
 *
 * - A refund's month is the server time the refund completed (UTC, the same
 *   calendar as monthRange), never a form value or a provider timestamp.
 *   If that month's settlement is already locked, the refund moves to the
 *   next unlocked month, so a locked settlement never misses a refund.
 * - A month whose payable is negative pays out 0 and writes the shortfall to
 *   SettlementAdjustmentLedgerEntry for the next unlocked month, which
 *   deducts it. Nothing is truncated to zero.
 * - Locking re-reads the refunds and carries the settlement was computed
 *   from; anything that changed since requires a regeneration first.
 */
type SettlementPeriodDb = Pick<Prisma.TransactionClient, "settlement">;
type CarryForwardDb = Pick<Prisma.TransactionClient, "settlement" | "settlementAdjustmentLedgerEntry">;
type LockInputsDb = Pick<Prisma.TransactionClient, "refundRecord" | "settlementAdjustmentLedgerEntry">;

export const NEGATIVE_BALANCE_CARRY_FORWARD = "negative_balance_carry_forward";

export function settlementMonthKeyOf(date: Date) {
  return date.toISOString().slice(0, 7);
}

export function nextSettlementMonthKey(monthKey: string) {
  const [year, month] = monthKey.split("-").map((part) => Number.parseInt(part, 10));
  if (year === undefined || month === undefined || !Number.isInteger(year) || !Number.isInteger(month)) {
    throw new Error("invalid_month");
  }
  return settlementMonthKeyOf(new Date(Date.UTC(year, month, 1)));
}

/** The first month at or after fromMonthKey whose settlement is not locked. */
export async function firstOpenSettlementMonthKey(db: SettlementPeriodDb, vendorId: string, fromMonthKey: string) {
  const locked = await db.settlement.findMany({
    where: { vendorId, monthKey: { gte: fromMonthKey }, lockedAt: { not: null } },
    select: { monthKey: true },
  });
  const lockedMonths = new Set(locked.map((settlement) => settlement.monthKey));
  let monthKey = fromMonthKey;
  while (lockedMonths.has(monthKey)) monthKey = nextSettlementMonthKey(monthKey);
  return monthKey;
}

/** Call inside the transaction that marks the refund processed. */
export function refundSettlementMonthKey(db: SettlementPeriodDb, vendorId: string, completedAt: Date) {
  return firstOpenSettlementMonthKey(db, vendorId, settlementMonthKeyOf(completedAt));
}

export class SettlementCarryForwardError extends Error {
  readonly code = "carry_forward_target_locked" as const;

  constructor() {
    super("carry_forward_target_locked");
    this.name = "SettlementCarryForwardError";
  }
}

/**
 * Review m-1: a manual negative adjustment can reduce the payout to 0 but
 * never creates or deepens a carry, also when a later regeneration shrinks
 * the payable under an adjustment approved earlier. A positive adjustment
 * may reduce a carry.
 */
export function splitNetPayable(payableCents: number, adjustmentCents: number) {
  const netCents = payableCents + adjustmentCents;
  return {
    finalPayoutAmountCents: Math.max(0, netCents),
    carriedOutCents: adjustmentCents < 0 ? Math.min(0, payableCents) : Math.min(0, netCents),
  };
}

/**
 * Split a month's net payable into a payout (>= 0) and a carry (<= 0), and
 * keep the single ledger row of this source month in step. Must run in the
 * same Serializable transaction that writes the settlement.
 */
export async function settleNetPayable(
  tx: CarryForwardDb,
  input: { vendorId: string; monthKey: string; payableCents: number; adjustmentCents: number },
) {
  const { carriedOutCents, finalPayoutAmountCents } = splitNetPayable(input.payableCents, input.adjustmentCents);
  const existing = await tx.settlementAdjustmentLedgerEntry.findUnique({
    where: {
      vendorId_kind_sourceMonthKey: {
        vendorId: input.vendorId,
        kind: NEGATIVE_BALANCE_CARRY_FORWARD,
        sourceMonthKey: input.monthKey,
      },
    },
  });

  if (existing) {
    if (existing.amountCents !== carriedOutCents) {
      const targetLocked = await tx.settlement.findFirst({
        where: { vendorId: input.vendorId, monthKey: existing.targetMonthKey, lockedAt: { not: null } },
        select: { id: true },
      });
      // A locked month already deducted this carry; changing it would pay
      // out or deduct the difference twice. Only an unused row may move.
      if (targetLocked && existing.amountCents !== 0) throw new SettlementCarryForwardError();
      await tx.settlementAdjustmentLedgerEntry.update({
        where: { id: existing.id },
        data: {
          amountCents: carriedOutCents,
          ...(targetLocked ? {
            targetMonthKey: await firstOpenSettlementMonthKey(tx, input.vendorId, nextSettlementMonthKey(input.monthKey)),
          } : {}),
        },
      });
    }
  } else if (carriedOutCents < 0) {
    await tx.settlementAdjustmentLedgerEntry.create({
      data: {
        vendorId: input.vendorId,
        kind: NEGATIVE_BALANCE_CARRY_FORWARD,
        sourceMonthKey: input.monthKey,
        targetMonthKey: await firstOpenSettlementMonthKey(tx, input.vendorId, nextSettlementMonthKey(input.monthKey)),
        amountCents: carriedOutCents,
      },
    });
  }

  return { finalPayoutAmountCents, carriedOutCents };
}

export async function carriedIntoMonthCents(db: Pick<Prisma.TransactionClient, "settlementAdjustmentLedgerEntry">, vendorId: string, monthKey: string) {
  const carried = await db.settlementAdjustmentLedgerEntry.aggregate({
    where: { vendorId, targetMonthKey: monthKey },
    _sum: { amountCents: true },
  });
  return carried._sum.amountCents ?? 0;
}

export class SettlementInputsChangedError extends Error {
  readonly code = "stale_settlement" as const;

  constructor() {
    super("stale_settlement");
    this.name = "SettlementInputsChangedError";
  }
}

/**
 * Lock-time check: the refunds and carries booked into this month must equal
 * what the settlement was computed from. Run inside a Serializable lock
 * transaction so a concurrent refund either commits first (and fails this
 * check) or observes the lock and books itself into the next month.
 */
export async function assertSettlementInputsUnchanged(
  tx: LockInputsDb,
  settlement: Pick<Settlement, "vendorId" | "monthKey" | "refundAmountCents" | "carriedInCents">,
) {
  const [refunds, carriedInCents] = await Promise.all([
    tx.refundRecord.aggregate({
      where: {
        vendorId: settlement.vendorId,
        monthKey: settlement.monthKey,
        status: "processed",
        paymentTransaction: SETTLEMENT_REVENUE_TRANSACTION_WHERE,
      },
      _sum: { refundAmountCents: true },
    }),
    carriedIntoMonthCents(tx, settlement.vendorId, settlement.monthKey),
  ]);
  if ((refunds._sum.refundAmountCents ?? 0) !== settlement.refundAmountCents || carriedInCents !== settlement.carriedInCents) {
    throw new SettlementInputsChangedError();
  }
}
