-- F-3 Email 追銷序列 (docs/product/delayed-steps-design.md §3-§7).
--
-- EmailSequence / EmailSequenceStep hold a merchant's follow-up sequence for
-- one Live; DelayedStepRun is one verified registrant's progress through it.
-- The job (/api/jobs/email-deliveries -> processDueDelayedStepRuns) advances
-- each run one step at a time and queues an EmailDelivery per step.
--
-- Forward-only and additive: three new tables, plus the closed-beta grant
-- CHECK on "Vendor" rebuilt to also allow 'email_sequences'. The new CHECK is
-- a superset of the old one (20261021171100_vendor_beta_feature_grants), so
-- re-validating the existing rows cannot fail; "Vendor" is small, so the
-- validation scan under the ACCESS EXCLUSIVE lock is short. No existing row
-- changes, no grant is given to anyone.
DO $$
BEGIN
  PERFORM pg_catalog.set_config('lock_timeout', '5s', true);
END
$$;

-- Closed-beta module grant: add 'email_sequences' (src/lib/vendor-feature-toggles.ts).
ALTER TABLE "Vendor" DROP CONSTRAINT "Vendor_betaFeatureGrants_check";
ALTER TABLE "Vendor"
  ADD CONSTRAINT "Vendor_betaFeatureGrants_check" CHECK (
    "betaFeatureGrants" <@ ARRAY[
      'courses',
      'billing',
      'funnel_binding',
      'consultation_booking',
      'browser_live',
      'danmaku',
      'email_sequences'
    ]::TEXT[]
  );

-- CreateTable
CREATE TABLE "EmailSequence" (
    "id" TEXT NOT NULL,
    "vendorId" TEXT NOT NULL,
    "liveId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "activatedAt" TIMESTAMP(3),
    "stopOnPurchase" BOOLEAN NOT NULL DEFAULT true,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EmailSequence_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "EmailSequence_status_check" CHECK ("status" IN ('draft', 'active', 'paused')),
    -- An active sequence always knows from when registrations join it.
    CONSTRAINT "EmailSequence_activation_check" CHECK ("status" <> 'active' OR "activatedAt" IS NOT NULL),
    CONSTRAINT "EmailSequence_name_check" CHECK (char_length("name") BETWEEN 1 AND 120),
    CONSTRAINT "EmailSequence_version_check" CHECK ("version" >= 1)
);

-- CreateTable
CREATE TABLE "EmailSequenceStep" (
    "id" TEXT NOT NULL,
    "vendorId" TEXT NOT NULL,
    "emailSequenceId" TEXT NOT NULL,
    "delayMinutes" INTEGER NOT NULL,
    "messageTemplateId" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EmailSequenceStep_pkey" PRIMARY KEY ("id"),
    -- 1 hour to 90 days after the anchor (SEQUENCE_STEP_MIN/MAX_DELAY_MINUTES).
    CONSTRAINT "EmailSequenceStep_delayMinutes_check" CHECK ("delayMinutes" BETWEEN 60 AND 129600)
);

-- CreateTable
CREATE TABLE "DelayedStepRun" (
    "id" TEXT NOT NULL,
    "vendorId" TEXT NOT NULL,
    "emailSequenceId" TEXT,
    "formSubmissionId" TEXT,
    "subjectKeyHash" TEXT NOT NULL,
    "recipientHash" TEXT,
    "anchorAt" TIMESTAMP(3) NOT NULL,
    "cursorDelayMinutes" INTEGER NOT NULL DEFAULT -1,
    "nextRunAt" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'active',
    "cancelReason" TEXT,
    "claimedAt" TIMESTAMP(3),
    "attemptCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DelayedStepRun_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "DelayedStepRun_status_check" CHECK ("status" IN ('active', 'completed', 'cancelled')),
    -- Only an active run waits for a next step; a finished one is never picked up.
    CONSTRAINT "DelayedStepRun_nextRunAt_check" CHECK (("status" = 'active') = ("nextRunAt" IS NOT NULL)),
    CONSTRAINT "DelayedStepRun_cancelReason_check" CHECK (
      ("status" = 'cancelled') = ("cancelReason" IS NOT NULL)
      AND ("cancelReason" IS NULL OR "cancelReason" IN (
        'unsubscribed', 'blacklisted', 'purchased', 'definition_paused',
        'definition_deleted', 'subject_gone', 'failed'
      ))
    ),
    CONSTRAINT "DelayedStepRun_counters_check" CHECK ("cursorDelayMinutes" >= -1 AND "attemptCount" >= 0),
    -- PR 1 only has e-mail sequences. F-4 replaces this with "exactly one of
    -- emailSequenceId / automationRuleId" when it adds the second column.
    CONSTRAINT "DelayedStepRun_definition_check" CHECK ("emailSequenceId" IS NOT NULL)
);

