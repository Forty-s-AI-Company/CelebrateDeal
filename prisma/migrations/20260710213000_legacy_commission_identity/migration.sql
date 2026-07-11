-- Normalize the legacy positive commission identity before webhook replay.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "AffiliateCommission" legacy
    JOIN "AffiliateCommission" current
      ON current."vendorId" = legacy."vendorId"
     AND current."sourceId" = legacy."sourceId"
     AND current."sourceType" = 'payment'
    WHERE legacy."sourceType" = 'webhook'
      AND legacy."sourceId" IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'Conflicting legacy/current commission identity; reconcile before migration';
  END IF;
END $$;

UPDATE "AffiliateCommission"
SET "sourceType" = 'payment'
WHERE "sourceType" = 'webhook'
  AND "sourceId" IS NOT NULL;
