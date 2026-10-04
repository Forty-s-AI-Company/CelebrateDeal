import type { Prisma } from "@prisma/client";

export class VoucherClaimConflictError extends Error {}

export type EligibleCheckoutVoucherClaim = {
  id: string;
  source: "automation" | "live";
  discountAmountCents: number;
} | null;

/** 在訂單交易內一次性核銷；交易回滾時優惠券也一併還原。 */
export async function consumeCheckoutVoucherClaim(
  tx: Prisma.TransactionClient,
  claim: EligibleCheckoutVoucherClaim,
  input: { vendorId: string; orderId: string; now: Date },
) {
  if (!claim) return;
  if (claim.source === "live") {
    const consumed = await tx.liveInteractionResponse.updateMany({
      where: { id: claim.id, vendorId: input.vendorId, eventType: "flash_voucher", usedOrderId: null, expiresAt: { gt: input.now } },
      data: { usedOrderId: input.orderId, discountAmountCents: claim.discountAmountCents },
    });
    if (consumed.count !== 1) throw new VoucherClaimConflictError();
    return;
  }
  const consumed = await tx.automationVoucherGrant.updateMany({
    where: {
      id: claim.id,
      vendorId: input.vendorId,
      usedOrderId: null,
      expiresAt: { gt: input.now },
    },
    data: { usedOrderId: input.orderId, redeemedAt: input.now },
  });
  if (consumed.count !== 1) throw new VoucherClaimConflictError();
}

