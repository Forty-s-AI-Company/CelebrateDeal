ALTER TABLE "AffiliateCommission" DROP CONSTRAINT "AffiliateCommission_rule_snapshot_check";
ALTER TABLE "AffiliateCommission" ADD CONSTRAINT "AffiliateCommission_rule_snapshot_check" CHECK (
  (
    "commissionRuleSetId" IS NULL
    AND "commissionRuleVersion" IS NULL
    AND "policyVersion" IS NULL
    AND "monthlySalesBeforeCents" IS NULL
    AND "monthlySalesAfterCents" IS NULL
    AND "orderQuantity" IS NULL
    AND "cumulativeSalesBeforeCount" IS NULL
    AND "cumulativeSalesAfterCount" IS NULL
  )
  OR
  (
    "commissionRuleSetId" IS NOT NULL
    AND "commissionRuleVersion" IS NOT NULL
    AND "policyVersion" IS NOT NULL
    AND "appliedRateBps" IS NOT NULL
    AND "matchedTier" IS NOT NULL
    AND "calculationSnapshot" IS NOT NULL
    AND (
      (
        "monthlySalesBeforeCents" IS NOT NULL
        AND "monthlySalesAfterCents" IS NOT NULL
        AND "orderQuantity" IS NULL
        AND "cumulativeSalesBeforeCount" IS NULL
        AND "cumulativeSalesAfterCount" IS NULL
      )
      OR
      (
        "monthlySalesBeforeCents" IS NULL
        AND "monthlySalesAfterCents" IS NULL
        AND "orderQuantity" IS NOT NULL
        AND "cumulativeSalesBeforeCount" IS NOT NULL
        AND "cumulativeSalesAfterCount" IS NOT NULL
      )
    )
  )
);
