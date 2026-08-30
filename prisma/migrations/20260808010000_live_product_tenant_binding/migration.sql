-- Refuse to backfill if legacy parents are missing or belong to different vendors.
DO $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM "LiveProduct" AS lp
        LEFT JOIN "Live" AS l ON l."id" = lp."liveId"
        LEFT JOIN "Product" AS p ON p."id" = lp."productId"
        WHERE l."id" IS NULL
           OR p."id" IS NULL
           OR l."vendorId" <> p."vendorId"
    ) THEN
        RAISE EXCEPTION 'LiveProduct tenant preflight failed: missing parent or cross-tenant legacy row';
    END IF;
END $$;

-- Use the live parent as the authoritative tenant for existing rows.
ALTER TABLE "LiveProduct" ADD COLUMN "vendorId" TEXT;

UPDATE "LiveProduct" AS lp
SET "vendorId" = l."vendorId"
FROM "Live" AS l
WHERE l."id" = lp."liveId";

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM "LiveProduct" WHERE "vendorId" IS NULL) THEN
        RAISE EXCEPTION 'LiveProduct tenant backfill failed: vendorId is NULL';
    END IF;
END $$;

ALTER TABLE "LiveProduct" ALTER COLUMN "vendorId" SET NOT NULL;

ALTER TABLE "LiveProduct" DROP CONSTRAINT "LiveProduct_liveId_fkey";
ALTER TABLE "LiveProduct" DROP CONSTRAINT "LiveProduct_productId_fkey";
DROP INDEX "LiveProduct_liveId_productId_key";

ALTER TABLE "LiveProduct"
    ADD CONSTRAINT "LiveProduct_vendorId_fkey"
    FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "LiveProduct"
    ADD CONSTRAINT "LiveProduct_vendorId_liveId_fkey"
    FOREIGN KEY ("vendorId", "liveId") REFERENCES "Live"("vendorId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "LiveProduct"
    ADD CONSTRAINT "LiveProduct_vendorId_productId_fkey"
    FOREIGN KEY ("vendorId", "productId") REFERENCES "Product"("vendorId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE UNIQUE INDEX "LiveProduct_vendorId_liveId_productId_key"
    ON "LiveProduct"("vendorId", "liveId", "productId");

CREATE INDEX "LiveProduct_vendorId_liveId_sortOrder_idx"
    ON "LiveProduct"("vendorId", "liveId", "sortOrder");
