-- Preserve the merchant-entered payment note or void reason on the affiliate
-- payout read model. Historical rows remain NULL; no evidence is invented.
ALTER TABLE "AffiliatePayout"
  ADD COLUMN "outcomeReason" TEXT;

ALTER TABLE "AffiliatePayout"
  ADD CONSTRAINT "AffiliatePayout_outcomeReason_length"
  CHECK (
    "outcomeReason" IS NULL
    OR (
      btrim("outcomeReason") <> ''
      AND char_length("outcomeReason") BETWEEN 1 AND 500
    )
  );
