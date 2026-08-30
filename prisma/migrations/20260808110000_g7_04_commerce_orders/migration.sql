-- G7-04B: canonical, tenant-scoped commerce order domain.
-- This migration is additive. Historical product rows retain their current
-- catalogue values, with course-domain rows explicitly backfilled to course.

CREATE TYPE "CommerceFulfillmentType" AS ENUM ('physical', 'digital', 'service', 'course');
CREATE TYPE "CommerceOrderStatus" AS ENUM ('draft', 'pending_payment', 'paid', 'payment_failed', 'expired', 'cancelled', 'partially_refunded', 'refunded');
CREATE TYPE "ShippingFulfillmentStatus" AS ENUM ('pending', 'packing', 'shipped', 'delivered', 'cancelled');
CREATE TYPE "CommerceEntitlementStatus" AS ENUM ('pending', 'granted', 'revoked');
CREATE TYPE "ServiceFulfillmentStatus" AS ENUM ('pending', 'scheduling', 'scheduled', 'completed', 'cancelled');
CREATE TYPE "CommerceOrderRefundStatus" AS ENUM ('pending', 'processed', 'failed');

ALTER TABLE "Product"
ADD COLUMN IF NOT EXISTS "fulfillmentType" "CommerceFulfillmentType" NOT NULL DEFAULT 'physical',
ADD COLUMN IF NOT EXISTS "fulfillmentTypeConfirmed" BOOLEAN NOT NULL DEFAULT false;

UPDATE "Product"
SET "fulfillmentType" = 'course',
    "fulfillmentTypeConfirmed" = true
WHERE "commerceDomain" = 'course';

-- New products are explicit through the product form. Historical non-course
-- rows remain fail-closed until a merchant confirms physical/digital/service.
ALTER TABLE "Product"
ALTER COLUMN "fulfillmentTypeConfirmed" SET DEFAULT true;

CREATE TABLE "CommerceOrder" (
  "id" TEXT NOT NULL,
  "vendorId" TEXT NOT NULL,
  "orderNumber" TEXT NOT NULL,
  "checkoutIdempotencyKey" TEXT NOT NULL,
  "checkoutIdentityHash" TEXT NOT NULL,
  "primaryPaymentTransactionId" TEXT,
  "status" "CommerceOrderStatus" NOT NULL DEFAULT 'pending_payment',
  "currency" TEXT NOT NULL DEFAULT 'TWD',
  "subtotalAmountCents" INTEGER NOT NULL,
  "totalAmountCents" INTEGER NOT NULL,
  "paidAmountCents" INTEGER NOT NULL DEFAULT 0,
  "refundedAmountCents" INTEGER NOT NULL DEFAULT 0,
  "buyerEncryptedEnvelope" TEXT NOT NULL,
  "buyerMaskedName" TEXT NOT NULL,
  "buyerMaskedEmail" TEXT NOT NULL,
  "buyerMaskedPhone" TEXT,
  "shippingEncryptedEnvelope" TEXT,
  "shippingMaskedSummary" TEXT,
  "paidAt" TIMESTAMP(3),
  "failedAt" TIMESTAMP(3),
  "refundedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "CommerceOrder_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "CommerceOrder_vendorId_id_key" UNIQUE ("vendorId", "id"),
  CONSTRAINT "CommerceOrder_vendorId_orderNumber_key" UNIQUE ("vendorId", "orderNumber"),
  CONSTRAINT "CommerceOrder_vendorId_checkoutIdempotencyKey_key" UNIQUE ("vendorId", "checkoutIdempotencyKey"),
  CONSTRAINT "CommerceOrder_vendorId_primaryPaymentTransactionId_key" UNIQUE ("vendorId", "primaryPaymentTransactionId")
);

CREATE TABLE "CommerceOrderItem" (
  "id" TEXT NOT NULL,
  "vendorId" TEXT NOT NULL,
  "orderId" TEXT NOT NULL,
  "productId" TEXT,
  "lineIndex" INTEGER NOT NULL,
  "productName" TEXT NOT NULL,
  "productSlug" TEXT NOT NULL,
  "commerceDomain" TEXT NOT NULL,
  "fulfillmentType" "CommerceFulfillmentType" NOT NULL,
  "unitPriceCents" INTEGER NOT NULL,
  "quantity" INTEGER NOT NULL,
  "lineTotalCents" INTEGER NOT NULL,
  "imageUrl" TEXT,
  "nonSensitiveSnapshot" JSONB NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CommerceOrderItem_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "CommerceOrderItem_vendorId_id_key" UNIQUE ("vendorId", "id"),
  CONSTRAINT "CommerceOrderItem_vendorId_orderId_lineIndex_key" UNIQUE ("vendorId", "orderId", "lineIndex")
);

