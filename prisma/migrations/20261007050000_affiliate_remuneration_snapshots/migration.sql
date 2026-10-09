-- Forward-only private payee profiles and revision-bound remuneration quotes.
CREATE UNIQUE INDEX "AffiliatePayout_vendorId_affiliateId_id_key" ON "AffiliatePayout"("vendorId", "affiliateId", "id");

CREATE TABLE "AffiliatePayeeProfile" (
  "vendorId" TEXT NOT NULL, "affiliateId" TEXT NOT NULL,
  "revision" INTEGER NOT NULL DEFAULT 0,
  "bankEncrypted" TEXT NOT NULL, "taxIdentityEncrypted" TEXT NOT NULL,
  "recipientType" TEXT NOT NULL, "nhiTreatment" TEXT NOT NULL,
  "exemptionReference" TEXT, "invoiceReference" TEXT,
  "approvedRevision" INTEGER, "approvedByUserId" TEXT, "approvedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "AffiliatePayeeProfile_pkey" PRIMARY KEY ("vendorId", "affiliateId"),
  CONSTRAINT "AffiliatePayeeProfile_affiliate_fkey" FOREIGN KEY ("vendorId", "affiliateId") REFERENCES "Affiliate"("vendorId", "id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "AffiliatePayeeProfile_revision_check" CHECK ("revision" >= 0),
  CONSTRAINT "AffiliatePayeeProfile_approval_check" CHECK (
    ("approvedRevision" IS NULL AND "approvedByUserId" IS NULL AND "approvedAt" IS NULL) OR
    ("approvedRevision" IS NOT NULL AND "approvedRevision" = "revision" AND "approvedByUserId" IS NOT NULL AND "approvedAt" IS NOT NULL)
  ),
  CONSTRAINT "AffiliatePayeeProfile_classification_check" CHECK (
    "recipientType" IN ('resident_individual','nonresident_individual','domestic_invoice_business') AND
    "nhiTreatment" IN ('subject_execution_business','documented_exemption','not_insured','not_applicable_business') AND
    (("recipientType" = 'domestic_invoice_business' AND "nhiTreatment" = 'not_applicable_business' AND "invoiceReference" IS NOT NULL) OR
    ("recipientType" <> 'domestic_invoice_business' AND "nhiTreatment" <> 'not_applicable_business' AND "invoiceReference" IS NULL)) AND
    ("nhiTreatment" NOT IN ('documented_exemption','not_insured') OR "exemptionReference" IS NOT NULL)
  )
);

CREATE TABLE "AffiliateRemunerationSnapshot" (
  "id" TEXT NOT NULL, "vendorId" TEXT NOT NULL, "affiliateId" TEXT NOT NULL, "payoutId" TEXT NOT NULL,
  "revision" INTEGER NOT NULL, "profileRevision" INTEGER NOT NULL, "ruleVersion" TEXT NOT NULL,
  "grossAmountCents" INTEGER NOT NULL, "withholdingTaxCents" INTEGER NOT NULL,
  "nhiSupplementaryTaxCents" INTEGER NOT NULL, "bankFeeCents" INTEGER NOT NULL,
  "netPayoutAmountCents" INTEGER NOT NULL,
  "bankEncrypted" TEXT NOT NULL, "taxIdentityEncrypted" TEXT NOT NULL,
  "recipientType" TEXT NOT NULL, "nhiTreatment" TEXT NOT NULL,
  "exemptionReference" TEXT, "invoiceReference" TEXT,
  "status" TEXT NOT NULL DEFAULT 'quoted', "signedByUserId" TEXT, "signedAt" TIMESTAMP(3),
  "invalidatedAt" TIMESTAMP(3), "exportedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AffiliateRemunerationSnapshot_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "AffiliateRemunerationSnapshot_payout_fkey" FOREIGN KEY ("vendorId", "affiliateId", "payoutId") REFERENCES "AffiliatePayout"("vendorId", "affiliateId", "id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "AffiliateRemunerationSnapshot_revision_check" CHECK ("revision" >= 0 AND "profileRevision" >= 0),
  CONSTRAINT "AffiliateRemunerationSnapshot_amount_check" CHECK (
    "grossAmountCents" > 0 AND "withholdingTaxCents" >= 0 AND "nhiSupplementaryTaxCents" >= 0 AND "bankFeeCents" >= 0 AND "netPayoutAmountCents" > 0 AND
    "grossAmountCents"::BIGINT = "withholdingTaxCents"::BIGINT + "nhiSupplementaryTaxCents"::BIGINT + "bankFeeCents"::BIGINT + "netPayoutAmountCents"::BIGINT
  ),
  CONSTRAINT "AffiliateRemunerationSnapshot_state_check" CHECK (
    ("status" = 'quoted' AND "signedAt" IS NULL AND "signedByUserId" IS NULL AND "invalidatedAt" IS NULL AND "exportedAt" IS NULL) OR
    ("status" = 'signed' AND "signedAt" IS NOT NULL AND "signedByUserId" IS NOT NULL AND "invalidatedAt" IS NULL AND "exportedAt" IS NULL) OR
    ("status" = 'invalidated' AND "invalidatedAt" IS NOT NULL AND "exportedAt" IS NULL AND (("signedAt" IS NULL AND "signedByUserId" IS NULL) OR ("signedAt" IS NOT NULL AND "signedByUserId" IS NOT NULL))) OR
    ("status" = 'exported' AND "signedAt" IS NOT NULL AND "signedByUserId" IS NOT NULL AND "invalidatedAt" IS NULL AND "exportedAt" IS NOT NULL)
  )
);
CREATE UNIQUE INDEX "AffiliateRemunerationSnapshot_vendorId_payoutId_revision_key" ON "AffiliateRemunerationSnapshot"("vendorId", "payoutId", "revision");
CREATE INDEX "AffiliateRemunerationSnapshot_vendorId_affiliateId_status_idx" ON "AffiliateRemunerationSnapshot"("vendorId", "affiliateId", "status");
ALTER TABLE "AffiliatePayeeProfile" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "AffiliateRemunerationSnapshot" ENABLE ROW LEVEL SECURITY;
