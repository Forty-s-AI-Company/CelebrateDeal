import { Prisma } from "@prisma/client";
import { courseCommissionLedgerBalance } from "@/lib/course-commission-accounting";
import { calculateNetReferenceAmountCents } from "@/lib/payment-net-reference";

export type CoursePayoutDb = Pick<
  Prisma.TransactionClient,
  "courseCommissionAllocation" | "courseCommissionLedgerEntry" | "coursePayout"
>;

export type CoursePayoutPeriod = {
  vendorId: string;
  monthKey: string;
  start: Date;
  end: Date;
};

export class CoursePayoutMutationConflict extends Error {}

const payoutReferenceSelect = {
  id: true,
  grossAmountCents: true,
  paymentTransaction: {
    select: {
      id: true,
      netAmountCents: true,
      refundedAmountCents: true,
      refunds: {
        where: { status: "processed" },
        select: {
          gatewayFeeRefundCents: true,
          platformFeeRefundCents: true,
        },
      },
    },
  },
} as const;

type CoursePayoutAllocationReference = Prisma.CourseCommissionAllocationGetPayload<{
  select: typeof payoutReferenceSelect;
}>;

export type CoursePayoutReferenceSummary = {
  grossSalesAmountCents: number;
  netReferenceAmountCents: number;
  transactionCount: number;
};

/**
 * Gross commission base and provider-net are deliberately separate. A
 * transaction can have two allocation rows (F and G), so references are
 * deduplicated by payment transaction before being shown on a payout.
 */
export function summarizeCoursePayoutReferences(
  allocations: readonly CoursePayoutAllocationReference[],
): CoursePayoutReferenceSummary {
  const transactions = new Map<string, { grossAmountCents: number; netReferenceAmountCents: number }>();
  for (const allocation of allocations) {
    const transaction = allocation.paymentTransaction;
    if (transactions.has(transaction.id)) continue;
    const feeRefunds = transaction.refunds.reduce(
      (totals, refund) => ({
        gatewayFeeRefundCents: totals.gatewayFeeRefundCents + refund.gatewayFeeRefundCents,
        platformFeeRefundCents: totals.platformFeeRefundCents + refund.platformFeeRefundCents,
      }),
      { gatewayFeeRefundCents: 0, platformFeeRefundCents: 0 },
    );
    transactions.set(transaction.id, {
      grossAmountCents: allocation.grossAmountCents,
      netReferenceAmountCents: calculateNetReferenceAmountCents({
        netAmountCents: transaction.netAmountCents,
        refundedAmountCents: transaction.refundedAmountCents,
        ...feeRefunds,
      }),
    });
  }

  return [...transactions.values()].reduce(
    (summary, transaction) => ({
      grossSalesAmountCents: summary.grossSalesAmountCents + transaction.grossAmountCents,
      netReferenceAmountCents: summary.netReferenceAmountCents + transaction.netReferenceAmountCents,
      transactionCount: summary.transactionCount + 1,
    }),
    { grossSalesAmountCents: 0, netReferenceAmountCents: 0, transactionCount: 0 },
  );
}

function payoutAmounts(amountCents: number, reference: CoursePayoutReferenceSummary) {
  if (!Number.isSafeInteger(amountCents) || amountCents < 0) {
    throw new CoursePayoutMutationConflict("課程 payout 淨額不可為負數或非整數。");
  }
  return {
    commissionAmountCents: amountCents,
    adjustmentAmountCents: 0,
    finalAmountCents: amountCents,
    grossSalesAmountCents: reference.grossSalesAmountCents,
    netReferenceAmountCents: reference.netReferenceAmountCents,
  };
}

async function recipientAllocations(
  db: CoursePayoutDb,
  period: CoursePayoutPeriod,
  recipientMembershipId: string,
) {
  return db.courseCommissionAllocation.findMany({
    where: {
      vendorId: period.vendorId,
      recipientMembershipId,
      paymentTransaction: { occurredAt: { gte: period.start, lt: period.end } },
    },
    select: payoutReferenceSelect,
  });
}

