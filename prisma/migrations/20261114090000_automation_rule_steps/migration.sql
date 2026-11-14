-- F-4 PR 2: delayed steps for automation rules
-- (docs/product/delayed-steps-design.md §3 and §8).
--
-- AutomationRuleStep holds a rule's delayed steps; DelayedStepRun, the shared
-- progress table of F-3, gets the columns an automation run needs. Existing
-- e-mail sequence runs keep every value: the three new columns are NULL for
-- them and nothing is backfilled.
--
-- Forward-only, in two migrations because Prisma runs each file as one
-- transaction:
--   1. this file adds the table, the columns, the indexes, the foreign keys and
--      the new CHECK constraints NOT VALID (no scan of existing rows; new
--      writes are checked at once);
--   2. 20261114090100_automation_rule_steps_validate validates them under
--      SHARE UPDATE EXCLUSIVE and only then drops the F-3 CHECK
--      "emailSequenceId IS NOT NULL".
-- Between the two, both CHECKs apply, so no automation run can be written
-- before 2 is applied (the code that writes them is deployed after both).
--
-- Locks (all within lock_timeout 5s, held until this file commits):
--   * ACCESS EXCLUSIVE on "DelayedStepRun" (ADD COLUMN, ADD CONSTRAINT);
--     metadata only, the table is not rewritten. The three indexes are built
--     inside the same lock; the table is small during the closed beta.
--   * SHARE ROW EXCLUSIVE on "AutomationRule", "AutomationExecutionLog" and
--     "ConsultationBooking" for the new foreign keys: their writes wait until
--     this file commits, reads do not. "Vendor" is not touched.
DO $$
BEGIN
  PERFORM pg_catalog.set_config('lock_timeout', '5s', true);
END
$$;

-- CreateTable
CREATE TABLE "AutomationRuleStep" (
    "id" TEXT NOT NULL,
    "vendorId" TEXT NOT NULL,
    "ruleId" TEXT NOT NULL,
    "delayMinutes" INTEGER NOT NULL,
    "condition" JSONB NOT NULL,
    "actions" JSONB NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AutomationRuleStep_pkey" PRIMARY KEY ("id"),
    -- 1 hour to 90 days after the event (AUTOMATION_STEP_MIN/MAX_DELAY_MINUTES,
    -- the same range as an e-mail sequence step).
    CONSTRAINT "AutomationRuleStep_delayMinutes_check" CHECK ("delayMinutes" BETWEEN 60 AND 129600),
    -- Same shape as AutomationRule.condition / actions (parseAutomationRule:
    -- one condition object, 1 to 10 actions). CASE keeps jsonb_array_length
    -- away from a non-array value.
    CONSTRAINT "AutomationRuleStep_condition_check" CHECK (jsonb_typeof("condition") = 'object'),
    CONSTRAINT "AutomationRuleStep_actions_check" CHECK (
      CASE WHEN jsonb_typeof("actions") = 'array' THEN jsonb_array_length("actions") BETWEEN 1 AND 10 ELSE false END
    )
);

-- CreateIndex
CREATE UNIQUE INDEX "AutomationRuleStep_vendorId_id_key" ON "AutomationRuleStep"("vendorId", "id");

-- CreateIndex
-- A delay value identifies a step within its rule.
CREATE UNIQUE INDEX "AutomationRuleStep_vendorId_ruleId_delayMinutes_key" ON "AutomationRuleStep"("vendorId", "ruleId", "delayMinutes");

-- AddForeignKey
-- A step belongs to a rule of the same vendor; deleting the rule deletes its
-- steps (a rule can only be deleted while it has no execution log, so no run
-- can point at it then; see deleteAutomationRuleAction).
ALTER TABLE "AutomationRuleStep" ADD CONSTRAINT "AutomationRuleStep_vendorId_ruleId_fkey" FOREIGN KEY ("vendorId", "ruleId") REFERENCES "AutomationRule"("vendorId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AlterTable
ALTER TABLE "DelayedStepRun" ADD COLUMN     "automationRuleId" TEXT,
ADD COLUMN     "consultationBookingId" TEXT,
ADD COLUMN     "sourceExecutionLogId" TEXT;

-- CreateIndex
-- One run per rule and triggering event: a replayed event (or the immediate
-- execution being reclaimed) only meets this key. Sequence runs have NULL in
-- both columns, which a unique index never restricts, and automation runs have
-- NULL in emailSequenceId, so neither key of F-3 restricts them.
CREATE UNIQUE INDEX "DelayedStepRun_vendorId_automationRuleId_sourceExecutionLog_key" ON "DelayedStepRun"("vendorId", "automationRuleId", "sourceExecutionLogId");

-- CreateIndex
-- Foreign-key lookups of the cascades below (the rule's is the unique key above).
CREATE INDEX "DelayedStepRun_vendorId_sourceExecutionLogId_idx" ON "DelayedStepRun"("vendorId", "sourceExecutionLogId");

-- CreateIndex
CREATE INDEX "DelayedStepRun_vendorId_consultationBookingId_idx" ON "DelayedStepRun"("vendorId", "consultationBookingId");

-- AddForeignKey
-- Composite with vendorId: a run can only name a rule, an execution log or a
-- booking of its own vendor. NOT VALID here, validated in the next migration
-- (every existing row has NULL in these columns).
ALTER TABLE "DelayedStepRun" ADD CONSTRAINT "DelayedStepRun_vendorId_automationRuleId_fkey" FOREIGN KEY ("vendorId", "automationRuleId") REFERENCES "AutomationRule"("vendorId", "id") ON DELETE CASCADE ON UPDATE CASCADE NOT VALID;

-- AddForeignKey
ALTER TABLE "DelayedStepRun" ADD CONSTRAINT "DelayedStepRun_vendorId_sourceExecutionLogId_fkey" FOREIGN KEY ("vendorId", "sourceExecutionLogId") REFERENCES "AutomationExecutionLog"("vendorId", "id") ON DELETE CASCADE ON UPDATE CASCADE NOT VALID;

-- AddForeignKey
-- Deleting the booking removes the run, like deleting a registration does.
ALTER TABLE "DelayedStepRun" ADD CONSTRAINT "DelayedStepRun_vendorId_consultationBookingId_fkey" FOREIGN KEY ("vendorId", "consultationBookingId") REFERENCES "ConsultationBooking"("vendorId", "id") ON DELETE CASCADE ON UPDATE CASCADE NOT VALID;

-- Replaces "DelayedStepRun_definition_check" (emailSequenceId IS NOT NULL),
-- which the next migration drops after validating this one.
ALTER TABLE "DelayedStepRun" ADD CONSTRAINT "DelayedStepRun_definition_exactly_one_check"
  CHECK (num_nonnulls("emailSequenceId", "automationRuleId") = 1) NOT VALID;

-- An automation run always knows its triggering execution, the customer key
-- its tags use, and exactly one subject to re-read the recipient from; only an
-- automation run names a booking.
ALTER TABLE "DelayedStepRun" ADD CONSTRAINT "DelayedStepRun_automation_reference_check"
  CHECK (
    (("automationRuleId" IS NULL) = ("sourceExecutionLogId" IS NULL))
    AND ("automationRuleId" IS NULL OR ("subjectKeyHash" IS NOT NULL AND num_nonnulls("formSubmissionId", "consultationBookingId") = 1))
    AND ("consultationBookingId" IS NULL OR "automationRuleId" IS NOT NULL)
  ) NOT VALID;

-- Same defense in depth as every other public table (20261020090000).
ALTER TABLE "AutomationRuleStep" ENABLE ROW LEVEL SECURITY;
