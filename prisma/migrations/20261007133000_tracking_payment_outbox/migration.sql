-- A forward-only, tenant-bound durable outbox, committed alongside payment.
CREATE TABLE "TrackingDelivery" (
  "id" TEXT NOT NULL,
  "vendorId" TEXT NOT NULL,
  "orderId" TEXT NOT NULL,
  "eventId" TEXT NOT NULL,
  "credentialRevision" INTEGER NOT NULL,
  "pixelId" TEXT NOT NULL,
  "testEventCode" TEXT,
  "status" TEXT NOT NULL DEFAULT 'queued',
  "attemptCount" INTEGER NOT NULL DEFAULT 0,
  "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "leaseToken" TEXT,
  "leaseExpiresAt" TIMESTAMP(3),
  "acceptedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "TrackingDelivery_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "TrackingDelivery_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "TrackingDelivery_vendorId_orderId_fkey" FOREIGN KEY ("vendorId", "orderId") REFERENCES "CommerceOrder"("vendorId", "id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "TrackingDelivery_attempt_bounds" CHECK ("attemptCount" BETWEEN 0 AND 8),
  CONSTRAINT "TrackingDelivery_revision_nonnegative" CHECK ("credentialRevision" >= 0),
  CONSTRAINT "TrackingDelivery_status_values" CHECK ("status" IN ('queued','processing','accepted','rejected','cancelled')),
  CONSTRAINT "TrackingDelivery_lease_state" CHECK (("status" = 'processing' AND "leaseToken" IS NOT NULL AND "leaseExpiresAt" IS NOT NULL) OR ("status" <> 'processing' AND "leaseToken" IS NULL AND "leaseExpiresAt" IS NULL))
);
CREATE UNIQUE INDEX "TrackingDelivery_vendorId_eventId_key" ON "TrackingDelivery"("vendorId", "eventId");
CREATE INDEX "TrackingDelivery_status_nextAttemptAt_idx" ON "TrackingDelivery"("status", "nextAttemptAt");
CREATE INDEX "TrackingDelivery_vendorId_orderId_idx" ON "TrackingDelivery"("vendorId", "orderId");
