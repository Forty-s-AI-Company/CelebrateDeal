import type { PrismaClient } from "@prisma/client";
import { auditSnapshot } from "@/lib/audit";

export type AffiliatePayoutRequestInput = {
  payoutId: string;
  vendorId: string;
  affiliateId: string;
  userId: string;
  bankAccountEncrypted: string;
  requestedAt: Date;
  ipAddress: string | null;
  userAgent: string | null;
};

export async function requestAffiliatePayout(
  db: Pick<PrismaClient, "$transaction">,
  input: AffiliatePayoutRequestInput,
) {
  return db.$transaction(async (tx) => {
    const payout = await tx.affiliatePayout.findFirst({
      where: { id: input.payoutId, vendorId: input.vendorId, affiliateId: input.affiliateId },
    });
    if (!payout || payout.status !== "pending" || payout.finalAmountCents <= 0) return "ineligible" as const;
    if (payout.requestedAt) return "requested" as const;

    const claimed = await tx.affiliatePayout.updateMany({
      where: {
        id: payout.id,
        vendorId: input.vendorId,
        affiliateId: input.affiliateId,
        status: "pending",
        requestedAt: null,
      },
      data: {
        requestedAt: input.requestedAt,
        requestedBankAccountEncrypted: input.bankAccountEncrypted,
      },
    });
    if (claimed.count !== 1) return "ineligible" as const;

    await tx.auditLog.create({
      data: {
        vendorId: input.vendorId,
        actorId: input.userId,
        actorLabel: "affiliate",
        action: "request_affiliate_payout",
        targetType: "AffiliatePayout",
        targetId: payout.id,
        before: auditSnapshot(payout),
        after: auditSnapshot({ requestedAt: input.requestedAt, affiliateId: input.affiliateId }),
        ipAddress: input.ipAddress,
        userAgent: input.userAgent,
      },
    });
    return "requested" as const;
  });
}

