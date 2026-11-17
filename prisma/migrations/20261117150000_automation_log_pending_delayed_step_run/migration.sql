-- Q-13 (#601 review follow-up): a rule's delayed-step run is created after
-- the event's immediate actions, in a transaction that waits at most 2 s for
-- the rule row (FOR SHARE, lock_timeout 2s in startDelayedSteps,
-- src/lib/automation-workflow.ts). A merchant save holding the row FOR UPDATE
-- longer than that left the event without a run and nothing created it later.
--
-- The execution log now records the run it still owes: the event's subject
-- (registration or booking id, never an address) is written together with the
-- log's completion and cleared once the run exists or is known not to be
-- needed. The e-mail job (startPendingAutomationRuns) creates the runs still
-- owed, anchored at the log's createdAt, idempotent on the existing unique
-- (vendorId, automationRuleId, sourceExecutionLogId).
--
-- Forward-only and additive: one nullable column (no default, so a metadata
-- change, no table rewrite) and one partial b-tree index over the few rows
-- that owe a run. Existing rows stay NULL; nothing is backfilled, so logs
-- written before this migration are never picked up.
-- Built without CONCURRENTLY like every other migration (Prisma runs each
-- migration in a transaction): the index build holds a SHARE lock on
-- "AutomationExecutionLog" (reads go on, new execution logs wait) for one
-- scan of the table. lock_timeout 5s stops the migration instead of queueing
-- behind a long transaction and holding automation events meanwhile.
DO $$
BEGIN
  PERFORM pg_catalog.set_config('lock_timeout', '5s', true);
END
$$;

ALTER TABLE "AutomationExecutionLog" ADD COLUMN "delayedStepsPendingSubjectId" TEXT;

CREATE INDEX "AutomationExecutionLog_delayed_steps_pending_idx"
  ON "AutomationExecutionLog" ("completedAt")
  WHERE "delayedStepsPendingSubjectId" IS NOT NULL;
