-- Versioned merchant commission policies.
CREATE TYPE "CommissionRuleStatus" AS ENUM ('ACTIVE', 'ARCHIVED');

CREATE TABLE "CommissionRuleSet" (
  "id" TEXT NOT NULL,
  "vendorId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "version" INTEGER NOT NULL,
  "status" "CommissionRuleStatus" NOT NULL DEFAULT 'ACTIVE',
  "maxTotalRateBps" INTEGER NOT NULL,
  "currency" TEXT NOT NULL DEFAULT 'TWD',
  "activatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "archivedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CommissionRuleSet_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "CommissionRateTier" (
  "id" TEXT NOT NULL,
  "vendorId" TEXT NOT NULL,
  "commissionRuleSetId" TEXT NOT NULL,
  "minMonthlySalesCents" INTEGER NOT NULL,
  "rateBps" INTEGER NOT NULL,
  CONSTRAINT "CommissionRateTier_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "CommissionUplineLevel" (
  "id" TEXT NOT NULL,
  "vendorId" TEXT NOT NULL,
  "commissionRuleSetId" TEXT NOT NULL,
  "level" INTEGER NOT NULL,
  "bonusRateBps" INTEGER NOT NULL,
  CONSTRAINT "CommissionUplineLevel_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "AffiliateCommission"
  ADD COLUMN "recipientRole" TEXT NOT NULL DEFAULT 'promoter',
  ADD COLUMN "currency" TEXT NOT NULL DEFAULT 'TWD',
  ADD COLUMN "uplineLevel" INTEGER,
  ADD COLUMN "commissionRuleSetId" TEXT,
  ADD COLUMN "commissionRuleVersion" INTEGER,
  ADD COLUMN "monthlySalesBeforeCents" INTEGER,
  ADD COLUMN "monthlySalesAfterCents" INTEGER;

CREATE UNIQUE INDEX "CommissionRuleSet_vendorId_id_key" ON "CommissionRuleSet"("vendorId", "id");
CREATE UNIQUE INDEX "CommissionRuleSet_vendorId_version_key" ON "CommissionRuleSet"("vendorId", "version");
CREATE UNIQUE INDEX "CommissionRuleSet_one_active_currency_key" ON "CommissionRuleSet"("vendorId", "currency") WHERE "status" = 'ACTIVE';
CREATE INDEX "CommissionRuleSet_vendorId_status_activatedAt_idx" ON "CommissionRuleSet"("vendorId", "status", "activatedAt");
CREATE UNIQUE INDEX "CommissionRateTier_commissionRuleSetId_minMonthlySalesCents_key" ON "CommissionRateTier"("commissionRuleSetId", "minMonthlySalesCents");
CREATE INDEX "CommissionRateTier_vendorId_commissionRuleSetId_minMonthlySalesCents_idx" ON "CommissionRateTier"("vendorId", "commissionRuleSetId", "minMonthlySalesCents");
CREATE UNIQUE INDEX "CommissionUplineLevel_commissionRuleSetId_level_key" ON "CommissionUplineLevel"("commissionRuleSetId", "level");
CREATE INDEX "CommissionUplineLevel_vendorId_commissionRuleSetId_level_idx" ON "CommissionUplineLevel"("vendorId", "commissionRuleSetId", "level");
CREATE INDEX "AffiliateCommission_vendorId_sourceId_recipientRole_idx" ON "AffiliateCommission"("vendorId", "sourceId", "recipientRole");
CREATE INDEX "AffiliateCommission_vendorId_commissionRuleSetId_idx" ON "AffiliateCommission"("vendorId", "commissionRuleSetId");

ALTER TABLE "CommissionRuleSet" ADD CONSTRAINT "CommissionRuleSet_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CommissionRateTier" ADD CONSTRAINT "CommissionRateTier_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CommissionRateTier" ADD CONSTRAINT "CommissionRateTier_vendorId_commissionRuleSetId_fkey" FOREIGN KEY ("vendorId", "commissionRuleSetId") REFERENCES "CommissionRuleSet"("vendorId", "id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CommissionUplineLevel" ADD CONSTRAINT "CommissionUplineLevel_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CommissionUplineLevel" ADD CONSTRAINT "CommissionUplineLevel_vendorId_commissionRuleSetId_fkey" FOREIGN KEY ("vendorId", "commissionRuleSetId") REFERENCES "CommissionRuleSet"("vendorId", "id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AffiliateCommission" ADD CONSTRAINT "AffiliateCommission_vendorId_commissionRuleSetId_fkey" FOREIGN KEY ("vendorId", "commissionRuleSetId") REFERENCES "CommissionRuleSet"("vendorId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "CommissionRuleSet" ADD CONSTRAINT "CommissionRuleSet_maxTotalRateBps_check" CHECK ("maxTotalRateBps" BETWEEN 1 AND 10000);
ALTER TABLE "CommissionRuleSet" ADD CONSTRAINT "CommissionRuleSet_currency_check" CHECK ("currency" ~ '^[A-Z]{3}$');
ALTER TABLE "CommissionRateTier" ADD CONSTRAINT "CommissionRateTier_values_check" CHECK ("minMonthlySalesCents" >= 0 AND "rateBps" BETWEEN 0 AND 10000);
ALTER TABLE "CommissionUplineLevel" ADD CONSTRAINT "CommissionUplineLevel_values_check" CHECK ("level" BETWEEN 1 AND 8 AND "bonusRateBps" BETWEEN 1 AND 10000);
ALTER TABLE "AffiliateCommission" ADD CONSTRAINT "AffiliateCommission_rule_snapshot_check" CHECK (
  ("commissionRuleSetId" IS NULL AND "commissionRuleVersion" IS NULL AND "monthlySalesBeforeCents" IS NULL AND "monthlySalesAfterCents" IS NULL)
  OR
  ("commissionRuleSetId" IS NOT NULL AND "commissionRuleVersion" IS NOT NULL AND "monthlySalesBeforeCents" IS NOT NULL AND "monthlySalesAfterCents" IS NOT NULL)
);

CREATE FUNCTION enforce_affiliate_commission_rule_snapshot_immutable() RETURNS trigger
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
    OR NEW."monthlySalesBeforeCents" IS DISTINCT FROM OLD."monthlySalesBeforeCents"
    OR NEW."monthlySalesAfterCents" IS DISTINCT FROM OLD."monthlySalesAfterCents"
  THEN
    RAISE EXCEPTION 'AffiliateCommission rule snapshot is immutable.'
      USING ERRCODE = '23514', CONSTRAINT = 'AffiliateCommission_rule_snapshot_immutable';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "AffiliateCommission_rule_snapshot_immutable_trigger"
BEFORE UPDATE ON "AffiliateCommission"
FOR EACH ROW EXECUTE FUNCTION enforce_affiliate_commission_rule_snapshot_immutable();

CREATE FUNCTION enforce_commission_rule_identity_immutable() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."vendorId" IS DISTINCT FROM OLD."vendorId"
    OR NEW."name" IS DISTINCT FROM OLD."name"
    OR NEW."version" IS DISTINCT FROM OLD."version"
    OR NEW."maxTotalRateBps" IS DISTINCT FROM OLD."maxTotalRateBps"
    OR NEW."currency" IS DISTINCT FROM OLD."currency"
    OR NEW."activatedAt" IS DISTINCT FROM OLD."activatedAt"
    OR NEW."createdAt" IS DISTINCT FROM OLD."createdAt"
  THEN
    RAISE EXCEPTION 'CommissionRuleSet policy identity is immutable.'
      USING ERRCODE = '23514', CONSTRAINT = 'CommissionRuleSet_identity_immutable';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "CommissionRuleSet_identity_immutable_trigger"
BEFORE UPDATE ON "CommissionRuleSet"
FOR EACH ROW EXECUTE FUNCTION enforce_commission_rule_identity_immutable();

CREATE FUNCTION reject_commission_rule_detail_update() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Commission rule version details are append-only.'
    USING ERRCODE = '23514', CONSTRAINT = 'CommissionRuleDetail_immutable';
END;
$$;

CREATE TRIGGER "CommissionRateTier_immutable_trigger"
BEFORE UPDATE ON "CommissionRateTier"
FOR EACH ROW EXECUTE FUNCTION reject_commission_rule_detail_update();

CREATE TRIGGER "CommissionUplineLevel_immutable_trigger"
BEFORE UPDATE ON "CommissionUplineLevel"
FOR EACH ROW EXECUTE FUNCTION reject_commission_rule_detail_update();
