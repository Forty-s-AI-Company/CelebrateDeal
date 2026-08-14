-- Additive media-asset metadata and optional references. Existing URL fields
-- remain untouched so rollout can proceed without backfilling application data.
CREATE TABLE "ImageAsset" (
    "id" TEXT NOT NULL,
    "vendorId" TEXT NOT NULL,
    "objectKey" TEXT NOT NULL,
    "originalFilename" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "publicUrl" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ImageAsset_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "Product" ADD COLUMN "imageAssetId" TEXT;
ALTER TABLE "Live" ADD COLUMN "heroImageAssetId" TEXT;
ALTER TABLE "Video" ADD COLUMN "thumbnailAssetId" TEXT;

CREATE UNIQUE INDEX "ImageAsset_objectKey_key" ON "ImageAsset"("objectKey");
CREATE UNIQUE INDEX "ImageAsset_vendorId_id_key" ON "ImageAsset"("vendorId", "id");
CREATE INDEX "ImageAsset_vendorId_status_createdAt_idx" ON "ImageAsset"("vendorId", "status", "createdAt");
CREATE INDEX "Product_imageAssetId_idx" ON "Product"("imageAssetId");
CREATE INDEX "Live_heroImageAssetId_idx" ON "Live"("heroImageAssetId");
CREATE INDEX "Video_thumbnailAssetId_idx" ON "Video"("thumbnailAssetId");

ALTER TABLE "ImageAsset" ADD CONSTRAINT "ImageAsset_vendorId_fkey"
  FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Product" ADD CONSTRAINT "Product_imageAssetId_fkey"
  FOREIGN KEY ("vendorId", "imageAssetId") REFERENCES "ImageAsset"("vendorId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Live" ADD CONSTRAINT "Live_heroImageAssetId_fkey"
  FOREIGN KEY ("vendorId", "heroImageAssetId") REFERENCES "ImageAsset"("vendorId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Video" ADD CONSTRAINT "Video_thumbnailAssetId_fkey"
  FOREIGN KEY ("vendorId", "thumbnailAssetId") REFERENCES "ImageAsset"("vendorId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
