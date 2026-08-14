-- FIN-2026-08-07-38: align the AffiliatePayout table with the existing
-- gross/net payout reference contract used by the application.
-- Nullable columns preserve legacy payout rows without inventing history.
ALTER TABLE "AffiliatePayout"
ADD COLUMN IF NOT EXISTS "grossSalesAmountCents" INTEGER,
ADD COLUMN IF NOT EXISTS "netReferenceAmountCents" INTEGER;
