ALTER TABLE "TrackingSetting"
ADD CONSTRAINT "TrackingSetting_attributionPolicy_check"
CHECK ("attributionPolicy" IN ('first_touch', 'last_touch'));

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM "AffiliateCommission" commission
    JOIN "Affiliate" affiliate ON affiliate."id" = commission."affiliateId"
    WHERE commission."affiliateId" IS NOT NULL AND affiliate."vendorId" <> commission."vendorId"
  ) THEN
    RAISE EXCEPTION 'Cross-tenant AffiliateCommission affiliate relation exists';
  END IF;
  IF EXISTS (
    SELECT 1 FROM "AffiliatePayout" payout
    JOIN "Affiliate" affiliate ON affiliate."id" = payout."affiliateId"
    WHERE payout."affiliateId" IS NOT NULL AND affiliate."vendorId" <> payout."vendorId"
  ) THEN
    RAISE EXCEPTION 'Cross-tenant AffiliatePayout affiliate relation exists';
  END IF;
END $$;

ALTER TABLE "AffiliateCommission" DROP CONSTRAINT IF EXISTS "AffiliateCommission_affiliateId_fkey";
ALTER TABLE "AffiliatePayout" DROP CONSTRAINT IF EXISTS "AffiliatePayout_affiliateId_fkey";

ALTER TABLE "AffiliateCommission"
ADD CONSTRAINT "AffiliateCommission_affiliateId_vendorId_fkey"
FOREIGN KEY ("affiliateId", "vendorId") REFERENCES "Affiliate"("id", "vendorId")
ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "AffiliatePayout"
ADD CONSTRAINT "AffiliatePayout_affiliateId_vendorId_fkey"
FOREIGN KEY ("affiliateId", "vendorId") REFERENCES "Affiliate"("id", "vendorId")
ON DELETE RESTRICT ON UPDATE CASCADE;
