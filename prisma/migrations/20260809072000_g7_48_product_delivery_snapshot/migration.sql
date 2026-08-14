-- G7-48A: merchant-authored delivery configuration and immutable order-item snapshot.
CREATE TYPE "ProductDeliveryConfigStatus" AS ENUM ('draft', 'active', 'disabled');
CREATE TYPE "ProductDeliveryKind" AS ENUM ('digital_link', 'course_portal', 'service_instructions');

CREATE TABLE "VendorDeliveryUrlAllowlist" (
    "id" TEXT NOT NULL,
    "vendorId" TEXT NOT NULL,
    "hostname" TEXT NOT NULL,
    "pathPrefix" TEXT NOT NULL DEFAULT '/',
    "allowQuery" BOOLEAN NOT NULL DEFAULT false,
    "status" TEXT NOT NULL DEFAULT 'active',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "VendorDeliveryUrlAllowlist_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ProductDeliveryConfig" (
    "id" TEXT NOT NULL,
    "vendorId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "allowlistId" TEXT,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "status" "ProductDeliveryConfigStatus" NOT NULL DEFAULT 'draft',
    "fulfillmentType" "CommerceFulfillmentType" NOT NULL,
    "deliveryKind" "ProductDeliveryKind" NOT NULL,
    "title" TEXT NOT NULL,
    "destinationEncryptedEnvelope" TEXT,
    "destinationMaskedSummary" TEXT,
    "instructionsEncryptedEnvelope" TEXT,
    "instructionsMaskedSummary" TEXT,
    "activatedAt" TIMESTAMP(3),
    "disabledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ProductDeliveryConfig_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "CommerceOrderItemDeliverySnapshot" (
    "id" TEXT NOT NULL,
    "vendorId" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "orderItemId" TEXT NOT NULL,
    "productDeliveryConfigId" TEXT,
    "productDeliveryConfigRevision" INTEGER,
    "fulfillmentType" "CommerceFulfillmentType" NOT NULL,
    "deliveryKind" "ProductDeliveryKind" NOT NULL,
    "title" TEXT NOT NULL,
    "destinationEncryptedEnvelope" TEXT,
    "destinationMaskedSummary" TEXT,
    "instructionsEncryptedEnvelope" TEXT,
    "instructionsMaskedSummary" TEXT,
    "allowlistSnapshot" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" TIMESTAMP(3),
    CONSTRAINT "CommerceOrderItemDeliverySnapshot_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CommerceOrderItem_vendorId_orderId_id_key"
ON "CommerceOrderItem"("vendorId", "orderId", "id");

CREATE UNIQUE INDEX "VendorDeliveryUrlAllowlist_vendorId_id_key"
ON "VendorDeliveryUrlAllowlist"("vendorId", "id");
CREATE UNIQUE INDEX "VendorDeliveryUrlAllowlist_vendorId_hostname_pathPrefix_key"
ON "VendorDeliveryUrlAllowlist"("vendorId", "hostname", "pathPrefix");
CREATE INDEX "VendorDeliveryUrlAllowlist_vendorId_status_updatedAt_idx"
ON "VendorDeliveryUrlAllowlist"("vendorId", "status", "updatedAt");

CREATE UNIQUE INDEX "ProductDeliveryConfig_vendorId_id_key"
ON "ProductDeliveryConfig"("vendorId", "id");
CREATE UNIQUE INDEX "ProductDeliveryConfig_vendorId_productId_key"
ON "ProductDeliveryConfig"("vendorId", "productId");
CREATE INDEX "ProductDeliveryConfig_vendorId_status_updatedAt_idx"
ON "ProductDeliveryConfig"("vendorId", "status", "updatedAt");
CREATE INDEX "ProductDeliveryConfig_vendorId_allowlistId_idx"
ON "ProductDeliveryConfig"("vendorId", "allowlistId");

CREATE UNIQUE INDEX "CommerceOrderItemDeliverySnapshot_vendorId_id_key"
ON "CommerceOrderItemDeliverySnapshot"("vendorId", "id");
CREATE UNIQUE INDEX "CommerceOrderItemDeliverySnapshot_vendorId_orderId_orderItemId_key"
ON "CommerceOrderItemDeliverySnapshot"("vendorId", "orderId", "orderItemId");
CREATE INDEX "CommerceOrderItemDeliverySnapshot_vendorId_orderId_createdAt_idx"
ON "CommerceOrderItemDeliverySnapshot"("vendorId", "orderId", "createdAt");

ALTER TABLE "VendorDeliveryUrlAllowlist"
ADD CONSTRAINT "VendorDeliveryUrlAllowlist_vendorId_fkey"
FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ProductDeliveryConfig"
ADD CONSTRAINT "ProductDeliveryConfig_vendorId_fkey"
FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ProductDeliveryConfig"
ADD CONSTRAINT "ProductDeliveryConfig_vendorId_productId_fkey"
FOREIGN KEY ("vendorId", "productId") REFERENCES "Product"("vendorId", "id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ProductDeliveryConfig"
ADD CONSTRAINT "ProductDeliveryConfig_vendorId_allowlistId_fkey"
FOREIGN KEY ("vendorId", "allowlistId") REFERENCES "VendorDeliveryUrlAllowlist"("vendorId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "CommerceOrderItemDeliverySnapshot"
ADD CONSTRAINT "CommerceOrderItemDeliverySnapshot_vendorId_fkey"
FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CommerceOrderItemDeliverySnapshot"
ADD CONSTRAINT "CommerceOrderItemDeliverySnapshot_vendorId_orderId_fkey"
FOREIGN KEY ("vendorId", "orderId") REFERENCES "CommerceOrder"("vendorId", "id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CommerceOrderItemDeliverySnapshot"
ADD CONSTRAINT "CommerceOrderItemDeliverySnapshot_vendor_order_item_fkey"
FOREIGN KEY ("vendorId", "orderId", "orderItemId") REFERENCES "CommerceOrderItem"("vendorId", "orderId", "id") ON DELETE CASCADE ON UPDATE CASCADE;
