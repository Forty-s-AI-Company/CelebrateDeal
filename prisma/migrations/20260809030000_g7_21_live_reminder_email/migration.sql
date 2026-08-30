-- G7-21: independently bind and schedule a real live-reminder Email template.
ALTER TABLE "Live"
ADD COLUMN "liveReminderTemplateId" TEXT,
ADD COLUMN "liveReminderOffsetMinutes" INTEGER NOT NULL DEFAULT 60;

ALTER TABLE "Live" ADD CONSTRAINT "Live_liveReminderOffsetMinutes_check"
CHECK ("liveReminderOffsetMinutes" IN (15, 30, 60, 180, 1440));

ALTER TABLE "Live" ADD CONSTRAINT "Live_vendorId_liveReminderTemplateId_fkey"
FOREIGN KEY ("vendorId", "liveReminderTemplateId") REFERENCES "MessageTemplate"("vendorId", "id")
ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE INDEX "Live_vendorId_liveReminderTemplateId_idx"
ON "Live"("vendorId", "liveReminderTemplateId");
