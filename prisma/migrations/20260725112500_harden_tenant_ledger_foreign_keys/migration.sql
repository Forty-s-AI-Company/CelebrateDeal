-- This migration adds database-level tenant invariants to financial records.
-- It is intentionally additive with respect to tables and data. Deployment
-- must still run the aggregate preflight documented in PRISMA_INVARIANTS.md.

CREATE UNIQUE INDEX "Settlement_vendorId_id_key"
ON "Settlement"("vendorId", "id");

ALTER TABLE "PayoutItem"
DROP CONSTRAINT "PayoutItem_settlementId_fkey";

ALTER TABLE "PayoutItem"
ADD CONSTRAINT "PayoutItem_vendorId_settlementId_fkey"
FOREIGN KEY ("vendorId", "settlementId")
REFERENCES "Settlement"("vendorId", "id")
ON DELETE RESTRICT
ON UPDATE CASCADE;

ALTER TABLE "RefundRecord"
DROP CONSTRAINT "RefundRecord_paymentTransactionId_fkey";

ALTER TABLE "RefundRecord"
ADD CONSTRAINT "RefundRecord_vendorId_paymentTransactionId_fkey"
FOREIGN KEY ("vendorId", "paymentTransactionId")
REFERENCES "PaymentTransaction"("vendorId", "id")
ON DELETE CASCADE
ON UPDATE CASCADE;

ALTER TABLE "AffiliateCommission"
DROP CONSTRAINT "AffiliateCommission_affiliateId_fkey";

ALTER TABLE "AffiliateCommission"
ADD CONSTRAINT "AffiliateCommission_vendorId_affiliateId_fkey"
FOREIGN KEY ("vendorId", "affiliateId")
REFERENCES "Affiliate"("vendorId", "id")
ON DELETE RESTRICT
ON UPDATE CASCADE;

ALTER TABLE "AffiliatePayout"
DROP CONSTRAINT "AffiliatePayout_affiliateId_fkey";

ALTER TABLE "AffiliatePayout"
ADD CONSTRAINT "AffiliatePayout_vendorId_affiliateId_fkey"
FOREIGN KEY ("vendorId", "affiliateId")
REFERENCES "Affiliate"("vendorId", "id")
ON DELETE RESTRICT
ON UPDATE CASCADE;
