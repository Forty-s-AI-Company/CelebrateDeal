-- G7-23: durable cursor jobs for reconciling existing verified live reminders.
CREATE TABLE "LiveReminderReconciliationJob" (
    "id" TEXT NOT NULL,
    "vendorId" TEXT NOT NULL,
    "liveId" TEXT NOT NULL,
    "liveStatus" TEXT NOT NULL,
    "configDigest" TEXT NOT NULL,
    "templateId" TEXT,
    "templateRevision" TEXT,
    "scheduledAt" TIMESTAMP(3) NOT NULL,
    "reminderOffsetMinutes" INTEGER NOT NULL,
    "lifecycle" TEXT NOT NULL DEFAULT 'pending',
    "cursorCreatedAt" TIMESTAMP(3),
    "cursorId" TEXT,
    "scannedCount" INTEGER NOT NULL DEFAULT 0,
    "scheduledCount" INTEGER NOT NULL DEFAULT 0,
    "supersededCount" INTEGER NOT NULL DEFAULT 0,
    "claimedAt" TIMESTAMP(3),
    "attemptCount" INTEGER NOT NULL DEFAULT 0,
    "maxAttempts" INTEGER NOT NULL DEFAULT 5,
    "nextAttemptAt" TIMESTAMP(3),
    "lastErrorCode" TEXT,
    "completedAt" TIMESTAMP(3),
    "supersededAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LiveReminderReconciliationJob_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "LiveReminderReconciliationJob_lifecycle_check" CHECK ("lifecycle" IN ('pending', 'processing', 'completed', 'superseded', 'failed')),
    CONSTRAINT "LiveReminderReconciliationJob_reminderOffsetMinutes_check" CHECK ("reminderOffsetMinutes" IN (15, 30, 60, 180, 1440)),
    CONSTRAINT "LiveReminderReconciliationJob_attemptCount_check" CHECK ("attemptCount" >= 0 AND "maxAttempts" > 0 AND "attemptCount" <= "maxAttempts"),
    CONSTRAINT "LiveReminderReconciliationJob_cursor_check" CHECK (("cursorCreatedAt" IS NULL) = ("cursorId" IS NULL))
);

CREATE UNIQUE INDEX "LiveReminderReconciliationJob_vendorId_liveId_configDigest_key"
ON "LiveReminderReconciliationJob"("vendorId", "liveId", "configDigest");

CREATE INDEX "LiveReminderReconciliationJob_lifecycle_nextAttemptAt_idx"
ON "LiveReminderReconciliationJob"("lifecycle", "nextAttemptAt");

CREATE INDEX "LiveReminderReconciliationJob_vendorId_liveId_lifecycle_createdAt_idx"
ON "LiveReminderReconciliationJob"("vendorId", "liveId", "lifecycle", "createdAt");

ALTER TABLE "LiveReminderReconciliationJob"
ADD CONSTRAINT "LiveReminderReconciliationJob_vendorId_fkey"
FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "LiveReminderReconciliationJob"
ADD CONSTRAINT "LiveReminderReconciliationJob_vendorId_liveId_fkey"
FOREIGN KEY ("vendorId", "liveId") REFERENCES "Live"("vendorId", "id") ON DELETE CASCADE ON UPDATE CASCADE;
