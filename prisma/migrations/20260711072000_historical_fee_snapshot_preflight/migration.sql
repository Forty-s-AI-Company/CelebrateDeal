BEGIN;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "PaymentTransaction" transaction
    WHERE transaction."paymentMode" = 'platform'
      AND transaction."status" IN ('paid', 'partially_refunded', 'refunded')
      AND NOT EXISTS (
        SELECT 1
        FROM "VendorSubscription" subscription
        WHERE subscription."vendorId" = transaction."vendorId"
          AND subscription."startedAt" <= transaction."occurredAt"
          AND (subscription."endedAt" IS NULL OR subscription."endedAt" >= transaction."occurredAt")
      )
  ) THEN
    RAISE EXCEPTION 'Historical platform transaction has no subscription fee snapshot source';
  END IF;
END $$;

UPDATE "PaymentTransaction" transaction
SET "platformFeeCents" = ROUND(
  transaction."grossAmountCents"
  * (
    SELECT COALESCE(subscription."customFeeRateBps", plan."transactionFeeRateBps")
    FROM "VendorSubscription" subscription
    JOIN "BillingPlan" plan ON plan."id" = subscription."planId"
    WHERE subscription."vendorId" = transaction."vendorId"
      AND subscription."startedAt" <= transaction."occurredAt"
      AND (subscription."endedAt" IS NULL OR subscription."endedAt" >= transaction."occurredAt")
    ORDER BY subscription."startedAt" DESC
    LIMIT 1
  ) / 10000.0
)::INTEGER
WHERE transaction."paymentMode" = 'platform'
  AND transaction."status" IN ('paid', 'partially_refunded', 'refunded');

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "PaymentTransaction"
    WHERE "refundedPlatformFeeCents" > "platformFeeCents"
  ) THEN
    RAISE EXCEPTION 'Historical platform fee refunds exceed the reconstructed fee snapshot';
  END IF;
END $$;

COMMIT;