CREATE TABLE "CommerceOrderEvent" (
  "id" TEXT NOT NULL,
  "vendorId" TEXT NOT NULL,
  "orderId" TEXT NOT NULL,
  "dedupKey" TEXT NOT NULL,
  "eventType" TEXT NOT NULL,
  "actorType" TEXT NOT NULL,
  "actorId" TEXT,
  "sanitizedData" JSONB,
  "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CommerceOrderEvent_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "CommerceOrderEvent_vendorId_id_key" UNIQUE ("vendorId", "id"),
  CONSTRAINT "CommerceOrderEvent_vendorId_orderId_dedupKey_key" UNIQUE ("vendorId", "orderId", "dedupKey")
);

CREATE TABLE "CommerceOrderRefund" (
  "id" TEXT NOT NULL,
  "vendorId" TEXT NOT NULL,
  "orderId" TEXT NOT NULL,
  "paymentTransactionId" TEXT,
  "refundRecordId" TEXT,
  "providerName" TEXT NOT NULL,
  "eventIdentity" TEXT NOT NULL,
  "amountCents" INTEGER NOT NULL,
  "cumulativeAmountCents" INTEGER NOT NULL,
  "status" "CommerceOrderRefundStatus" NOT NULL DEFAULT 'processed',
  "occurredAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CommerceOrderRefund_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "CommerceOrderRefund_vendorId_id_key" UNIQUE ("vendorId", "id"),
  CONSTRAINT "CommerceOrderRefund_vendorId_providerName_eventIdentity_key" UNIQUE ("vendorId", "providerName", "eventIdentity"),
  CONSTRAINT "CommerceOrderRefund_vendorId_refundRecordId_key" UNIQUE ("vendorId", "refundRecordId")
);

CREATE TABLE "ShippingFulfillment" (
  "id" TEXT NOT NULL,
  "vendorId" TEXT NOT NULL,
  "orderItemId" TEXT NOT NULL,
  "revision" INTEGER NOT NULL DEFAULT 1,
  "status" "ShippingFulfillmentStatus" NOT NULL DEFAULT 'pending',
  "carrierName" TEXT,
  "trackingNumber" TEXT,
  "trackingUrl" TEXT,
  "packingAt" TIMESTAMP(3),
  "shippedAt" TIMESTAMP(3),
  "deliveredAt" TIMESTAMP(3),
  "cancelledAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ShippingFulfillment_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ShippingFulfillment_vendorId_id_key" UNIQUE ("vendorId", "id"),
  CONSTRAINT "ShippingFulfillment_vendorId_orderItemId_key" UNIQUE ("vendorId", "orderItemId")
);

CREATE TABLE "CommerceEntitlement" (
  "id" TEXT NOT NULL,
  "vendorId" TEXT NOT NULL,
  "orderItemId" TEXT NOT NULL,
  "revision" INTEGER NOT NULL DEFAULT 1,
  "status" "CommerceEntitlementStatus" NOT NULL DEFAULT 'pending',
  "accessEncryptedEnvelope" TEXT,
  "accessMaskedSummary" TEXT,
  "grantedAt" TIMESTAMP(3),
  "expiresAt" TIMESTAMP(3),
  "revokedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "CommerceEntitlement_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "CommerceEntitlement_vendorId_id_key" UNIQUE ("vendorId", "id"),
  CONSTRAINT "CommerceEntitlement_vendorId_orderItemId_key" UNIQUE ("vendorId", "orderItemId")
);

CREATE TABLE "ServiceFulfillment" (
  "id" TEXT NOT NULL,
  "vendorId" TEXT NOT NULL,
  "orderItemId" TEXT NOT NULL,
  "revision" INTEGER NOT NULL DEFAULT 1,
  "status" "ServiceFulfillmentStatus" NOT NULL DEFAULT 'pending',
  "scheduledAt" TIMESTAMP(3),
  "completedAt" TIMESTAMP(3),
  "cancelledAt" TIMESTAMP(3),
  "serviceEncryptedEnvelope" TEXT,
  "serviceMaskedSummary" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ServiceFulfillment_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ServiceFulfillment_vendorId_id_key" UNIQUE ("vendorId", "id"),
  CONSTRAINT "ServiceFulfillment_vendorId_orderItemId_key" UNIQUE ("vendorId", "orderItemId")
);

