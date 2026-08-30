import { Prisma } from "@prisma/client";
import { appendPlatformReferralCommissionLedgerEntry } from "@/lib/platform-referral-commission";

export type PlatformReferralPayoutDb = Pick<
  Prisma.TransactionClient,
  | "platformReferralAttribution"
  | "platformReferralCommission"
  | "platformReferralCommissionLedgerEntry"
  | "platformReferralPayout"
  | "platformReferralPayoutBatch"
>;

export class PlatformReferralPayoutMutationConflict extends Error {}

type PlatformReferralPayoutPeriod = {
  monthKey: string;
};

function payoutAmounts(amountCents: number) {
  if (!Number.isSafeInteger(amountCents) || amountCents < 0) {
    throw new PlatformReferralPayoutMutationConflict("平台推薦 payout 淨額不可為負數或非整數。");
  }
  return {
    commissionAmountCents: amountCents,
    adjustmentAmountCents: 0,
    finalAmountCents: amountCents,
  };
}

function requiredText(value: string, field: string) {
  const normalized = value.normalize("NFKC").trim();
  if (!normalized) throw new PlatformReferralPayoutMutationConflict(`${field} 不可為空白。`);
  return normalized;
}

function validMonthKey(value: string) {
  const monthKey = requiredText(value, "monthKey");
  if (!/^\d{4}-(0[1-9]|1[0-2])$/u.test(monthKey)) {
    throw new PlatformReferralPayoutMutationConflict("monthKey 格式不正確。");
  }
  return monthKey;
}

async function ownerBalance(
  db: PlatformReferralPayoutDb,
  input: { ownerUserId: string; monthKey: string },
) {
  const aggregate = await db.platformReferralCommissionLedgerEntry.aggregate({
    where: {
      commission: {
        ownerUserId: input.ownerUserId,
        monthKey: input.monthKey,
      },
    },
    _sum: { amountCents: true },
  });
  return aggregate._sum.amountCents ?? 0;
}

export async function platformReferralPayoutBalance(
  db: PlatformReferralPayoutDb,
  input: { ownerUserId: string; monthKey: string },
) {
  const ownerUserId = requiredText(input.ownerUserId, "ownerUserId");
  const monthKey = validMonthKey(input.monthKey);
  return payoutAmounts(await ownerBalance(db, { ownerUserId, monthKey })).finalAmountCents;
}

/** Syncs a local owner/month payable read model from immutable commission ledger entries. */
export async function syncPlatformReferralPayoutsForMonth(
  db: PlatformReferralPayoutDb,
  period: PlatformReferralPayoutPeriod,
) {
  const monthKey = validMonthKey(period.monthKey);
  const owners = await db.platformReferralCommission.findMany({
    where: { monthKey },
    select: { ownerUserId: true },
    distinct: ["ownerUserId"],
  });
  const synced = [];
  for (const owner of owners) {
    const amountCents = await platformReferralPayoutBalance(db, { ownerUserId: owner.ownerUserId, monthKey });
    const existing = await db.platformReferralPayout.findUnique({
      where: { ownerUserId_monthKey: { ownerUserId: owner.ownerUserId, monthKey } },
    });
    if (!existing && amountCents === 0) continue;

    const amounts = payoutAmounts(amountCents);
    if (existing) {
      if (existing.status !== "pending") {
        if (existing.finalAmountCents !== amounts.finalAmountCents) {
          throw new PlatformReferralPayoutMutationConflict("已鎖定的平台推薦 payout 金額不可被重算。");
        }
        synced.push(existing);
        continue;
      }
      const updated = await db.platformReferralPayout.updateMany({
        where: { id: existing.id, status: "pending", finalAmountCents: existing.finalAmountCents },
        data: amounts,
      });
      if (updated.count !== 1) throw new PlatformReferralPayoutMutationConflict("平台推薦 payout 已被其他交易變更。");
      synced.push(await db.platformReferralPayout.findUniqueOrThrow({ where: { id: existing.id } }));
      continue;
    }

    synced.push(await db.platformReferralPayout.create({
      data: {
        ownerUserId: owner.ownerUserId,
        monthKey,
        ...amounts,
        status: "pending",
      },
    }));
  }
  return synced;
}

