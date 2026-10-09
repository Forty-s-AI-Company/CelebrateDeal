ALTER TABLE "AffiliatePayout" ADD COLUMN "remunerationSnapshotId" TEXT;
ALTER TABLE "AffiliatePayout" ADD COLUMN "paidNetAmountCents" INTEGER;
CREATE UNIQUE INDEX "AffiliateRemunerationSnapshot_vendorId_affiliateId_payoutId_id_key" ON "AffiliateRemunerationSnapshot"("vendorId", "affiliateId", "payoutId", "id");
ALTER TABLE "AffiliatePayout" ADD CONSTRAINT "AffiliatePayout_paid_remuneration_fkey" FOREIGN KEY ("vendorId", "affiliateId", "id", "remunerationSnapshotId") REFERENCES "AffiliateRemunerationSnapshot"("vendorId", "affiliateId", "payoutId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "AffiliatePayout" ADD CONSTRAINT "AffiliatePayout_paid_net_check" CHECK (
  ("remunerationSnapshotId" IS NULL AND "paidNetAmountCents" IS NULL) OR
  ("remunerationSnapshotId" IS NOT NULL AND "paidNetAmountCents" IS NOT NULL AND "paidNetAmountCents" > 0 AND "paidNetAmountCents" <= "finalAmountCents" AND "status" = 'paid' AND "paidAt" IS NOT NULL)
);
