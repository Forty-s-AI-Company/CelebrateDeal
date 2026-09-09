import type { AffiliatePayout } from "@prisma/client";

/** 支付前再次核對申請、簽署與扣繳快照；不建立或修改任何付款資料。 */
export function hasValidAffiliatePayoutSnapshot(payout: AffiliatePayout) {
  const snapshotAmounts = [
    payout.grossAmountCents,
    payout.withholdingTaxCents,
    payout.nhiSupplementaryTaxCents,
    payout.bankFeeCents,
    payout.netPayoutAmountCents,
  ];
  if (
    !payout.requestedAt
    || !payout.signedAt
    || !payout.requestedBankAccountEncrypted
    || !payout.requestedTaxIdentityEncrypted
    || !payout.withholdingRuleVersion
    || snapshotAmounts.some((amount) => amount === null || amount < 0)
    || payout.grossAmountCents !== payout.finalAmountCents
    || payout.netPayoutAmountCents !== payout.grossAmountCents!
      - payout.withholdingTaxCents!
      - payout.nhiSupplementaryTaxCents!
      - payout.bankFeeCents!
    || payout.netPayoutAmountCents! <= 0
  ) {
    return false;
  }
  return true;
}
