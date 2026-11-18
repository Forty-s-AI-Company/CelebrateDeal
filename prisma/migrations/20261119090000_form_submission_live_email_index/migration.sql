-- A2-01 (#651 re-review MINOR-A): the watch pass's "same person already ran"
-- check (rulesSamePersonRan in src/lib/watch-progress-automation.ts), run
-- once per dispatched event (at most 50 a round):
--   FormSubmission s2 JOIN RegistrationForm f2 ON f2.id = s2.formId AND f2.vendorId = $1
--   JOIN AutomationExecutionLog other ON other.vendorId = $1 AND other.eventId = $prefix || s2.id || ':' || $threshold
--   WHERE s2.liveId = $2 AND lower(btrim(s2.email)) = lower(btrim($3)) AND s2.id <> $4
--     AND other.ruleId = ANY($5)
-- It replaces a NOT EXISTS inside both watch scans that hashed every
-- FormSubmission row of the platform (Seq Scan, Parallel Seq Scan at
-- 625,000 rows). No index covered (liveId, lower(btrim(email))): the Q-12
-- index is VERIFIED-only and platform-wide by e-mail, and the liveId indexes
-- read every registrant of the Live. With this index the lookup reads the
-- person's own registrations of that Live (normally one or two rows), then
-- AutomationExecutionLog by its (vendorId, eventId) index.
--
-- Forward-only and additive: one partial expression b-tree index, no column,
-- constraint or data change. Not VERIFIED-only, so the check counts any
-- registration of the person as the old NOT EXISTS did; rows without a Live
-- are left out (the check always names one). Built without CONCURRENTLY like
-- every other migration (Prisma runs each migration in a transaction, where
-- CONCURRENTLY is not allowed): the build holds a SHARE lock on
-- "FormSubmission" (reads go on; new registrations and verifications wait)
-- for the build time, about 5.4 s per 520,000 rows on the synthetic set
-- (PostgreSQL 16 in Docker on a laptop, maintenance_work_mem 64MB; 25 MB).
-- lock_timeout 5s stops the migration instead of queueing behind a long
-- transaction and blocking registrations meanwhile.
DO $$
BEGIN
  PERFORM pg_catalog.set_config('lock_timeout', '5s', true);
END
$$;

CREATE INDEX "FormSubmission_live_email_normalized_idx"
  ON "FormSubmission" ("liveId", lower(btrim("email")))
  WHERE "liveId" IS NOT NULL;
