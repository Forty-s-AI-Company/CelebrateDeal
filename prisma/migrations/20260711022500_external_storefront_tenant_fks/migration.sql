CREATE UNIQUE INDEX "Product_id_vendorId_key" ON "Product"("id", "vendorId");
CREATE UNIQUE INDEX "Affiliate_id_vendorId_key" ON "Affiliate"("id", "vendorId");

ALTER TABLE "AffiliateProductLink"
DROP CONSTRAINT "AffiliateProductLink_affiliateId_fkey",
DROP CONSTRAINT "AffiliateProductLink_productId_fkey",
ADD CONSTRAINT "AffiliateProductLink_affiliateId_vendorId_fkey"
  FOREIGN KEY ("affiliateId", "vendorId") REFERENCES "Affiliate"("id", "vendorId") ON DELETE CASCADE ON UPDATE CASCADE,
ADD CONSTRAINT "AffiliateProductLink_productId_vendorId_fkey"
  FOREIGN KEY ("productId", "vendorId") REFERENCES "Product"("id", "vendorId") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ExternalOrderEvidence"
DROP CONSTRAINT "ExternalOrderEvidence_affiliateId_fkey",
DROP CONSTRAINT "ExternalOrderEvidence_productId_fkey",
ADD CONSTRAINT "ExternalOrderEvidence_affiliateId_vendorId_fkey"
  FOREIGN KEY ("affiliateId", "vendorId") REFERENCES "Affiliate"("id", "vendorId") ON DELETE RESTRICT ON UPDATE CASCADE,
ADD CONSTRAINT "ExternalOrderEvidence_productId_vendorId_fkey"
  FOREIGN KEY ("productId", "vendorId") REFERENCES "Product"("id", "vendorId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Rollback requires restoring the original single-column foreign keys before dropping these constraints and indexes.
