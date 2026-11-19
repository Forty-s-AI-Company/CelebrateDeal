-- A2-08: a merchant save holds the automation rule row FOR UPDATE (step
-- editor, switch on/off, delete, funnel editor; each inside a Prisma
-- transaction with a 15 s timeout). A request-path event (registration,
-- consultation booking or no-show, an order's first paid transition) inserts
-- its execution log, whose foreign key to the rule waits for that lock, so the
-- request could be held for up to 15 s.
--
-- The request path now waits at most 2 s for the rule row (lock_timeout in the
-- claim's own short transaction). When it gives up, it records the rule and
-- the event's subject here and goes on; the e-mail job dispatches the rule
-- later through the same dispatchAutomationEvent, and the execution log's
-- unique (vendorId, idempotencyKey) keeps it to one execution.
--
-- No foreign key to "AutomationRule" on purpose: this insert must not wait on
-- the very row that is held. The job reads the rule bound to the vendor; a
-- rule deleted or switched off meanwhile settles the row without running.
-- References only (rule, trigger, subject id), never an address.
--
-- Forward-only and additive: one new table, no existing row changes.
DO $$
BEGIN
  PERFORM pg_catalog.set_config('lock_timeout', '5s', true);
END
$$;

-- CreateTable
CREATE TABLE "AutomationDeferredDispatch" (
    "id" TEXT NOT NULL,
    "vendorId" TEXT NOT NULL,
    "ruleId" TEXT NOT NULL,
    "trigger" TEXT NOT NULL,
    "subjectId" TEXT NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    -- When the job may take the row next: now on insert, pushed back after a
    -- failed attempt (1, 2, 5, 10, then every 30 minutes; #671 review MINOR-5).
    "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AutomationDeferredDispatch_pkey" PRIMARY KEY ("id"),
    -- The request-path triggers whose event the job can rebuild from server records.
    CONSTRAINT "AutomationDeferredDispatch_trigger_check" CHECK ("trigger" IN ('form_registered', 'consultation_booked', 'consultation_no_show', 'payment_paid')),
    -- The 48-hour window with that back-off allows about 100 failed attempts;
    -- the CHECK only bounds a runaway writer.
    CONSTRAINT "AutomationDeferredDispatch_attempts_check" CHECK ("attempts" BETWEEN 0 AND 1000)
);

-- CreateIndex
-- One row per rule and event: a second deferral of the same event is a no-op.
-- It also serves the vendor foreign key (leading column).
CREATE UNIQUE INDEX "AutomationDeferredDispatch_vendorId_ruleId_trigger_subjectI_key" ON "AutomationDeferredDispatch"("vendorId", "ruleId", "trigger", "subjectId");

-- CreateIndex
-- The expiry sweep (48-hour window).
CREATE INDEX "AutomationDeferredDispatch_createdAt_idx" ON "AutomationDeferredDispatch"("createdAt");

-- CreateIndex
-- The job's scan of rows due now.
CREATE INDEX "AutomationDeferredDispatch_nextAttemptAt_idx" ON "AutomationDeferredDispatch"("nextAttemptAt");

-- AddForeignKey
ALTER TABLE "AutomationDeferredDispatch" ADD CONSTRAINT "AutomationDeferredDispatch_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Same defense in depth as every other public table (20261020090000).
ALTER TABLE "AutomationDeferredDispatch" ENABLE ROW LEVEL SECURITY;
