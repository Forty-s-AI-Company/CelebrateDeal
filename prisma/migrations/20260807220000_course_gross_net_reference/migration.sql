-- FUNC-2026-08-07-37: keep course payout commission base and provider-net
-- reference separate. Existing payout rows remain nullable/unknown rather than
-- inventing a historical reference that was never snapshotted.
ALTER TABLE "CoursePayout"
  ADD COLUMN "grossSalesAmountCents" INTEGER,
  ADD COLUMN "netReferenceAmountCents" INTEGER;
