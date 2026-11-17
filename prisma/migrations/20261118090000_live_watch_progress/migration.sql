-- Q-11 `viewer_watch_progress` (src/lib/live-watch-progress.ts).
--
-- Nothing recorded how much of a Live a registrant watched:
-- LiveRegistrationAttendance (20261117110000) only keeps the first and last
-- admission of a registration (refreshed at most every 5 minutes), and the
-- stream usage ledger carries no registrant and takes the seconds the browser
-- reports. The watch-progress automation needs a number the browser cannot
-- inflate, so the server counts it: while a VERIFIED registration of this Live
-- is admitted with its own session playing (not the replay), each admission
-- renewal adds the wall-clock time since the previous credit (at most once a
-- minute, and nothing across a gap of more than two minutes). One row per
-- registration.
--
-- Forward-only and additive: one new table, no existing row changes.
DO $$
BEGIN
  PERFORM pg_catalog.set_config('lock_timeout', '5s', true);
END
$$;

-- CreateTable
CREATE TABLE "LiveWatchProgress" (
    "id" TEXT NOT NULL,
    "vendorId" TEXT NOT NULL,
    "liveId" TEXT NOT NULL,
    "formSubmissionId" TEXT NOT NULL,
    "watchedSeconds" INTEGER NOT NULL DEFAULT 0,
    "firstCreditedAt" TIMESTAMP(3) NOT NULL,
    "lastCreditedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LiveWatchProgress_pkey" PRIMARY KEY ("id"),
    -- LIVE_WATCH_PROGRESS_MAX_SECONDS (30 days): the writer never goes past it.
    CONSTRAINT "LiveWatchProgress_watchedSeconds_check" CHECK ("watchedSeconds" BETWEEN 0 AND 2592000),
    CONSTRAINT "LiveWatchProgress_credit_order_check" CHECK ("lastCreditedAt" >= "firstCreditedAt")
);

-- CreateIndex
-- One row per registration (the credit upsert's conflict target).
CREATE UNIQUE INDEX "LiveWatchProgress_vendorId_formSubmissionId_key" ON "LiveWatchProgress"("vendorId", "formSubmissionId");

-- CreateIndex
-- Covers the (liveId, formSubmissionId) foreign key for registration and Live deletes.
CREATE INDEX "LiveWatchProgress_liveId_formSubmissionId_idx" ON "LiveWatchProgress"("liveId", "formSubmissionId");

-- CreateIndex
-- The automation pass reads one vendor's rows credited in its look-back window.
CREATE INDEX "LiveWatchProgress_vendorId_lastCreditedAt_idx" ON "LiveWatchProgress"("vendorId", "lastCreditedAt");

-- AddForeignKey
ALTER TABLE "LiveWatchProgress" ADD CONSTRAINT "LiveWatchProgress_vendorId_liveId_fkey" FOREIGN KEY ("vendorId", "liveId") REFERENCES "Live"("vendorId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
-- The registration's own (liveId, id) key: a row can only name a registration of this Live.
ALTER TABLE "LiveWatchProgress" ADD CONSTRAINT "LiveWatchProgress_liveId_formSubmissionId_fkey" FOREIGN KEY ("liveId", "formSubmissionId") REFERENCES "FormSubmission"("liveId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Same defense in depth as every other public table (20261020090000).
ALTER TABLE "LiveWatchProgress" ENABLE ROW LEVEL SECURITY;
