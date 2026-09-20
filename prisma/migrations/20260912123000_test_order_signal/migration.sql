-- Add a server-owned marker for completed non-charging checkout evidence.
-- Existing and production orders stay false; no historical data is rewritten.
ALTER TABLE "CommerceOrder" ADD COLUMN "isTestOrder" BOOLEAN NOT NULL DEFAULT false;
CREATE INDEX "CommerceOrder_vendorId_isTestOrder_status_createdAt_idx"
  ON "CommerceOrder"("vendorId", "isTestOrder", "status", "createdAt");
