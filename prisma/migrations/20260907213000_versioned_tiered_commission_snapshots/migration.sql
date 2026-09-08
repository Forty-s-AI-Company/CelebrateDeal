-- Preserve the exact rule decision on each commission row. Existing legacy
-- commissions remain nullable; new versioned rows are populated by the writer.
ALTER TABLE "AffiliateCommission"
  ADD COLUMN "policyVersion" INTEGER,
  ADD COLUMN "matchedTier" JSONB,
  ADD COLUMN "appliedRateBps" INTEGER,
  ADD COLUMN "calculationSnapshot" JSONB;

CREATE TABLE "CommissionProductOverride" (
  "id" TEXT NOT NULL,
  "vendorId" TEXT NOT NULL,
  "commissionRuleSetId" TEXT NOT NULL,
  "productId" TEXT NOT NULL,
  "rateBps" INTEGER NOT NULL,
  CONSTRAINT "CommissionProductOverride_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CommissionProductOverride_commissionRuleSetId_productId_key"
  ON "CommissionProductOverride"("commissionRuleSetId", "productId");
CREATE INDEX "CommissionProductOverride_vendorId_commissionRuleSetId_productId_idx"
  ON "CommissionProductOverride"("vendorId", "commissionRuleSetId", "productId");

ALTER TABLE "CommissionProductOverride" ADD CONSTRAINT "CommissionProductOverride_vendorId_fkey"
  FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CommissionProductOverride" ADD CONSTRAINT "CommissionProductOverride_vendorId_commissionRuleSetId_fkey"
  FOREIGN KEY ("vendorId", "commissionRuleSetId") REFERENCES "CommissionRuleSet"("vendorId", "id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CommissionProductOverride" ADD CONSTRAINT "CommissionProductOverride_vendorId_productId_fkey"
  FOREIGN KEY ("vendorId", "productId") REFERENCES "Product"("vendorId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CommissionProductOverride" ADD CONSTRAINT "CommissionProductOverride_rateBps_check"
  CHECK ("rateBps" BETWEEN 0 AND 10000);

CREATE FUNCTION reject_commission_product_override_update() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Commission product overrides are append-only.'
    USING ERRCODE = '23514', CONSTRAINT = 'CommissionProductOverride_immutable';
END;
$$;
CREATE TRIGGER "CommissionProductOverride_immutable_trigger"
BEFORE UPDATE ON "CommissionProductOverride"
FOR EACH ROW EXECUTE FUNCTION reject_commission_product_override_update();

-- Replace the snapshot trigger so the newly introduced audit fields are also
-- immutable after accrual. Operational status may still follow its lifecycle.
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
  THEN
    RAISE EXCEPTION 'AffiliateCommission rule snapshot is immutable.'
      USING ERRCODE = '23514', CONSTRAINT = 'AffiliateCommission_rule_snapshot_immutable';
  END IF;
  RETURN NEW;
END;
$$;
