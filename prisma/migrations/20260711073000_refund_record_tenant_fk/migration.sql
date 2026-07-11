BEGIN;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "RefundRecord" refund
    JOIN "PaymentTransaction" transaction ON transaction."id" = refund."paymentTransactionId"
    WHERE refund."vendorId" <> transaction."vendorId"
  ) THEN
    RAISE EXCEPTION 'Cross-tenant RefundRecord rows require reconciliation before migration';
  END IF;
END $$;

ALTER TABLE "RefundRecord"
  DROP CONSTRAINT "RefundRecord_paymentTransactionId_fkey";

CREATE UNIQUE INDEX "PaymentTransaction_id_vendorId_key"
  ON "PaymentTransaction"("id", "vendorId");

ALTER TABLE "RefundRecord"
  ADD CONSTRAINT "RefundRecord_paymentTransactionId_vendorId_fkey"
  FOREIGN KEY ("paymentTransactionId", "vendorId")
  REFERENCES "PaymentTransaction"("id", "vendorId")
  ON DELETE CASCADE ON UPDATE CASCADE;

COMMIT;
