-- A3-02: validate the composite foreign key that
-- 20261119150000_live_studio_draft_live_vendor_fk added NOT VALID, then drop
-- the single-column "LiveStudioDraft_liveId_fkey" it replaces.
--
-- Existing rows first: a draft whose "liveId" names another vendor's live
-- stops this migration with a count only (no ids, no payload). The whole file
-- rolls back, the new key stays NOT VALID and keeps checking new writes, and
-- the old key stays in place; such rows need a deliberate decision before this
-- migration is retried. The write paths never created one, so none is
-- expected.
--
-- Locks (within lock_timeout 5s):
--   * the check reads both tables (ACCESS SHARE); VALIDATE holds SHARE UPDATE
--     EXCLUSIVE on "LiveStudioDraft" and ROW SHARE on "Live": reads and writes
--     of both continue during the scan of the (small) draft table;
--   * the DROP comes last and takes ACCESS EXCLUSIVE on "LiveStudioDraft" and
--     on "Live" (it removes the key's triggers on both), held only from the
--     DROP to the commit right after it. Catalog-only, no row changes.
DO $$
BEGIN
  PERFORM pg_catalog.set_config('lock_timeout', '5s', true);
END
$$;

DO $$
DECLARE
  foreign_drafts bigint;
BEGIN
  SELECT count(*) INTO foreign_drafts
  FROM "LiveStudioDraft" AS d
  WHERE d."liveId" IS NOT NULL
    AND NOT EXISTS (
      SELECT 1 FROM "Live" AS l WHERE l."id" = d."liveId" AND l."vendorId" = d."vendorId"
    );
  IF foreign_drafts > 0 THEN
    RAISE EXCEPTION 'A3-02: % LiveStudioDraft row(s) name a live of another vendor; resolve them before validating "LiveStudioDraft_vendorId_liveId_fkey"', foreign_drafts;
  END IF;
END
$$;

ALTER TABLE "LiveStudioDraft" VALIDATE CONSTRAINT "LiveStudioDraft_vendorId_liveId_fkey";

ALTER TABLE "LiveStudioDraft" DROP CONSTRAINT "LiveStudioDraft_liveId_fkey";
