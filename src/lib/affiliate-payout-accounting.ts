import type { Prisma } from "@prisma/client";
import { commissionLedgerPayableState } from "./affiliate-commission-accounting";

type PayoutClient = Pick<Prisma.TransactionClient, "affiliateCommission" | "affiliateCommissionLedgerEntry" | "affiliatePayout">;

/** Existing paid/exported payouts stay immutable. Pending merchant payouts
 * retain the original adjustment and expose dispute holds separately. */
export async function reconcileAffiliatePendingPayout(db: PayoutClient, input: { vendorId: string; affiliateId: string; monthKey: string }) {
  const payout = await db.affiliatePayout.findUnique({ where: { vendorId_affiliateId_monthKey: input } });
  if (!payout || payout.status !== "pending" || payout.payoutItemId !== null) return;
  const commissions = await db.affiliateCommission.findMany({ where: { ...input, status: "locked" }, select: { id: true } });
  let commissionAmountCents = 0, heldAmountCents = 0;
  for (const commission of commissions) {
    const state = await commissionLedgerPayableState(db, input.vendorId, commission.id);
    commissionAmountCents += state.balanceCents; heldAmountCents += state.heldCents;
  }
  const finalAmountCents = commissionAmountCents + payout.adjustmentAmountCents;
  if (!Number.isSafeInteger(finalAmountCents) || finalAmountCents < 0) throw new Error("聯盟出款需先修正不合法的調整金額。");
  const changed = await db.affiliatePayout.updateMany({ where: { id: payout.id, vendorId: input.vendorId, status: "pending", payoutItemId: null }, data: { commissionAmountCents, heldAmountCents, finalAmountCents } });
  if (changed.count !== 1) throw new Error("聯盟出款狀態已被其他交易變更。");
}

export class AffiliatePayoutMutationConflict extends Error {}

// Refund history may leave zero void rows beside the month's payable rows.
export function payoutCommissionAmount(status: string, outcome: string, payable: Awaited<ReturnType<typeof commissionLedgerPayableState>>) {
  if (status === "void") {
    if (payable.balanceCents !== 0 || payable.hasOpenDispute) throw new AffiliatePayoutMutationConflict();
    return null;
  }
  if (outcome === "paid" && payable.hasOpenDispute) throw new AffiliatePayoutMutationConflict();
  if (payable.balanceCents < 0) throw new AffiliatePayoutMutationConflict();
  return payable.balanceCents;
}


// Keep database conflict classification beside the affiliate payout domain.
export function isAffiliatePayoutMutationConflict(error: unknown) {
  return typeof error === "object" && error !== null && "code" in error &&
    (error.code === "P2002" || error.code === "P2025" || error.code === "P2034");
}