ALTER TABLE "CommerceOrder"
ADD CONSTRAINT "CommerceOrder_amounts_check" CHECK (
  "subtotalAmountCents" >= 0
  AND "totalAmountCents" >= 0
  AND "paidAmountCents" >= 0
  AND "refundedAmountCents" >= 0
  AND "paidAmountCents" <= "totalAmountCents"
  AND "refundedAmountCents" <= "paidAmountCents"
),
ADD CONSTRAINT "CommerceOrder_currency_check" CHECK ("currency" ~ '^[A-Z]{3}$'),
ADD CONSTRAINT "CommerceOrder_identity_hash_check" CHECK ("checkoutIdentityHash" ~ '^[A-Za-z0-9_-]{43}$'),
ADD CONSTRAINT "CommerceOrder_buyer_envelope_check" CHECK (length("buyerEncryptedEnvelope") > 0),
ADD CONSTRAINT "CommerceOrder_buyer_masks_check" CHECK (
  length("buyerMaskedName") > 0 AND length("buyerMaskedEmail") > 0
),
ADD CONSTRAINT "CommerceOrder_shipping_pair_check" CHECK (
  ("shippingEncryptedEnvelope" IS NULL AND "shippingMaskedSummary" IS NULL)
  OR (
    "shippingEncryptedEnvelope" IS NOT NULL
    AND "shippingMaskedSummary" IS NOT NULL
    AND length("shippingEncryptedEnvelope") > 0
    AND length("shippingMaskedSummary") > 0
  )
);

ALTER TABLE "CommerceOrderItem"
ADD CONSTRAINT "CommerceOrderItem_amounts_check" CHECK (
  "unitPriceCents" >= 0
  AND "quantity" > 0
  AND "lineTotalCents" >= 0
  AND ("lineTotalCents")::BIGINT = ("unitPriceCents")::BIGINT * ("quantity")::BIGINT
);

ALTER TABLE "CommerceOrderRefund"
ADD CONSTRAINT "CommerceOrderRefund_amounts_check" CHECK (
  "amountCents" > 0 AND "cumulativeAmountCents" >= "amountCents"
);

ALTER TABLE "ShippingFulfillment"
ADD CONSTRAINT "ShippingFulfillment_revision_check" CHECK ("revision" > 0),
ADD CONSTRAINT "ShippingFulfillment_timestamps_check" CHECK (
  ("status" NOT IN ('shipped', 'delivered') OR "shippedAt" IS NOT NULL)
  AND ("status" <> 'delivered' OR "deliveredAt" IS NOT NULL)
  AND ("status" <> 'cancelled' OR "cancelledAt" IS NOT NULL)
);

ALTER TABLE "CommerceEntitlement"
ADD CONSTRAINT "CommerceEntitlement_revision_check" CHECK ("revision" > 0),
ADD CONSTRAINT "CommerceEntitlement_access_pair_check" CHECK (
  ("accessEncryptedEnvelope" IS NULL) = ("accessMaskedSummary" IS NULL)
),
ADD CONSTRAINT "CommerceEntitlement_granted_access_check" CHECK (
  "status" <> 'granted' OR "accessEncryptedEnvelope" IS NOT NULL
),
ADD CONSTRAINT "CommerceEntitlement_lifecycle_check" CHECK (
  (
    "status" = 'pending'
    AND "grantedAt" IS NULL
    AND "revokedAt" IS NULL
  )
  OR (
    "status" = 'granted'
    AND "grantedAt" IS NOT NULL
    AND "revokedAt" IS NULL
    AND "accessEncryptedEnvelope" IS NOT NULL
  )
  OR (
    "status" = 'revoked'
    AND "revokedAt" IS NOT NULL
    AND "accessEncryptedEnvelope" IS NULL
    AND "accessMaskedSummary" IS NULL
  )
);

