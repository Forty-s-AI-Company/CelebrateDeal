-- Affiliate Portal ownership is an explicit User binding. Existing affiliates
-- remain unclaimed until a merchant provisions their portal access.
ALTER TABLE "Affiliate"
  ADD COLUMN "userId" TEXT,
  ADD COLUMN "bankAccountEncrypted" TEXT;

ALTER TABLE "AffiliatePayout"
  ADD COLUMN "requestedAt" TIMESTAMP(3),
  ADD COLUMN "requestedBankAccountEncrypted" TEXT;

CREATE UNIQUE INDEX "Affiliate_vendorId_userId_key"
  ON "Affiliate"("vendorId", "userId");
CREATE INDEX "Affiliate_userId_isActive_idx"
  ON "Affiliate"("userId", "isActive");
CREATE INDEX "AffiliatePayout_vendorId_affiliateId_requestedAt_idx"
  ON "AffiliatePayout"("vendorId", "affiliateId", "requestedAt");

ALTER TABLE "Affiliate"
  ADD CONSTRAINT "Affiliate_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
