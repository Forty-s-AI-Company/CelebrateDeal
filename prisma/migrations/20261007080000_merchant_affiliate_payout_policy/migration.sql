CREATE TABLE "MerchantAffiliatePayoutPolicy" (
  "vendorId" TEXT NOT NULL, "revision" INTEGER NOT NULL DEFAULT 0,
  "bankFeeCents" INTEGER NOT NULL, "enabled" BOOLEAN NOT NULL DEFAULT false,
  "updatedByUserId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "MerchantAffiliatePayoutPolicy_pkey" PRIMARY KEY ("vendorId"),
  CONSTRAINT "MerchantAffiliatePayoutPolicy_vendor_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "MerchantAffiliatePayoutPolicy_values_check" CHECK ("revision" >= 0 AND "bankFeeCents" >= 0)
);
ALTER TABLE "MerchantAffiliatePayoutPolicy" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "AffiliateRemunerationSnapshot" ADD COLUMN "payoutPolicyRevision" INTEGER;
ALTER TABLE "AffiliateRemunerationSnapshot" ADD CONSTRAINT "AffiliateRemunerationSnapshot_policy_revision_check" CHECK ("payoutPolicyRevision" IS NULL OR "payoutPolicyRevision" >= 0);
