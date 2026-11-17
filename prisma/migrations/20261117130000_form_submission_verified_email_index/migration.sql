-- Q-12 (#601 review follow-up): the verified-address lookup of a
-- consultation delayed step (hasVerifiedRegistration in
-- src/lib/automation-delayed-steps.ts):
--   FormSubmission f JOIN RegistrationForm rf ON rf.id = f.formId
--   WHERE rf.vendorId = $1 AND f.verificationStatus = 'VERIFIED'
--     AND lower(btrim(f.email)) = $2 LIMIT 1
-- No index covered lower(btrim(email)) (the pg_trgm GIN index on "email"
-- serves ILIKE search, not this expression), so for a vendor with many
-- registrations the planner scanned the whole FormSubmission table
-- (EXPLAIN on 20,000 synthetic rows: Seq Scan, 20,000 rows removed by
-- filter, ~17 ms; with this index: Bitmap Index Scan, ~0.08 ms).
--
-- Forward-only and additive: one partial expression b-tree index, no column,
-- constraint or data change. The predicate and expression match the query
-- exactly, so the planner can use it; only VERIFIED rows are indexed.
-- Built without CONCURRENTLY like every other migration (Prisma runs each
-- migration in a transaction, where CONCURRENTLY is not allowed): the build
-- holds a SHARE lock on "FormSubmission" (reads go on; new registrations and
-- verifications wait) for the build time, about 80 ms per 20,000 rows on the
-- synthetic set. lock_timeout 5s stops the migration instead of queueing
-- behind a long transaction and blocking registrations meanwhile.
DO $$
BEGIN
  PERFORM pg_catalog.set_config('lock_timeout', '5s', true);
END
$$;

CREATE INDEX "FormSubmission_verified_email_normalized_idx"
  ON "FormSubmission" (lower(btrim("email")))
  WHERE "verificationStatus" = 'VERIFIED';
