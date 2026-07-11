BEGIN;

ALTER TABLE "PaymentTransaction" ADD COLUMN "bookingMonthKey" TEXT;

UPDATE "PaymentTransaction"
SET "bookingMonthKey" = to_char("occurredAt" AT TIME ZONE 'UTC', 'YYYY-MM')
WHERE "status" IN ('paid', 'partially_refunded', 'refunded');

CREATE INDEX "PaymentTransaction_vendorId_bookingMonthKey_idx"
ON "PaymentTransaction"("vendorId", "bookingMonthKey");

COMMIT;
