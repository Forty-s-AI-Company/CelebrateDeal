import { Prisma } from "@prisma/client";
import {
  commissionAmountCents,
} from "@/lib/affiliate-commission";
import {
  appendCommissionLedgerEntry,
  commissionLedgerBalance,
} from "@/lib/affiliate-commission-accounting";
import {
  appendCourseCommissionLedgerEntry,
  courseCommissionLedgerBalance,
} from "@/lib/course-commission-accounting";
import { reconcileCoursePayoutForAllocation } from "@/lib/course-payout-accounting";
import { calculateCourseRefundDistribution } from "@/lib/course-commission";
import {
  reconcileCommerceOrderRefundForPayment,
  type CommerceOrdersTransaction,
} from "@/lib/commerce-orders";

export { calculateNetReferenceAmountCents } from "@/lib/payment-net-reference";

/**
 * The refund action and provider webhook must use the same accounting path.
 * Keeping this inside the surrounding DB transaction makes a refund and its
 * payable reversal commit or roll back together.
 */
export type PaymentRefundAccountingDb = Pick<
  Prisma.TransactionClient,
  | "affiliateCommission"
  | "affiliateCommissionLedgerEntry"
  | "affiliatePayout"
  | "courseCommissionAllocation"
  | "courseCommissionLedgerEntry"
  | "coursePayout"
> & CommerceOrdersTransaction;

export type PaymentRefundAccountingInput = {
  vendorId: string;
  transactionId: string;
  orderNumber: string | null | undefined;
  providerName: string;
  eventIdentity: string;
  refundRecordId?: string | null;
  refundAmountCents: number;
  /** Display-only provider-net reference after the completed refund. */
  netReferenceAmountCents: number;
  isFullRefund: boolean;
  transactionOccurredAt: Date;
  occurredAt: Date;
};

function monthBounds(date: Date) {
  const year = date.getUTCFullYear();
  const month = date.getUTCMonth();
  return {
    monthKey: `${year.toString().padStart(4, "0")}-${(month + 1).toString().padStart(2, "0")}`,
    start: new Date(Date.UTC(year, month, 1)),
    end: new Date(Date.UTC(year, month + 1, 1)),
  };
}

async function applyRefundToAffiliateCommission(
  db: PaymentRefundAccountingDb,
  input: PaymentRefundAccountingInput,
) {
  const commission = await db.affiliateCommission.findFirst({
    where: {
      vendorId: input.vendorId,
      // A vendor may reuse an order number across payment providers. The
      // server-owned transaction identity is the only safe commission scope.
      sourceType: "webhook",
      sourceId: input.transactionId,
    },
  });

  if (!commission) return null;
  const netReferenceUpdated = await db.affiliateCommission.updateMany({
    where: { id: commission.id, vendorId: input.vendorId },
    data: { netReferenceAmountCents: input.netReferenceAmountCents },
  });
  if (netReferenceUpdated.count !== 1) throw new Error("聯盟佣金淨額參考已被其他交易變更。");
  const currentBalance = await commissionLedgerBalance(db, input.vendorId, commission.id);
  const calculatedRefund = commissionAmountCents(input.refundAmountCents, commission.commissionRateBps);
  const refundAmount = input.isFullRefund
    ? currentBalance
    : Math.min(currentBalance, calculatedRefund);

  if (refundAmount > 0) {
    await appendCommissionLedgerEntry(db, {
      vendorId: input.vendorId,
      affiliateCommissionId: commission.id,
      entryType: "refund",
      providerName: input.providerName,
      eventIdentity: input.eventIdentity,
      amountCents: -refundAmount,
      occurredAt: input.occurredAt,
    });
  }

  const nextBalance = await commissionLedgerBalance(db, input.vendorId, commission.id);
  const previousStatus = commission.status;
  const nextStatus = commission.status !== "paid" && nextBalance === 0 ? "void" : commission.status;
  if (nextStatus !== commission.status) {
    const voided = await db.affiliateCommission.updateMany({
      where: { id: commission.id, vendorId: input.vendorId, status: commission.status },
      // Keep the original accrual immutable; the refund is represented by a
      // separate negative ledger entry and an operational void transition.
      data: { status: "void", settledAt: input.occurredAt },
    });
    if (voided.count !== 1) throw new Error("退款佣金狀態已被其他交易變更。");
  }

  // A locked commission may already have produced an unpaid merchant-owned
  // payout. Recalculate it from all locked ledger balances before export.
  if (previousStatus === "locked" && commission.affiliateId) {
    const lockedCommissions = await db.affiliateCommission.findMany({
      where: {
        vendorId: input.vendorId,
        affiliateId: commission.affiliateId,
        monthKey: commission.monthKey,
        status: "locked",
      },
      select: { id: true },
    });
    let lockedBalanceCents = 0;
    for (const lockedCommission of lockedCommissions) {
      lockedBalanceCents += await commissionLedgerBalance(db, input.vendorId, lockedCommission.id);
    }

    const payout = await db.affiliatePayout.findUnique({
      where: {
        vendorId_affiliateId_monthKey: {
          vendorId: input.vendorId,
          affiliateId: commission.affiliateId,
          monthKey: commission.monthKey,
        },
      },
    });
    if (payout?.status === "pending" && payout.payoutItemId === null) {
      const finalAmountCents = lockedBalanceCents + payout.adjustmentAmountCents;
      if (finalAmountCents < 0) throw new Error("退款後聯盟出款金額不可小於零。");
      const updatedPayout = await db.affiliatePayout.updateMany({
        where: { id: payout.id, status: "pending", payoutItemId: null },
        data: {
          commissionAmountCents: lockedBalanceCents,
          finalAmountCents,
        },
      });
      if (updatedPayout.count !== 1) throw new Error("聯盟出款狀態已被其他交易變更。");
    }
  }

  return db.affiliateCommission.findUnique({ where: { id: commission.id } });
}

