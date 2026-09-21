ALTER TABLE "Product" ADD COLUMN "upsellProductId" TEXT;
ALTER TABLE "Product" ADD COLUMN "upsellDiscountCents" INTEGER;
ALTER TABLE "Product" ADD COLUMN "downsellProductId" TEXT;

CREATE INDEX "Product_vendorId_upsellProductId_idx" ON "Product"("vendorId", "upsellProductId");
CREATE INDEX "Product_vendorId_downsellProductId_idx" ON "Product"("vendorId", "downsellProductId");

ALTER TABLE "Product" ADD CONSTRAINT "Product_vendorId_upsellProductId_fkey"
  FOREIGN KEY ("vendorId", "upsellProductId") REFERENCES "Product"("vendorId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Product" ADD CONSTRAINT "Product_vendorId_downsellProductId_fkey"
  FOREIGN KEY ("vendorId", "downsellProductId") REFERENCES "Product"("vendorId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
