-- F-038 / B03-02: an explicit purpose on every payment transaction.
--
-- The monthly settlement summed every paid transaction of a vendor, so a
-- merchant's own platform plan payment (billingPurpose
-- "platform_subscription_checkout") or invoice payment ("invoice_payment")
-- was counted as merchant revenue and paid back out. The settlement now
-- counts only "buyer_order" rows.
--
-- Forward-only. Adds one enum and one NOT NULL column with a default, then
-- backfills existing rows from server-owned data only:
--   0. the demo provider never moves money: always "demo", excluded from the
--      settlement without blocking it (Sandbox/staging history);
--   1. metadata.billingPurpose written by the server-side checkout creators;
--   2. a CommerceOrder whose primary payment is the row (buyer checkout).
-- The explicit platform/invoice purposes win over a CommerceOrder link so a
-- corrupted row can never turn platform money into merchant revenue.
-- Anything else stays "unclassified"; calculateSettlement refuses a month
-- that still contains such a paid row instead of guessing.
CREATE TYPE "PaymentTransactionPurpose" AS ENUM ('buyer_order', 'platform_subscription', 'invoice_payment', 'demo', 'unclassified');

DO $$
BEGIN
  -- Transaction-scoped: bounds the ALTER TABLE / UPDATE lock wait.
  PERFORM pg_catalog.set_config('lock_timeout', '5s', true);
END
$$;

ALTER TABLE "PaymentTransaction"
  ADD COLUMN "purpose" "PaymentTransactionPurpose" NOT NULL DEFAULT 'unclassified';

UPDATE "PaymentTransaction" AS payment
   SET "purpose" = CASE
     WHEN payment."providerName" = 'demo' THEN 'demo'
     WHEN payment."metadata"->>'billingPurpose' = 'platform_subscription_checkout' THEN 'platform_subscription'
     WHEN payment."metadata"->>'billingPurpose' = 'invoice_payment' THEN 'invoice_payment'
     WHEN payment."metadata"->>'billingPurpose' = 'buyer_order' THEN 'buyer_order'
     WHEN payment."metadata"->>'billingPurpose' IS NULL
          AND EXISTS (
            SELECT 1
              FROM "CommerceOrder" AS commerce_order
             WHERE commerce_order."vendorId" = payment."vendorId"
               AND commerce_order."primaryPaymentTransactionId" = payment."id"
          ) THEN 'buyer_order'
     ELSE 'unclassified'
   END::"PaymentTransactionPurpose";
