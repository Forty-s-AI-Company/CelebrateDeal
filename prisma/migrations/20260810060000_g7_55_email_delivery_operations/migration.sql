-- Preserve manual retry history without changing the immutable payload or
-- provider idempotency key, and support tenant-scoped merchant filtering.
ALTER TABLE "EmailDelivery"
  ADD COLUMN "manualRetryCount" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "lastManualRetryAt" TIMESTAMP(3);

CREATE INDEX "EmailDelivery_vendorId_status_createdAt_idx"
  ON "EmailDelivery"("vendorId", "status", "createdAt");

CREATE INDEX "EmailDelivery_vendorId_trigger_createdAt_idx"
  ON "EmailDelivery"("vendorId", "trigger", "createdAt");
