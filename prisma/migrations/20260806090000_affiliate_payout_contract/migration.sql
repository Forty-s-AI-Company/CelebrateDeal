-- FIN-03: make the merchant-owned AffiliatePayout identity explicit.
-- Existing rows are never rewritten automatically. Deploy must stop if the
-- existing database needs manual affiliate mapping, deduplication, or review.

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "AffiliatePayout"
    WHERE "affiliateId" IS NULL
  ) THEN
    RAISE EXCEPTION 'FIN03 migration blocked: AffiliatePayout contains NULL affiliateId values';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM "AffiliatePayout"
    GROUP BY "vendorId", "affiliateId", "monthKey"
    HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION 'FIN03 migration blocked: AffiliatePayout contains duplicate vendor/affiliate/month values';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM "AffiliatePayout"
    WHERE "finalAmountCents" < 0
  ) THEN
    RAISE EXCEPTION 'FIN03 migration blocked: AffiliatePayout contains negative finalAmountCents values';
  END IF;
END $$;

ALTER TABLE "AffiliatePayout"
ALTER COLUMN "affiliateId" SET NOT NULL;

ALTER TABLE "AffiliatePayout"
ADD CONSTRAINT "AffiliatePayout_finalAmountCents_nonnegative"
CHECK ("finalAmountCents" >= 0);

CREATE UNIQUE INDEX "AffiliatePayout_vendorId_affiliateId_monthKey_key"
ON "AffiliatePayout"("vendorId", "affiliateId", "monthKey");
