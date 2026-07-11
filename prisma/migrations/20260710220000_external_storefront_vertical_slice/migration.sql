-- Preflight: this migration defaults all existing products to platform checkout. Before deploy,
-- verify any product intended for external checkout has an application-validated HTTPS checkoutUrl.
-- The migration intentionally fails if a future/manual checkoutMode value violates the constraints below.

ALTER TABLE "Product"
ADD COLUMN "checkoutMode" TEXT NOT NULL DEFAULT 'platform';

ALTER TABLE "Product"
ADD CONSTRAINT "Product_checkout_mode_valid"
CHECK ("checkoutMode" IN ('platform', 'external')),
ADD CONSTRAINT "Product_external_checkout_url_required"
CHECK (
  "checkoutMode" <> 'external'
  OR (
    "checkoutUrl" IS NOT NULL
    AND "checkoutUrl" ~ '^https://[^[:space:]]+$'
  )
);

CREATE TABLE "AffiliateProductLink" (
  "id" TEXT NOT NULL,
  "vendorId" TEXT NOT NULL,
  "affiliateId" TEXT NOT NULL,
  "productId" TEXT NOT NULL,
  "url" TEXT NOT NULL,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "AffiliateProductLink_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "AffiliateProductLink_https_url" CHECK ("url" ~ '^https://[^[:space:]]+$')
);

CREATE TABLE "ExternalOrderEvidence" (
  "id" TEXT NOT NULL,
  "vendorId" TEXT NOT NULL,
  "affiliateId" TEXT NOT NULL,
  "productId" TEXT NOT NULL,
  "externalOrderReference" TEXT NOT NULL,
  "amountCents" INTEGER NOT NULL,
  "currency" TEXT NOT NULL,
  "referralCode" TEXT NOT NULL,
  "commissionRateBps" INTEGER NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'pending_review',
  "submittedByUserId" TEXT NOT NULL,
  "reviewedByUserId" TEXT,
  "reviewedAt" TIMESTAMP(3),
  "reviewNote" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "ExternalOrderEvidence_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ExternalOrderEvidence_reference_not_blank" CHECK (btrim("externalOrderReference") <> ''),
  CONSTRAINT "ExternalOrderEvidence_amount_positive" CHECK ("amountCents" > 0),
  CONSTRAINT "ExternalOrderEvidence_currency_valid" CHECK ("currency" ~ '^[A-Z]{3}$'),
  CONSTRAINT "ExternalOrderEvidence_referral_code_not_blank" CHECK (btrim("referralCode") <> ''),
  CONSTRAINT "ExternalOrderEvidence_commission_rate_valid" CHECK ("commissionRateBps" BETWEEN 0 AND 10000),
  CONSTRAINT "ExternalOrderEvidence_status_valid" CHECK ("status" IN ('pending_review', 'confirmed', 'rejected')),
  CONSTRAINT "ExternalOrderEvidence_review_state_valid" CHECK (
    ("status" = 'pending_review' AND "reviewedByUserId" IS NULL AND "reviewedAt" IS NULL)
    OR
    ("status" IN ('confirmed', 'rejected') AND "reviewedByUserId" IS NOT NULL AND "reviewedAt" IS NOT NULL)
  )
);

CREATE UNIQUE INDEX "AffiliateProductLink_affiliateId_productId_key"
ON "AffiliateProductLink"("affiliateId", "productId");

CREATE INDEX "AffiliateProductLink_vendorId_productId_isActive_idx"
ON "AffiliateProductLink"("vendorId", "productId", "isActive");

CREATE UNIQUE INDEX "ExternalOrderEvidence_vendorId_externalOrderReference_key"
ON "ExternalOrderEvidence"("vendorId", "externalOrderReference");

CREATE INDEX "ExternalOrderEvidence_vendorId_status_createdAt_idx"
ON "ExternalOrderEvidence"("vendorId", "status", "createdAt");

CREATE INDEX "ExternalOrderEvidence_affiliateId_productId_idx"
ON "ExternalOrderEvidence"("affiliateId", "productId");

ALTER TABLE "AffiliateProductLink"
ADD CONSTRAINT "AffiliateProductLink_vendorId_fkey"
FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE CASCADE ON UPDATE CASCADE,
ADD CONSTRAINT "AffiliateProductLink_affiliateId_fkey"
FOREIGN KEY ("affiliateId") REFERENCES "Affiliate"("id") ON DELETE CASCADE ON UPDATE CASCADE,
ADD CONSTRAINT "AffiliateProductLink_productId_fkey"
FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ExternalOrderEvidence"
ADD CONSTRAINT "ExternalOrderEvidence_vendorId_fkey"
FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE CASCADE ON UPDATE CASCADE,
ADD CONSTRAINT "ExternalOrderEvidence_affiliateId_fkey"
FOREIGN KEY ("affiliateId") REFERENCES "Affiliate"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
ADD CONSTRAINT "ExternalOrderEvidence_productId_fkey"
FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
ADD CONSTRAINT "ExternalOrderEvidence_submittedByUserId_fkey"
FOREIGN KEY ("submittedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
ADD CONSTRAINT "ExternalOrderEvidence_reviewedByUserId_fkey"
FOREIGN KEY ("reviewedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Rollback (manual, only after confirming no external commissions depend on evidence rows):
-- DELETE FROM "AffiliateCommission" WHERE "sourceType" = 'external_order_evidence';
-- DROP TABLE "ExternalOrderEvidence"; DROP TABLE "AffiliateProductLink";
-- ALTER TABLE "Product" DROP CONSTRAINT "Product_external_checkout_url_required",
--   DROP CONSTRAINT "Product_checkout_mode_valid", DROP COLUMN "checkoutMode";
