-- CreateTable
CREATE TABLE "LineRichMenu" (
    "id" TEXT NOT NULL,
    "vendorId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "providerRichMenuId" TEXT,
    "templateType" TEXT NOT NULL,
    "chatBarText" TEXT NOT NULL,
    "areas" JSONB NOT NULL,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "syncedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LineRichMenu_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "LineRichMenu_vendorId_id_key" ON "LineRichMenu"("vendorId", "id");
CREATE INDEX "LineRichMenu_vendorId_status_updatedAt_idx" ON "LineRichMenu"("vendorId", "status", "updatedAt");
CREATE INDEX "LineRichMenu_vendorId_isDefault_idx" ON "LineRichMenu"("vendorId", "isDefault");

ALTER TABLE "LineRichMenu" ADD CONSTRAINT "LineRichMenu_vendorId_fkey"
FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE CASCADE ON UPDATE CASCADE;
