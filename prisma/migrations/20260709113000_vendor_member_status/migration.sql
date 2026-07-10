-- Add non-destructive member lifecycle fields for vendor account management.
ALTER TABLE "VendorMember" ADD COLUMN "status" TEXT NOT NULL DEFAULT 'active';
ALTER TABLE "VendorMember" ADD COLUMN "deactivatedAt" TIMESTAMP(3);
ALTER TABLE "VendorMember" ADD COLUMN "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

CREATE INDEX "VendorMember_vendorId_status_idx" ON "VendorMember"("vendorId", "status");