ALTER TABLE "ServiceFulfillment"
ADD CONSTRAINT "ServiceFulfillment_revision_check" CHECK ("revision" > 0),
ADD CONSTRAINT "ServiceFulfillment_timestamps_check" CHECK (
  ("status" NOT IN ('scheduled', 'completed') OR "scheduledAt" IS NOT NULL)
  AND ("status" <> 'completed' OR "completedAt" IS NOT NULL)
  AND ("status" <> 'cancelled' OR "cancelledAt" IS NOT NULL)
);

CREATE UNIQUE INDEX "RefundRecord_vendorId_id_key" ON "RefundRecord"("vendorId", "id");

CREATE INDEX "Product_vendorId_fulfillmentType_isActive_idx" ON "Product"("vendorId", "fulfillmentType", "isActive");
CREATE INDEX "CommerceOrder_vendorId_status_createdAt_idx" ON "CommerceOrder"("vendorId", "status", "createdAt");
CREATE INDEX "CommerceOrder_vendorId_paidAt_idx" ON "CommerceOrder"("vendorId", "paidAt");
CREATE INDEX "CommerceOrderItem_vendorId_productId_idx" ON "CommerceOrderItem"("vendorId", "productId");
CREATE INDEX "CommerceOrderItem_vendorId_fulfillmentType_idx" ON "CommerceOrderItem"("vendorId", "fulfillmentType");
CREATE INDEX "CommerceOrderEvent_vendorId_orderId_occurredAt_idx" ON "CommerceOrderEvent"("vendorId", "orderId", "occurredAt");
CREATE INDEX "CommerceOrderEvent_vendorId_eventType_occurredAt_idx" ON "CommerceOrderEvent"("vendorId", "eventType", "occurredAt");
CREATE INDEX "CommerceOrderRefund_vendorId_orderId_occurredAt_idx" ON "CommerceOrderRefund"("vendorId", "orderId", "occurredAt");
CREATE INDEX "CommerceOrderRefund_vendorId_paymentTransactionId_idx" ON "CommerceOrderRefund"("vendorId", "paymentTransactionId");
CREATE INDEX "ShippingFulfillment_vendorId_status_updatedAt_idx" ON "ShippingFulfillment"("vendorId", "status", "updatedAt");
CREATE INDEX "ShippingFulfillment_trackingNumber_idx" ON "ShippingFulfillment"("trackingNumber");
CREATE INDEX "CommerceEntitlement_vendorId_status_expiresAt_idx" ON "CommerceEntitlement"("vendorId", "status", "expiresAt");
CREATE INDEX "ServiceFulfillment_vendorId_status_scheduledAt_idx" ON "ServiceFulfillment"("vendorId", "status", "scheduledAt");

