import type { PrismaClient } from "@prisma/client";
import { auditSnapshot } from "@/lib/audit";
import { calculateTaiwanTaxWithholding, DEFAULT_BANK_FEE_CENTS } from "@/lib/taiwan-tax-withholding";

export type AffiliatePayoutRequestInput = {
  payoutId: string;
  vendorId: string;
  affiliateId: string;
  userId: string;
  bankAccountEncrypted: string;
  taxIdentityEncrypted: string;
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
    // 不建立負數或零實領款；直接提交小額款項也必須回傳不可申請。
    if (payout.finalAmountCents <= DEFAULT_BANK_FEE_CENTS) return "ineligible" as const;
    const snapshot = calculateTaiwanTaxWithholding({ grossAmountCents: payout.finalAmountCents });

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
        signedAt: input.requestedAt,
        requestedBankAccountEncrypted: input.bankAccountEncrypted,
        requestedTaxIdentityEncrypted: input.taxIdentityEncrypted,
        grossAmountCents: snapshot.grossAmountCents,
        withholdingTaxCents: snapshot.withholdingTaxCents,
        nhiSupplementaryTaxCents: snapshot.nhiSupplementaryTaxCents,
        bankFeeCents: snapshot.bankFeeCents,
        netPayoutAmountCents: snapshot.netPayoutAmountCents,
        withholdingRuleVersion: snapshot.ruleVersion,
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
        after: auditSnapshot({ requestedAt: input.requestedAt, signedAt: input.requestedAt, affiliateId: input.affiliateId, ...snapshot }),
        ipAddress: input.ipAddress,
        userAgent: input.userAgent,
      },
    });
    return "requested" as const;
  });
}
