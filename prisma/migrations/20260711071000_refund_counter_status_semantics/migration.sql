BEGIN;

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

COMMIT;
