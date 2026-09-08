CREATE TABLE "CommissionQuantityTier" (
  "id" TEXT NOT NULL,
  "vendorId" TEXT NOT NULL,
  "commissionRuleSetId" TEXT NOT NULL,
  "minQuantity" INTEGER NOT NULL,
  "maxQuantity" INTEGER,
  "rateBps" INTEGER NOT NULL,
  CONSTRAINT "CommissionQuantityTier_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "AffiliateCommission"
  ADD COLUMN "orderQuantity" INTEGER,
  ADD COLUMN "cumulativeSalesBeforeCount" INTEGER,
  ADD COLUMN "cumulativeSalesAfterCount" INTEGER;

CREATE UNIQUE INDEX "CommissionQuantityTier_commissionRuleSetId_minQuantity_key"
  ON "CommissionQuantityTier"("commissionRuleSetId", "minQuantity");
CREATE INDEX "CommissionQuantityTier_vendorId_commissionRuleSetId_minQuantity_idx"
  ON "CommissionQuantityTier"("vendorId", "commissionRuleSetId", "minQuantity");

ALTER TABLE "CommissionQuantityTier" ADD CONSTRAINT "CommissionQuantityTier_vendorId_fkey"
  FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CommissionQuantityTier" ADD CONSTRAINT "CommissionQuantityTier_vendorId_commissionRuleSetId_fkey"
  FOREIGN KEY ("vendorId", "commissionRuleSetId") REFERENCES "CommissionRuleSet"("vendorId", "id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CommissionQuantityTier" ADD CONSTRAINT "CommissionQuantityTier_values_check"
  CHECK ("minQuantity" >= 1 AND ("maxQuantity" IS NULL OR "maxQuantity" >= "minQuantity") AND "rateBps" BETWEEN 0 AND 10000);
ALTER TABLE "AffiliateCommission" ADD CONSTRAINT "AffiliateCommission_quantity_snapshot_check"
  CHECK (
    ("orderQuantity" IS NULL AND "cumulativeSalesBeforeCount" IS NULL AND "cumulativeSalesAfterCount" IS NULL)
    OR
    ("orderQuantity" >= 1 AND "cumulativeSalesBeforeCount" >= 0 AND "cumulativeSalesAfterCount" = "cumulativeSalesBeforeCount" + "orderQuantity")
  );

CREATE TRIGGER "CommissionQuantityTier_immutable_trigger"
BEFORE UPDATE ON "CommissionQuantityTier"
FOR EACH ROW EXECUTE FUNCTION reject_commission_rule_detail_update();

CREATE OR REPLACE FUNCTION enforce_affiliate_commission_rule_snapshot_immutable() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."vendorId" IS DISTINCT FROM OLD."vendorId"
    OR NEW."affiliateId" IS DISTINCT FROM OLD."affiliateId"
    OR NEW."monthKey" IS DISTINCT FROM OLD."monthKey"
    OR NEW."sourceType" IS DISTINCT FROM OLD."sourceType"
    OR NEW."sourceId" IS DISTINCT FROM OLD."sourceId"
    OR NEW."deduplicationKey" IS DISTINCT FROM OLD."deduplicationKey"
    OR NEW."referralCode" IS DISTINCT FROM OLD."referralCode"
    OR NEW."orderNumber" IS DISTINCT FROM OLD."orderNumber"
    OR NEW."orderAmountCents" IS DISTINCT FROM OLD."orderAmountCents"
    OR NEW."commissionBaseAmountCents" IS DISTINCT FROM OLD."commissionBaseAmountCents"
    OR NEW."commissionRateBps" IS DISTINCT FROM OLD."commissionRateBps"
    OR NEW."commissionAmountCents" IS DISTINCT FROM OLD."commissionAmountCents"
    OR NEW."currency" IS DISTINCT FROM OLD."currency"
    OR NEW."recipientRole" IS DISTINCT FROM OLD."recipientRole"
    OR NEW."uplineLevel" IS DISTINCT FROM OLD."uplineLevel"
    OR NEW."commissionRuleSetId" IS DISTINCT FROM OLD."commissionRuleSetId"
    OR NEW."commissionRuleVersion" IS DISTINCT FROM OLD."commissionRuleVersion"
    OR NEW."policyVersion" IS DISTINCT FROM OLD."policyVersion"
    OR NEW."matchedTier" IS DISTINCT FROM OLD."matchedTier"
    OR NEW."appliedRateBps" IS DISTINCT FROM OLD."appliedRateBps"
    OR NEW."calculationSnapshot" IS DISTINCT FROM OLD."calculationSnapshot"
    OR NEW."monthlySalesBeforeCents" IS DISTINCT FROM OLD."monthlySalesBeforeCents"
    OR NEW."monthlySalesAfterCents" IS DISTINCT FROM OLD."monthlySalesAfterCents"
    OR NEW."orderQuantity" IS DISTINCT FROM OLD."orderQuantity"
    OR NEW."cumulativeSalesBeforeCount" IS DISTINCT FROM OLD."cumulativeSalesBeforeCount"
    OR NEW."cumulativeSalesAfterCount" IS DISTINCT FROM OLD."cumulativeSalesAfterCount"
  THEN
    RAISE EXCEPTION 'AffiliateCommission rule snapshot is immutable.'
      USING ERRCODE = '23514', CONSTRAINT = 'AffiliateCommission_rule_snapshot_immutable';
  END IF;
  RETURN NEW;
END;
$$;
