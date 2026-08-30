ALTER TABLE "Affiliate"
ADD CONSTRAINT "Affiliate_commissionRateBps_bounds"
CHECK ("commissionRateBps" >= 0 AND "commissionRateBps" <= 10000);

ALTER TABLE "AffiliateCommission"
ADD CONSTRAINT "AffiliateCommission_commissionRateBps_bounds"
CHECK ("commissionRateBps" >= 0 AND "commissionRateBps" <= 10000);

CREATE UNIQUE INDEX "AffiliateCommission_vendorId_sourceType_sourceId_key"
ON "AffiliateCommission"("vendorId", "sourceType", "sourceId");
