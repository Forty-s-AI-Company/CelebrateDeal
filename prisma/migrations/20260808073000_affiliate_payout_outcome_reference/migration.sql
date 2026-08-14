-- Merchant-owned affiliate payout rows remain nullable for historical paid
-- records whose transfer reference was not captured. New paid transitions
-- enforce the reference at the application boundary without inventing old
-- evidence.
ALTER TABLE "AffiliatePayout"
  ADD COLUMN "outcomeReference" TEXT;
