-- G7-10: merchant product edits use optimistic concurrency and product slugs
-- are tenant-scoped instead of globally blocking another merchant.

ALTER TABLE "Product"
ADD COLUMN "revision" INTEGER NOT NULL DEFAULT 1,
ADD CONSTRAINT "Product_revision_check" CHECK ("revision" > 0);

DROP INDEX "Product_slug_key";
CREATE UNIQUE INDEX "Product_vendorId_slug_key" ON "Product"("vendorId", "slug");