-- CreateIndex
CREATE INDEX "EmailSequence_vendorId_liveId_status_idx" ON "EmailSequence"("vendorId", "liveId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "EmailSequence_vendorId_id_key" ON "EmailSequence"("vendorId", "id");

-- CreateIndex
CREATE INDEX "EmailSequenceStep_vendorId_messageTemplateId_idx" ON "EmailSequenceStep"("vendorId", "messageTemplateId");

-- CreateIndex
CREATE UNIQUE INDEX "EmailSequenceStep_vendorId_id_key" ON "EmailSequenceStep"("vendorId", "id");

-- CreateIndex
-- A delay value identifies a step within its sequence.
CREATE UNIQUE INDEX "EmailSequenceStep_vendorId_emailSequenceId_delayMinutes_key" ON "EmailSequenceStep"("vendorId", "emailSequenceId", "delayMinutes");

-- CreateIndex
-- Job: due active runs, oldest first.
CREATE INDEX "DelayedStepRun_status_nextRunAt_idx" ON "DelayedStepRun"("status", "nextRunAt");

-- CreateIndex
CREATE INDEX "DelayedStepRun_formSubmissionId_idx" ON "DelayedStepRun"("formSubmissionId");

-- CreateIndex
-- Unsubscribe: cancel one recipient's active runs of this vendor.
CREATE INDEX "DelayedStepRun_vendorId_recipientHash_status_idx" ON "DelayedStepRun"("vendorId", "recipientHash", "status");

-- CreateIndex
CREATE UNIQUE INDEX "DelayedStepRun_vendorId_id_key" ON "DelayedStepRun"("vendorId", "id");

-- CreateIndex
-- One run per registration and sequence: a repeated verification or the
-- backfill sweep racing the verify route only hits this key.
CREATE UNIQUE INDEX "DelayedStepRun_vendorId_emailSequenceId_formSubmissionId_key" ON "DelayedStepRun"("vendorId", "emailSequenceId", "formSubmissionId");

-- AddForeignKey
ALTER TABLE "EmailSequence" ADD CONSTRAINT "EmailSequence_vendorId_liveId_fkey" FOREIGN KEY ("vendorId", "liveId") REFERENCES "Live"("vendorId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
-- Direct vendor cascade (like LiveNotificationRule): deleting a vendor removes
-- its steps before the RESTRICT on the step's template is checked.
ALTER TABLE "EmailSequenceStep" ADD CONSTRAINT "EmailSequenceStep_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmailSequenceStep" ADD CONSTRAINT "EmailSequenceStep_vendorId_emailSequenceId_fkey" FOREIGN KEY ("vendorId", "emailSequenceId") REFERENCES "EmailSequence"("vendorId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
-- A step can only name a template of the same vendor; a template in use cannot be deleted.
ALTER TABLE "EmailSequenceStep" ADD CONSTRAINT "EmailSequenceStep_vendorId_messageTemplateId_fkey" FOREIGN KEY ("vendorId", "messageTemplateId") REFERENCES "MessageTemplate"("vendorId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DelayedStepRun" ADD CONSTRAINT "DelayedStepRun_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DelayedStepRun" ADD CONSTRAINT "DelayedStepRun_vendorId_emailSequenceId_fkey" FOREIGN KEY ("vendorId", "emailSequenceId") REFERENCES "EmailSequence"("vendorId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
-- FormSubmission has no vendorId (DB-I10); every query binds the registration
-- through form.vendorId instead. Deleting the registration deletes its runs.
ALTER TABLE "DelayedStepRun" ADD CONSTRAINT "DelayedStepRun_formSubmissionId_fkey" FOREIGN KEY ("formSubmissionId") REFERENCES "FormSubmission"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Same defense in depth as every other public table (20261020090000).
ALTER TABLE "EmailSequence" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "EmailSequenceStep" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "DelayedStepRun" ENABLE ROW LEVEL SECURITY;
