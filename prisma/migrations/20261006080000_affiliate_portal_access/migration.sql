-- Forward-only tenant/member access; does not grant access to merchant finances.
CREATE TABLE "AffiliatePortalAccess" (
  "vendorId" TEXT NOT NULL,
  "affiliateId" TEXT NOT NULL,
  "vendorMemberId" TEXT NOT NULL,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "revision" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "AffiliatePortalAccess_pkey" PRIMARY KEY ("vendorId", "affiliateId"),
  CONSTRAINT "AffiliatePortalAccess_vendorId_affiliateId_fkey" FOREIGN KEY ("vendorId", "affiliateId") REFERENCES "Affiliate"("vendorId", "id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "AffiliatePortalAccess_vendorId_vendorMemberId_fkey" FOREIGN KEY ("vendorId", "vendorMemberId") REFERENCES "VendorMember"("vendorId", "id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "AffiliatePortalAccess_revision_nonnegative" CHECK ("revision" >= 0)
);
CREATE INDEX "AffiliatePortalAccess_vendorId_vendorMemberId_active_idx" ON "AffiliatePortalAccess"("vendorId", "vendorMemberId", "active");
ALTER TABLE "AffiliatePortalAccess" ENABLE ROW LEVEL SECURITY;
