ALTER TABLE "AffiliateCommission"
ADD COLUMN "affiliatePayoutId" TEXT,
ADD COLUMN "reversedAt" TIMESTAMP(3);

ALTER TABLE "AffiliatePayout"
ADD COLUMN "approvedAt" TIMESTAMP(3),
ADD COLUMN "reversedAt" TIMESTAMP(3);

UPDATE "AffiliateCommission"
SET "status" = 'reversed', "reversedAt" = COALESCE("settledAt", "updatedAt")
WHERE "status" = 'void';

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "AffiliatePayout"
    WHERE "affiliateId" IS NOT NULL
    GROUP BY "vendorId", "affiliateId", "monthKey"
    HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION 'Duplicate affiliate payouts exist for vendor/affiliate/month; reconcile before migration';
  END IF;
END $$;

CREATE UNIQUE INDEX "AffiliatePayout_id_vendorId_key" ON "AffiliatePayout"("id", "vendorId");
CREATE UNIQUE INDEX "AffiliatePayout_vendorId_affiliateId_monthKey_key" ON "AffiliatePayout"("vendorId", "affiliateId", "monthKey");
CREATE INDEX "AffiliateCommission_affiliatePayoutId_idx" ON "AffiliateCommission"("affiliatePayoutId");

ALTER TABLE "AffiliateCommission"
ADD CONSTRAINT "AffiliateCommission_affiliatePayoutId_vendorId_fkey"
FOREIGN KEY ("affiliatePayoutId", "vendorId")
REFERENCES "AffiliatePayout"("id", "vendorId")
ON DELETE RESTRICT ON UPDATE CASCADE;
