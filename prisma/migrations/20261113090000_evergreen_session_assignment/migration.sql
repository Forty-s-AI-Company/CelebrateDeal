-- 常青場 per-viewer post-live follow-up (src/lib/evergreen-session-assignment.ts).
--
-- An evergreen visitor's session lives only in a signed httpOnly cookie. When
-- a VERIFIED registrant (signed registration cookie) is assigned a session on
-- the viewer page, or verifies after being assigned one, the server records
-- that session start here, one row per registration. The post-live follow-up
-- job then sends each registrant's email after their own session ends.
--
-- Forward-only and additive: one new table, no existing row changes.
DO $$
BEGIN
  PERFORM pg_catalog.set_config('lock_timeout', '5s', true);
END
$$;

-- CreateTable
CREATE TABLE "EvergreenSessionAssignment" (
    "id" TEXT NOT NULL,
    "vendorId" TEXT NOT NULL,
    "liveId" TEXT NOT NULL,
    "formSubmissionId" TEXT NOT NULL,
    "sessionStartAt" TIMESTAMP(3) NOT NULL,
    "scheduleFingerprint" TEXT NOT NULL,
    "assignedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EvergreenSessionAssignment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
-- Follow-up job: one Live's assignments whose session start is in the due window.
CREATE INDEX "EvergreenSessionAssignment_vendorId_liveId_sessionStartAt_idx" ON "EvergreenSessionAssignment"("vendorId", "liveId", "sessionStartAt");

-- CreateIndex
-- One row per registration; a rejoin updates it in place.
CREATE UNIQUE INDEX "EvergreenSessionAssignment_vendorId_formSubmissionId_key" ON "EvergreenSessionAssignment"("vendorId", "formSubmissionId");

-- AddForeignKey
ALTER TABLE "EvergreenSessionAssignment" ADD CONSTRAINT "EvergreenSessionAssignment_vendorId_liveId_fkey" FOREIGN KEY ("vendorId", "liveId") REFERENCES "Live"("vendorId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
-- The registration's own (liveId, id) key: a row can only name a registration of this Live.
ALTER TABLE "EvergreenSessionAssignment" ADD CONSTRAINT "EvergreenSessionAssignment_liveId_formSubmissionId_fkey" FOREIGN KEY ("liveId", "formSubmissionId") REFERENCES "FormSubmission"("liveId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Same defense in depth as every other public table (20261020090000).
ALTER TABLE "EvergreenSessionAssignment" ENABLE ROW LEVEL SECURITY;