ALTER TABLE "CommerceOrder"
ADD CONSTRAINT "CommerceOrder_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CommerceOrder"
ADD CONSTRAINT "CommerceOrder_primaryPayment_tenant_fkey" FOREIGN KEY ("vendorId", "primaryPaymentTransactionId") REFERENCES "PaymentTransaction"("vendorId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "CommerceOrderItem"
ADD CONSTRAINT "CommerceOrderItem_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CommerceOrderItem"
ADD CONSTRAINT "CommerceOrderItem_order_tenant_fkey" FOREIGN KEY ("vendorId", "orderId") REFERENCES "CommerceOrder"("vendorId", "id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CommerceOrderItem"
ADD CONSTRAINT "CommerceOrderItem_product_tenant_fkey" FOREIGN KEY ("vendorId", "productId") REFERENCES "Product"("vendorId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "CommerceOrderEvent"
ADD CONSTRAINT "CommerceOrderEvent_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CommerceOrderEvent"
ADD CONSTRAINT "CommerceOrderEvent_order_tenant_fkey" FOREIGN KEY ("vendorId", "orderId") REFERENCES "CommerceOrder"("vendorId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "CommerceOrderRefund"
ADD CONSTRAINT "CommerceOrderRefund_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CommerceOrderRefund"
ADD CONSTRAINT "CommerceOrderRefund_order_tenant_fkey" FOREIGN KEY ("vendorId", "orderId") REFERENCES "CommerceOrder"("vendorId", "id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CommerceOrderRefund"
ADD CONSTRAINT "CommerceOrderRefund_payment_tenant_fkey" FOREIGN KEY ("vendorId", "paymentTransactionId") REFERENCES "PaymentTransaction"("vendorId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CommerceOrderRefund"
ADD CONSTRAINT "CommerceOrderRefund_refundRecord_tenant_fkey" FOREIGN KEY ("vendorId", "refundRecordId") REFERENCES "RefundRecord"("vendorId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "ShippingFulfillment"
ADD CONSTRAINT "ShippingFulfillment_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ShippingFulfillment"
ADD CONSTRAINT "ShippingFulfillment_orderItem_tenant_fkey" FOREIGN KEY ("vendorId", "orderItemId") REFERENCES "CommerceOrderItem"("vendorId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "CommerceEntitlement"
ADD CONSTRAINT "CommerceEntitlement_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CommerceEntitlement"
ADD CONSTRAINT "CommerceEntitlement_orderItem_tenant_fkey" FOREIGN KEY ("vendorId", "orderItemId") REFERENCES "CommerceOrderItem"("vendorId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ServiceFulfillment"
ADD CONSTRAINT "ServiceFulfillment_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ServiceFulfillment"
ADD CONSTRAINT "ServiceFulfillment_orderItem_tenant_fkey" FOREIGN KEY ("vendorId", "orderItemId") REFERENCES "CommerceOrderItem"("vendorId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE FUNCTION enforce_commerce_order_refund_limit() RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  order_paid INTEGER;
  order_total INTEGER;
BEGIN
  SELECT "paidAmountCents", "totalAmountCents"
  INTO order_paid, order_total
  FROM "CommerceOrder"
  WHERE "vendorId" = NEW."vendorId" AND "id" = NEW."orderId";

  IF FOUND AND NEW."cumulativeAmountCents" > LEAST(order_paid, order_total) THEN
    RAISE EXCEPTION 'Commerce order refund exceeds the paid order amount.'
      USING ERRCODE = '23514', CONSTRAINT = 'CommerceOrderRefund_order_limit_check';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "CommerceOrderRefund_order_limit_trigger"
BEFORE INSERT OR UPDATE ON "CommerceOrderRefund"
FOR EACH ROW EXECUTE FUNCTION enforce_commerce_order_refund_limit();

CREATE FUNCTION enforce_shipping_fulfillment_type() RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  item_type "CommerceFulfillmentType";
BEGIN
  SELECT "fulfillmentType" INTO item_type
  FROM "CommerceOrderItem"
  WHERE "vendorId" = NEW."vendorId" AND "id" = NEW."orderItemId";
  IF FOUND AND item_type <> 'physical' THEN
    RAISE EXCEPTION 'Shipping fulfillment requires a physical order item.'
      USING ERRCODE = '23514', CONSTRAINT = 'ShippingFulfillment_item_type_check';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "ShippingFulfillment_item_type_trigger"
BEFORE INSERT OR UPDATE ON "ShippingFulfillment"
FOR EACH ROW EXECUTE FUNCTION enforce_shipping_fulfillment_type();

CREATE FUNCTION enforce_entitlement_fulfillment_type() RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  item_type "CommerceFulfillmentType";
BEGIN
  SELECT "fulfillmentType" INTO item_type
  FROM "CommerceOrderItem"
  WHERE "vendorId" = NEW."vendorId" AND "id" = NEW."orderItemId";
  IF FOUND AND item_type NOT IN ('digital', 'course') THEN
    RAISE EXCEPTION 'Commerce entitlement requires a digital or course order item.'
      USING ERRCODE = '23514', CONSTRAINT = 'CommerceEntitlement_item_type_check';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "CommerceEntitlement_item_type_trigger"
BEFORE INSERT OR UPDATE ON "CommerceEntitlement"
FOR EACH ROW EXECUTE FUNCTION enforce_entitlement_fulfillment_type();

CREATE FUNCTION enforce_service_fulfillment_type() RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  item_type "CommerceFulfillmentType";
BEGIN
  SELECT "fulfillmentType" INTO item_type
  FROM "CommerceOrderItem"
  WHERE "vendorId" = NEW."vendorId" AND "id" = NEW."orderItemId";
  IF FOUND AND item_type <> 'service' THEN
    RAISE EXCEPTION 'Service fulfillment requires a service order item.'
      USING ERRCODE = '23514', CONSTRAINT = 'ServiceFulfillment_item_type_check';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "ServiceFulfillment_item_type_trigger"
BEFORE INSERT OR UPDATE ON "ServiceFulfillment"
FOR EACH ROW EXECUTE FUNCTION enforce_service_fulfillment_type();
