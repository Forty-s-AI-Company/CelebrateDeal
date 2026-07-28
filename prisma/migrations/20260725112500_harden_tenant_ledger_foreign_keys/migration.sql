-- WP-06: enforce tenant-local financial foreign keys.
-- Deployment must run the aggregate preflight before applying this migration.

CREATE UNIQUE INDEX "Settlement_vendorId_id_key"
ON "Settlement"("vendorId", "id");

ALTER TABLE "PayoutItem"
DROP CONSTRAINT "PayoutItem_settlementId_fkey";

ALTER TABLE "PayoutItem"
ADD CONSTRAINT "PayoutItem_vendorId_settlementId_fkey"
FOREIGN KEY ("vendorId", "settlementId")
REFERENCES "Settlement"("vendorId", "id")
ON DELETE RESTRICT
ON UPDATE CASCADE;

ALTER TABLE "RefundRecord"
DROP CONSTRAINT "RefundRecord_paymentTransactionId_fkey";

ALTER TABLE "RefundRecord"
ADD CONSTRAINT "RefundRecord_vendorId_paymentTransactionId_fkey"
FOREIGN KEY ("vendorId", "paymentTransactionId")
REFERENCES "PaymentTransaction"("vendorId", "id")
ON DELETE CASCADE
ON UPDATE CASCADE;