export async function coursePayoutBalance(
  db: CoursePayoutDb,
  period: CoursePayoutPeriod,
  recipientMembershipId: string,
) {
  const allocations = await recipientAllocations(db, period, recipientMembershipId);
  const reference = summarizeCoursePayoutReferences(allocations);
  let balanceCents = 0;
  for (const allocation of allocations) {
    balanceCents += await courseCommissionLedgerBalance(db, period.vendorId, allocation.id);
  }
  return { amountCents: payoutAmounts(balanceCents, reference).finalAmountCents, reference };
}

export async function syncCoursePayoutsForSettlement(
  db: CoursePayoutDb,
  period: CoursePayoutPeriod,
) {
  const allocations = await db.courseCommissionAllocation.findMany({
    where: {
      vendorId: period.vendorId,
      paymentTransaction: { occurredAt: { gte: period.start, lt: period.end } },
    },
    select: { recipientMembershipId: true },
    distinct: ["recipientMembershipId"],
  });

  const synced = [];
  for (const allocation of allocations) {
    const payoutBalance = await coursePayoutBalance(db, period, allocation.recipientMembershipId);
    const amountCents = payoutBalance.amountCents;
    if (amountCents === 0) continue;

    const amounts = payoutAmounts(amountCents, payoutBalance.reference);
    const existing = await db.coursePayout.findUnique({
      where: {
        vendorId_recipientMembershipId_monthKey: {
          vendorId: period.vendorId,
          recipientMembershipId: allocation.recipientMembershipId,
          monthKey: period.monthKey,
        },
      },
    });
    if (existing) {
      if (existing.status !== "pending") {
        if (existing.finalAmountCents !== amounts.finalAmountCents
          || (existing.grossSalesAmountCents != null && existing.grossSalesAmountCents !== amounts.grossSalesAmountCents)
          || (existing.netReferenceAmountCents != null && existing.netReferenceAmountCents !== amounts.netReferenceAmountCents)) {
          throw new CoursePayoutMutationConflict("已完成的課程 payout 金額不可被重算。");
        }
        synced.push(existing);
        continue;
      }
      const updated = await db.coursePayout.updateMany({
        where: { id: existing.id, vendorId: period.vendorId, status: "pending" },
        data: amounts,
      });
      if (updated.count !== 1) throw new CoursePayoutMutationConflict("課程 payout 已被其他交易變更。");
      synced.push(await db.coursePayout.findUniqueOrThrow({ where: { id: existing.id } }));
      continue;
    }

    synced.push(await db.coursePayout.create({
      data: {
        vendorId: period.vendorId,
        recipientMembershipId: allocation.recipientMembershipId,
        monthKey: period.monthKey,
        ...amounts,
        status: "pending",
      },
    }));
  }
  return synced;
}

/** Refresh an already-created pending payout after a refund/dispute ledger write. */
export async function reconcileCoursePayoutForAllocation(
  db: CoursePayoutDb,
  input: { vendorId: string; allocationId: string; monthKey: string; start: Date; end: Date },
) {
  const allocation = await db.courseCommissionAllocation.findUnique({
    where: { vendorId_id: { vendorId: input.vendorId, id: input.allocationId } },
    select: { recipientMembershipId: true },
  });
  if (!allocation) throw new CoursePayoutMutationConflict("找不到課程分潤 allocation。");

  const existing = await db.coursePayout.findUnique({
    where: {
      vendorId_recipientMembershipId_monthKey: {
        vendorId: input.vendorId,
        recipientMembershipId: allocation.recipientMembershipId,
        monthKey: input.monthKey,
      },
    },
  });
  if (!existing || existing.status !== "pending") return existing;

  const payoutBalance = await coursePayoutBalance(db, {
    vendorId: input.vendorId,
    monthKey: input.monthKey,
    start: input.start,
    end: input.end,
  }, allocation.recipientMembershipId);
  const amounts = payoutAmounts(payoutBalance.amountCents, payoutBalance.reference);
  const updated = await db.coursePayout.updateMany({
    where: { id: existing.id, vendorId: input.vendorId, status: "pending" },
    data: amounts,
  });
  if (updated.count !== 1) throw new CoursePayoutMutationConflict("退款後課程 payout 已被其他交易變更。");
  return db.coursePayout.findUniqueOrThrow({ where: { id: existing.id } });
}
