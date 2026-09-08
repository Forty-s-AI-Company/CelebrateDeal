-- Nullable compliance snapshots preserve compatibility for historical payouts.
ALTER TABLE "Affiliate"
  ADD COLUMN "taxIdentityEncrypted" TEXT;

ALTER TABLE "AffiliatePayout"
  ADD COLUMN "grossAmountCents" INTEGER,
  ADD COLUMN "withholdingTaxCents" INTEGER,
  ADD COLUMN "nhiSupplementaryTaxCents" INTEGER,
  ADD COLUMN "bankFeeCents" INTEGER,
  ADD COLUMN "netPayoutAmountCents" INTEGER,
  ADD COLUMN "taxCategory" TEXT NOT NULL DEFAULT '92_other',
  ADD COLUMN "withholdingRuleVersion" TEXT,
  ADD COLUMN "signedAt" TIMESTAMP(3),
  ADD COLUMN "requestedTaxIdentityEncrypted" TEXT;

ALTER TABLE "AffiliatePayout"
  ADD CONSTRAINT "AffiliatePayout_compliance_amounts_nonnegative" CHECK (
    ("grossAmountCents" IS NULL OR "grossAmountCents" >= 0) AND
    ("withholdingTaxCents" IS NULL OR "withholdingTaxCents" >= 0) AND
    ("nhiSupplementaryTaxCents" IS NULL OR "nhiSupplementaryTaxCents" >= 0) AND
    ("bankFeeCents" IS NULL OR "bankFeeCents" >= 0) AND
    ("netPayoutAmountCents" IS NULL OR "netPayoutAmountCents" >= 0)
  );
