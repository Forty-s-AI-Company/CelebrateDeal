ALTER TABLE "PaymentTransaction"
ADD COLUMN IF NOT EXISTS "checkoutIdempotencyKey" TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS "PaymentTransaction_vendorId_checkoutIdempotencyKey_key"
ON "PaymentTransaction"("vendorId", "checkoutIdempotencyKey");