async function applyRefundToCourseAllocations(
  db: PaymentRefundAccountingDb,
  input: PaymentRefundAccountingInput,
) {
  const allocations = await db.courseCommissionAllocation.findMany({
    where: { vendorId: input.vendorId, paymentTransactionId: input.transactionId },
    orderBy: { recipientRole: "asc" },
  });
  if (allocations.length === 0) return [];

  const withBalances = [];
  for (const allocation of allocations) {
    withBalances.push({
      allocation,
      currentBalanceCents: await courseCommissionLedgerBalance(
        db,
        input.vendorId,
        allocation.id,
      ),
    });
  }

  const distribution = calculateCourseRefundDistribution(
    input.isFullRefund
      ? withBalances.reduce((sum, item) => sum + item.currentBalanceCents, 0)
      : input.refundAmountCents,
    withBalances.map((item) => ({
      recipientRole: item.allocation.recipientRole === "content_owner" || item.allocation.recipientRole === "promoter"
        ? item.allocation.recipientRole
        : (() => { throw new Error("課程分潤 recipient role 不合法。 "); })(),
      shareBps: item.allocation.shareBps,
      currentBalanceCents: item.currentBalanceCents,
    })),
  );

  const adjusted = [];
  for (const [index, item] of distribution.entries()) {
    if (item.amountCents === 0) continue;
    const allocationId = withBalances[index]!.allocation.id;
    adjusted.push(await appendCourseCommissionLedgerEntry(db, {
      vendorId: input.vendorId,
      courseCommissionAllocationId: allocationId,
      entryType: "refund",
      providerName: input.providerName,
      eventIdentity: input.eventIdentity,
      amountCents: -item.amountCents,
      occurredAt: input.occurredAt,
    }));
    const period = monthBounds(input.transactionOccurredAt);
    await reconcileCoursePayoutForAllocation(db, {
      vendorId: input.vendorId,
      allocationId,
      ...period,
    });
  }
  return adjusted;
}

export async function applyPaymentRefundAccounting(
  db: PaymentRefundAccountingDb,
  input: PaymentRefundAccountingInput,
) {
  if (input.refundAmountCents <= 0) {
    return { affiliateCommission: null, courseRefundAllocations: [], commerceOrderRefund: null };
  }

  const affiliateCommission = await applyRefundToAffiliateCommission(db, input);
  const courseRefundAllocations = await applyRefundToCourseAllocations(db, input);
  const commerceOrderRefund = await reconcileCommerceOrderRefundForPayment(db, {
    vendorId: input.vendorId,
    paymentTransactionId: input.transactionId,
    providerName: input.providerName,
    eventIdentity: input.eventIdentity,
    refundRecordId: input.refundRecordId ?? null,
    amountCents: input.refundAmountCents,
    occurredAt: input.occurredAt,
  });
  return { affiliateCommission, courseRefundAllocations, commerceOrderRefund };
}
