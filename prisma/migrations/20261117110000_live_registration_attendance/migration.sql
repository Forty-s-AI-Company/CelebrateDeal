-- Q-11 `form_no_show` (src/lib/live-registration-attendance.ts).
--
-- Nothing recorded which registrant actually watched a Live: admission
-- (/api/live-admission) only keeps an anonymous viewer session row, and the
-- stream usage ledger carries no registrant. The no-show automation needs to
-- tell "registered and watched" from "registered and never came", so when a
-- request is admitted to play a Live and carries the signed registration
-- cookie of a VERIFIED registration of that Live, the server records when that
-- registration was first and last admitted. One row per registration.
--
-- Forward-only and additive: one new table, no existing row changes.
DO $$
BEGIN
  PERFORM pg_catalog.set_config('lock_timeout', '5s', true);
END
$$;

-- CreateTable
CREATE TABLE "LiveRegistrationAttendance" (
    "id" TEXT NOT NULL,
    "vendorId" TEXT NOT NULL,
    "liveId" TEXT NOT NULL,
    "formSubmissionId" TEXT NOT NULL,
    "firstAdmittedAt" TIMESTAMP(3) NOT NULL,
    "lastAdmittedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LiveRegistrationAttendance_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
-- One row per registration (the admission upsert's conflict target); the
-- no-show job looks a registration up by (vendorId, formSubmissionId).
CREATE UNIQUE INDEX "LiveRegistrationAttendance_vendorId_formSubmissionId_key" ON "LiveRegistrationAttendance"("vendorId", "formSubmissionId");

-- CreateIndex
-- Covers the (liveId, formSubmissionId) foreign key for registration and Live deletes.
CREATE INDEX "LiveRegistrationAttendance_liveId_formSubmissionId_idx" ON "LiveRegistrationAttendance"("liveId", "formSubmissionId");

-- AddForeignKey
ALTER TABLE "LiveRegistrationAttendance" ADD CONSTRAINT "LiveRegistrationAttendance_vendorId_liveId_fkey" FOREIGN KEY ("vendorId", "liveId") REFERENCES "Live"("vendorId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
-- The registration's own (liveId, id) key: a row can only name a registration of this Live.
ALTER TABLE "LiveRegistrationAttendance" ADD CONSTRAINT "LiveRegistrationAttendance_liveId_formSubmissionId_fkey" FOREIGN KEY ("liveId", "formSubmissionId") REFERENCES "FormSubmission"("liveId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Same defense in depth as every other public table (20261020090000).
ALTER TABLE "LiveRegistrationAttendance" ENABLE ROW LEVEL SECURITY;
