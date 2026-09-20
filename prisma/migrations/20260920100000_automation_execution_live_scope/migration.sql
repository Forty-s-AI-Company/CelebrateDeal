ALTER TABLE "AutomationExecutionLog" ADD COLUMN "liveId" TEXT;

ALTER TABLE "AutomationExecutionLog"
  ADD CONSTRAINT "AutomationExecutionLog_vendorId_liveId_fkey"
  FOREIGN KEY ("vendorId", "liveId") REFERENCES "Live"("vendorId", "id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE INDEX "AutomationExecutionLog_vendorId_liveId_subjectType_trigger_idx"
  ON "AutomationExecutionLog"("vendorId", "liveId", "subjectType", "trigger");
