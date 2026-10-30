-- B-3 (GO-NO-GO §5): per-recipient lookups for live notification
-- materialization (src/lib/live-notification-delivery.ts).
--
-- ensureLiveNotificationDelivery checks for an already sent row and
-- supersedes stale rows of one recipient and rule:
--   "vendorId" = $1 AND "sourceLiveId" = $2 AND "sourceFormSubmissionId" = $3
--   AND "idempotencyKey" LIKE 'live-notification/<trigger>/<rule>/%'
-- The LIKE prefix cannot use the ("vendorId", "idempotencyKey") unique index
-- under the database's non-C collation, so without this index each call
-- scanned the vendor's whole EmailDelivery history.
--
-- Forward-only and additive: one plain b-tree index, no column, constraint
-- or data change. Built without CONCURRENTLY like the other migrations; the
-- table is small before launch.
DO $$
BEGIN
  PERFORM pg_catalog.set_config('lock_timeout', '5s', true);
END
$$;

CREATE INDEX "EmailDelivery_vendorId_sourceFormSubmissionId_idx" ON "EmailDelivery"("vendorId", "sourceFormSubmissionId");
