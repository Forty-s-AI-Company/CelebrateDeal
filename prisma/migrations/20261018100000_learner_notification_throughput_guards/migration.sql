-- Forward-only learner notification throughput and abuse guards. Existing rows keep
-- their data: sources start with zero failures, legacy challenges have no rate key.

-- A failing source backs off and is dead-lettered after five failures so one
-- poison source cannot block other sources or tenants.
ALTER TABLE "LearnerNotificationSourceEvent"
 ADD COLUMN "failureCount" INTEGER NOT NULL DEFAULT 0,
 ADD COLUMN "nextAttemptAt" TIMESTAMP(3),
 ADD COLUMN "lastErrorCode" TEXT,
 ADD COLUMN "deadLetteredAt" TIMESTAMP(3),
 ADD CONSTRAINT "LearnerSourceEvent_failure_check" CHECK (
  "failureCount" BETWEEN 0 AND 5
  AND ("lastErrorCode" IS NULL OR "lastErrorCode" ~ '^[A-Z_]{1,80}$')
  AND ("deadLetteredAt" IS NULL OR ("failureCount" = 5 AND "nextAttemptAt" IS NULL))
 );

-- Daily verification caps: per learner (via preference) and per destination.
-- The rate key is a tenant-scoped HMAC of the normalized contact, never plaintext.
ALTER TABLE "LearnerNotificationVerification"
 ADD COLUMN "destinationRateKeyHash" TEXT,
 ADD CONSTRAINT "LearnerVerification_rate_key_check" CHECK ("destinationRateKeyHash" IS NULL OR "destinationRateKeyHash" ~ '^[a-f0-9]{64}$');
CREATE INDEX "LearnerNotificationVerification_learner_window_idx" ON "LearnerNotificationVerification"("vendorId","preferenceId","createdAt");
CREATE INDEX "LearnerNotificationVerification_destination_window_idx" ON "LearnerNotificationVerification"("vendorId","destinationRateKeyHash","createdAt");

-- Vendor-fair delivery selection reads each tenant's due queue separately.
CREATE INDEX "LearnerNotificationDelivery_vendor_due_idx" ON "LearnerNotificationDelivery"("vendorId","status","nextAttemptAt");
-- RLS, grants and tenant composite FKs remain enforced by the original forward migrations.
