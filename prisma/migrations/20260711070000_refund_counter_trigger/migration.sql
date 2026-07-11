BEGIN;

ALTER TABLE "PaymentTransaction"
  DROP CONSTRAINT IF EXISTS "PaymentTransaction_refundedAmountCents_check",
  DROP CONSTRAINT IF EXISTS "PaymentTransaction_refundedGatewayFeeCents_check",
  DROP CONSTRAINT IF EXISTS "PaymentTransaction_refundedPlatformFeeCents_check";

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
SET "platformFeeCents" = CASE
  WHEN transaction."paymentMode" <> 'platform' THEN 0
  ELSE ROUND(
    transaction."grossAmountCents"
    * COALESCE((
      SELECT COALESCE(subscription."customFeeRateBps", plan."transactionFeeRateBps")
      FROM "VendorSubscription" subscription
      JOIN "BillingPlan" plan ON plan."id" = subscription."planId"
      WHERE subscription."vendorId" = transaction."vendorId"
        AND subscription."startedAt" <= transaction."occurredAt"
        AND (subscription."endedAt" IS NULL OR subscription."endedAt" >= transaction."occurredAt")
      ORDER BY subscription."startedAt" DESC
      LIMIT 1
    ), 0) / 10000.0
  )::INTEGER
END
WHERE transaction."status" IN ('paid', 'partially_refunded', 'refunded');

UPDATE "PaymentTransaction" transaction
SET
  "refundedAmountCents" = totals."refundAmountCents",
  "refundedGatewayFeeCents" = totals."gatewayFeeRefundCents",
  "refundedPlatformFeeCents" = totals."platformFeeRefundCents"
FROM (
  SELECT
    "paymentTransactionId",
    COALESCE(SUM("refundAmountCents"), 0)::INTEGER AS "refundAmountCents",
    COALESCE(SUM("gatewayFeeRefundCents"), 0)::INTEGER AS "gatewayFeeRefundCents",
    COALESCE(SUM("platformFeeRefundCents"), 0)::INTEGER AS "platformFeeRefundCents"
  FROM "RefundRecord"
  WHERE "status" = 'processed'
  GROUP BY "paymentTransactionId"
) totals
WHERE transaction."id" = totals."paymentTransactionId";

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "PaymentTransaction"
    WHERE "refundedAmountCents" < 0
       OR "refundedAmountCents" > "grossAmountCents"
       OR "refundedGatewayFeeCents" < 0
       OR "refundedGatewayFeeCents" > "gatewayFeeCents"
       OR "refundedPlatformFeeCents" < 0
       OR "refundedPlatformFeeCents" > "platformFeeCents"
  ) THEN
    RAISE EXCEPTION 'Historical refund principal or fee totals exceed the immutable paid snapshot';
  END IF;
END $$;

ALTER TABLE "PaymentTransaction"
  ADD CONSTRAINT "PaymentTransaction_refundedAmountCents_check"
    CHECK ("refundedAmountCents" >= 0 AND "refundedAmountCents" <= "grossAmountCents"),
  ADD CONSTRAINT "PaymentTransaction_refundedGatewayFeeCents_check"
    CHECK ("refundedGatewayFeeCents" >= 0 AND "refundedGatewayFeeCents" <= "gatewayFeeCents"),
  ADD CONSTRAINT "PaymentTransaction_refundedPlatformFeeCents_check"
    CHECK ("refundedPlatformFeeCents" >= 0 AND "refundedPlatformFeeCents" <= "platformFeeCents");

CREATE OR REPLACE FUNCTION "syncPaymentRefundCounters"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    UPDATE "PaymentTransaction"
    SET
      "refundedAmountCents" = "refundedAmountCents" + CASE WHEN NEW."status" = 'processed' THEN NEW."refundAmountCents" ELSE 0 END,
      "refundedGatewayFeeCents" = "refundedGatewayFeeCents" + CASE WHEN NEW."status" = 'processed' THEN NEW."gatewayFeeRefundCents" ELSE 0 END,
      "refundedPlatformFeeCents" = "refundedPlatformFeeCents" + CASE WHEN NEW."status" = 'processed' THEN NEW."platformFeeRefundCents" ELSE 0 END
    WHERE "id" = NEW."paymentTransactionId";
    RETURN NEW;
  ELSIF TG_OP = 'UPDATE' THEN
    IF NEW."paymentTransactionId" <> OLD."paymentTransactionId" THEN
      RAISE EXCEPTION 'RefundRecord paymentTransactionId is immutable';
    END IF;
    UPDATE "PaymentTransaction"
    SET
      "refundedAmountCents" = "refundedAmountCents" + CASE WHEN NEW."status" = 'processed' THEN NEW."refundAmountCents" ELSE 0 END - CASE WHEN OLD."status" = 'processed' THEN OLD."refundAmountCents" ELSE 0 END,
      "refundedGatewayFeeCents" = "refundedGatewayFeeCents" + CASE WHEN NEW."status" = 'processed' THEN NEW."gatewayFeeRefundCents" ELSE 0 END - CASE WHEN OLD."status" = 'processed' THEN OLD."gatewayFeeRefundCents" ELSE 0 END,
      "refundedPlatformFeeCents" = "refundedPlatformFeeCents" + CASE WHEN NEW."status" = 'processed' THEN NEW."platformFeeRefundCents" ELSE 0 END - CASE WHEN OLD."status" = 'processed' THEN OLD."platformFeeRefundCents" ELSE 0 END
    WHERE "id" = NEW."paymentTransactionId";
    RETURN NEW;
  END IF;
  UPDATE "PaymentTransaction"
  SET
    "refundedAmountCents" = "refundedAmountCents" - CASE WHEN OLD."status" = 'processed' THEN OLD."refundAmountCents" ELSE 0 END,
    "refundedGatewayFeeCents" = "refundedGatewayFeeCents" - CASE WHEN OLD."status" = 'processed' THEN OLD."gatewayFeeRefundCents" ELSE 0 END,
    "refundedPlatformFeeCents" = "refundedPlatformFeeCents" - CASE WHEN OLD."status" = 'processed' THEN OLD."platformFeeRefundCents" ELSE 0 END
  WHERE "id" = OLD."paymentTransactionId";
  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS "RefundRecord_syncPaymentRefundCounters" ON "RefundRecord";
CREATE TRIGGER "RefundRecord_syncPaymentRefundCounters"
AFTER INSERT OR UPDATE OR DELETE ON "RefundRecord"
FOR EACH ROW EXECUTE FUNCTION "syncPaymentRefundCounters"();

COMMIT;
