-- Q-09: validate what 20261117170000_delayed_step_run_commerce_order added
-- NOT VALID, then drop the F-4 subject CHECK it replaces and give the new
-- CHECK the old name, so "DelayedStepRun_automation_reference_check" keeps
-- naming the automation-run rule.
--
-- Prisma runs each migration file as one transaction, so the validation lives
-- in its own file. Each VALIDATE holds SHARE UPDATE EXCLUSIVE on
-- "DelayedStepRun" (reads and writes continue) and, for the foreign key, ROW
-- SHARE on "CommerceOrder" (checkout and payment writes continue). Every
-- pre-existing row is an e-mail sequence run or an automation run of a
-- registration or a booking (the F-4 CHECK guaranteed exactly one of those)
-- with NULL in the new column, so each validation passes. A row that does not
-- would fail this migration and roll it back; the constraints then stay NOT
-- VALID and keep checking new writes.
--
-- The DROP and the RENAME come last: they need ACCESS EXCLUSIVE on
-- "DelayedStepRun", held only from the DROP to the commit right after the
-- RENAME. No row changes.
DO $$
BEGIN
  PERFORM pg_catalog.set_config('lock_timeout', '5s', true);
END
$$;

ALTER TABLE "DelayedStepRun" VALIDATE CONSTRAINT "DelayedStepRun_vendorId_commerceOrderId_fkey";
ALTER TABLE "DelayedStepRun" VALIDATE CONSTRAINT "DelayedStepRun_automation_subject_check";

-- The new CHECK (validated above) includes the old rule for every existing
-- run: a registration or a booking is still exactly one subject.
ALTER TABLE "DelayedStepRun" DROP CONSTRAINT "DelayedStepRun_automation_reference_check";
ALTER TABLE "DelayedStepRun" RENAME CONSTRAINT "DelayedStepRun_automation_subject_check" TO "DelayedStepRun_automation_reference_check";
