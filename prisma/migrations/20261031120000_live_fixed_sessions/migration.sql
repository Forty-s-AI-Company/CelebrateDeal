-- 指定場次 (fixed sessions) for one Live (src/lib/live-fixed-sessions.ts).
--
-- A Live in "fixed_sessions" mode lists explicit LiveSession starts; a
-- registrant picks one and FormSubmission.liveSessionId records it. Every
-- downstream timing (confirmation, reminders, viewer page, admission, replay)
-- then follows that session's startAt instead of the shared scheduledAt.
--
-- Forward-only and additive: three Live columns with defaults that keep every
-- existing Live in "single" mode, one nullable FormSubmission column and one
-- new table. No existing row changes meaning.
DO $$
BEGIN
  PERFORM pg_catalog.set_config('lock_timeout', '5s', true);
END
$$;

-- AlterTable
ALTER TABLE "FormSubmission" ADD COLUMN     "liveSessionId" TEXT,
ADD COLUMN     "liveSessionSeatReleasedAt" TIMESTAMP(3);

-- A seat can only be released for a registration that held one.
ALTER TABLE "FormSubmission" ADD CONSTRAINT "FormSubmission_liveSessionSeatReleasedAt_check"
    CHECK ("liveSessionSeatReleasedAt" IS NULL OR "liveSessionId" IS NOT NULL);

-- AlterTable
ALTER TABLE "Live" ADD COLUMN     "sessionMode" TEXT NOT NULL DEFAULT 'single',
ADD COLUMN     "sessionRegistrationCutoffMinutes" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "sessionReplayWindowHours" INTEGER;

ALTER TABLE "Live" ADD CONSTRAINT "Live_sessionMode_check"
    CHECK ("sessionMode" IN ('single', 'fixed_sessions'));
ALTER TABLE "Live" ADD CONSTRAINT "Live_sessionRegistrationCutoffMinutes_check"
    CHECK ("sessionRegistrationCutoffMinutes" BETWEEN 0 AND 1440);
ALTER TABLE "Live" ADD CONSTRAINT "Live_sessionReplayWindowHours_check"
    CHECK ("sessionReplayWindowHours" IS NULL OR "sessionReplayWindowHours" BETWEEN 1 AND 8760);

-- CreateTable
CREATE TABLE "LiveSession" (
    "id" TEXT NOT NULL,
    "vendorId" TEXT NOT NULL,
    "liveId" TEXT NOT NULL,
    "startAt" TIMESTAMP(3) NOT NULL,
    "capacity" INTEGER,
    "registeredCount" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'open',
    "cancelledAt" TIMESTAMP(3),
    "cancellationNoticesQueuedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LiveSession_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "LiveSession_status_check" CHECK ("status" IN ('open', 'closed', 'cancelled')),
    -- cancelledAt is set exactly while the session is cancelled.
    CONSTRAINT "LiveSession_cancelledAt_check" CHECK (("status" = 'cancelled') = ("cancelledAt" IS NOT NULL)),
    CONSTRAINT "LiveSession_cancellationNoticesQueuedAt_check"
        CHECK ("cancellationNoticesQueuedAt" IS NULL OR "cancelledAt" IS NOT NULL),
    -- null = unlimited seats.
    CONSTRAINT "LiveSession_capacity_check" CHECK ("capacity" IS NULL OR "capacity" BETWEEN 1 AND 100000),
    -- The seat ledger can never go negative or past the capacity: the
    -- registration path increments it in one conditional UPDATE, and this
    -- CHECK is the last line against oversubscription.
    CONSTRAINT "LiveSession_registeredCount_check"
        CHECK ("registeredCount" >= 0 AND ("capacity" IS NULL OR "registeredCount" <= "capacity"))
);

-- CreateIndex
CREATE UNIQUE INDEX "LiveSession_vendorId_id_key" ON "LiveSession"("vendorId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "LiveSession_liveId_id_key" ON "LiveSession"("liveId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "LiveSession_vendorId_liveId_startAt_key" ON "LiveSession"("vendorId", "liveId", "startAt");

-- CreateIndex
CREATE INDEX "FormSubmission_liveId_liveSessionId_idx" ON "FormSubmission"("liveId", "liveSessionId");

-- CreateIndex
-- Seat release sweep: unverified registrations still holding a seat whose
-- verification window passed (rows without a session sort last and are skipped).
CREATE INDEX "FormSubmission_verificationStatus_liveSessionSeatReleasedAt_idx" ON "FormSubmission"("verificationStatus", "liveSessionSeatReleasedAt", "liveSessionId", "verificationExpiresAt");

-- AddForeignKey
-- NO ACTION (checked at the end of the statement) rather than RESTRICT: when
-- a Live is deleted, FormSubmission.liveId is set to NULL by its own FK in the
-- same statement, so the session rows can cascade away without orphaning a
-- reference. A session with registrations is otherwise never deleted.
ALTER TABLE "FormSubmission" ADD CONSTRAINT "FormSubmission_liveId_liveSessionId_fkey" FOREIGN KEY ("liveId", "liveSessionId") REFERENCES "LiveSession"("liveId", "id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "LiveSession" ADD CONSTRAINT "LiveSession_vendorId_liveId_fkey" FOREIGN KEY ("vendorId", "liveId") REFERENCES "Live"("vendorId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Same defense in depth as every other public table (20261020090000).
ALTER TABLE "LiveSession" ENABLE ROW LEVEL SECURITY;
