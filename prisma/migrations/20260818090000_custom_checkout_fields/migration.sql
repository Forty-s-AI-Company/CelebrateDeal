-- Custom checkout fields are merchant-defined, optional product metadata. Buyer
-- answers are intentionally stored only as a purpose-bound encrypted envelope.
ALTER TABLE "Product"
ADD COLUMN IF NOT EXISTS "customCheckoutFields" JSONB;

ALTER TABLE "CommerceOrderItem"
ADD COLUMN IF NOT EXISTS "customCheckoutAnswersEncryptedEnvelope" TEXT;
