-- F-4 PR 2: validate what 20261114090000_automation_rule_steps added NOT VALID,
-- then drop the F-3 CHECK it replaces.
--
-- Prisma runs each migration file as one transaction, so the validation lives
-- in its own file. Each VALIDATE holds SHARE UPDATE EXCLUSIVE on
-- "DelayedStepRun" (reads and writes continue) and, for a foreign key, ROW
-- SHARE on the referenced table. Every pre-existing row is an e-mail sequence
-- run (the F-3 CHECK guaranteed emailSequenceId IS NOT NULL) with NULL in the
-- three new columns, so each validation passes. A row that does not would fail
-- this migration and roll it back; the constraints then stay NOT VALID and
-- keep checking new writes.
--
-- The DROP comes last: it needs ACCESS EXCLUSIVE on "DelayedStepRun", held
-- only from that statement to the commit right after it. No row changes.
DO $$
BEGIN
  PERFORM pg_catalog.set_config('lock_timeout', '5s', true);
END
$$;

ALTER TABLE "DelayedStepRun" VALIDATE CONSTRAINT "DelayedStepRun_vendorId_automationRuleId_fkey";
ALTER TABLE "DelayedStepRun" VALIDATE CONSTRAINT "DelayedStepRun_vendorId_sourceExecutionLogId_fkey";
ALTER TABLE "DelayedStepRun" VALIDATE CONSTRAINT "DelayedStepRun_vendorId_consultationBookingId_fkey";
ALTER TABLE "DelayedStepRun" VALIDATE CONSTRAINT "DelayedStepRun_definition_exactly_one_check";
ALTER TABLE "DelayedStepRun" VALIDATE CONSTRAINT "DelayedStepRun_automation_reference_check";

-- "Exactly one of emailSequenceId / automationRuleId" (validated above)
-- includes the old rule for every e-mail sequence run.
ALTER TABLE "DelayedStepRun" DROP CONSTRAINT "DelayedStepRun_definition_check";