/** Groups pending owner/month rows into an auditable local batch; no transfer is performed. */
export async function createPlatformReferralPayoutBatch(
  db: PlatformReferralPayoutDb,
  input: { monthKey: string; batchNumber: string; batchDate: Date },
) {
  const monthKey = validMonthKey(input.monthKey);
  const batchNumber = requiredText(input.batchNumber, "batchNumber");
  const existing = await db.platformReferralPayoutBatch.findUnique({ where: { batchNumber } });
  if (existing) {
    if (existing.monthKey !== monthKey) throw new PlatformReferralPayoutMutationConflict("批次月份不可改寫。");
    return existing;
  }

  const payouts = await db.platformReferralPayout.findMany({
    where: { monthKey, status: "pending", payoutBatchId: null, finalAmountCents: { gt: 0 } },
    orderBy: { createdAt: "asc" },
  });
  if (payouts.length === 0) return null;
  const totalAmountCents = payouts.reduce((sum, payout) => sum + payout.finalAmountCents, 0);
  const batch = await db.platformReferralPayoutBatch.create({
    data: {
      batchNumber,
      monthKey,
      batchDate: input.batchDate,
      totalAmountCents,
      totalCount: payouts.length,
      status: "draft",
    },
  });
  for (const payout of payouts) {
    const claimed = await db.platformReferralPayout.updateMany({
      where: { id: payout.id, status: "pending", payoutBatchId: null, finalAmountCents: payout.finalAmountCents },
      data: { payoutBatchId: batch.id, status: "batched" },
    });
    if (claimed.count !== 1) throw new PlatformReferralPayoutMutationConflict("平台推薦 payout 批次 claim 發生競態。");
  }
  return db.platformReferralPayoutBatch.findUniqueOrThrow({ where: { id: batch.id } });
}

/** Voids a local batched payout and appends a negative reversal for each commission balance. */
export async function voidPlatformReferralPayout(
  db: PlatformReferralPayoutDb,
  input: { payoutId: string; reason: string; occurredAt: Date },
) {
  const payoutId = requiredText(input.payoutId, "payoutId");
  const reason = requiredText(input.reason, "reason");
  if (reason.length > 500) throw new PlatformReferralPayoutMutationConflict("void 原因過長。");
  const payout = await db.platformReferralPayout.findUnique({ where: { id: payoutId } });
  if (!payout) throw new PlatformReferralPayoutMutationConflict("找不到平台推薦 payout。");
  if (payout.status === "void") return payout;
  if (payout.status === "paid" || !["pending", "batched"].includes(payout.status)) {
    throw new PlatformReferralPayoutMutationConflict("平台推薦 payout 狀態不可 void。");
  }

  const commissions = await db.platformReferralCommission.findMany({
    where: { ownerUserId: payout.ownerUserId, monthKey: payout.monthKey },
    select: { id: true },
  });
  let currentBalanceCents = 0;
  for (const commission of commissions) {
    const aggregate = await db.platformReferralCommissionLedgerEntry.aggregate({
      where: { platformReferralCommissionId: commission.id },
      _sum: { amountCents: true },
    });
    const balanceCents = aggregate._sum.amountCents ?? 0;
    if (balanceCents < 0) throw new PlatformReferralPayoutMutationConflict("平台推薦 ledger 淨額不可為負數。");
    currentBalanceCents += balanceCents;
    if (balanceCents > 0) {
      await appendPlatformReferralCommissionLedgerEntry(db, {
        commissionId: commission.id,
        entryType: "reversal",
        amountCents: -balanceCents,
        providerName: "finance-admin",
        eventIdentity: `platform-payout:void:${payout.id}:${commission.id}`,
        occurredAt: input.occurredAt,
      });
    }
  }
  if (currentBalanceCents !== payout.commissionAmountCents) {
    throw new PlatformReferralPayoutMutationConflict("平台推薦 payout 與 immutable ledger 金額不一致。");
  }
  const updated = await db.platformReferralPayout.updateMany({
    where: { id: payout.id, status: payout.status, finalAmountCents: payout.finalAmountCents },
    data: { status: "void", outcomeReason: reason, paidAt: null },
  });
  if (updated.count !== 1) throw new PlatformReferralPayoutMutationConflict("平台推薦 payout 狀態已被其他交易變更。");
  return db.platformReferralPayout.findUniqueOrThrow({ where: { id: payout.id } });
}
