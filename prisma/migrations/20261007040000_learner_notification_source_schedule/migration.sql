-- Separate creation/consent cutoff from delivery scheduling. Preserve existing sources.
ALTER TABLE "LearnerNotificationSourceEvent" ADD COLUMN "availableAt" TIMESTAMP(3);
UPDATE "LearnerNotificationSourceEvent" SET "availableAt" = "occurredAt" WHERE "availableAt" IS NULL;
ALTER TABLE "LearnerNotificationSourceEvent" ALTER COLUMN "availableAt" SET NOT NULL;
ALTER TABLE "LearnerNotificationSourceEvent" ALTER COLUMN "availableAt" SET DEFAULT CURRENT_TIMESTAMP;
CREATE INDEX "LearnerNotificationSourceEvent_schedule_idx" ON "LearnerNotificationSourceEvent"("vendorId","completedAt","availableAt","id");
