DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "Settlement"
    WHERE "lockedAt" IS NOT NULL
      AND "finalPayoutAmountCents" < 0
  ) THEN
    RAISE EXCEPTION 'Locked settlements with negative final payout require reconciliation before carry ledger migration';
  END IF;
END $$;

ALTER TABLE "Settlement"
  ADD COLUMN "carryInAmountCents" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "carryForwardAmountCents" INTEGER NOT NULL DEFAULT 0;
