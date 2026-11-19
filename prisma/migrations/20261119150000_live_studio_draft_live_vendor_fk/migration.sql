-- A3-02: bind a Live Studio draft's live to the draft's own vendor.
--
-- "LiveStudioDraft_liveId_fkey" referenced "Live"("id") alone, so the database
-- would accept a draft of vendor A that names vendor B's live. The write paths
-- (POST /api/live-studio/drafts, upsertLiveAction) already look the live up by
-- vendorId, so this was not reachable; the composite foreign key adds the
-- database-level guarantee (defence in depth, TENANT_ACTION_MATRIX §觀察).
--
-- Forward-only, in two migrations because Prisma runs each file as one
-- transaction (the same pattern as 20261117170000 / 20261117170100):
--   1. this file adds the composite foreign key NOT VALID (no scan of existing
--      rows; every new or changed row is checked at once);
--   2. 20261119150100_live_studio_draft_live_vendor_fk_validate checks the
--      existing rows, validates the key under SHARE UPDATE EXCLUSIVE and then
--      drops the single-column key it replaces.
-- Between the two, both keys apply. Deleting a live sets "liveId" to NULL
-- through either key, so the old behaviour is unchanged.
--
-- ON DELETE SET NULL ("liveId") clears only "liveId" (PostgreSQL 15+); a
-- plain SET NULL on a composite key would also null the NOT NULL "vendorId"
-- and make every live deletion with a draft fail. schema.prisma declares the
-- relation as onDelete: SetNull; Prisma reads the action, not the column list.
--
-- Locks (within lock_timeout 5s, held until this file commits): SHARE ROW
-- EXCLUSIVE on "LiveStudioDraft" and on "Live". Catalog-only, nothing is
-- scanned, so the lock lasts milliseconds; live writes wait for it, reads do
-- not. "LiveStudioDraft" is a small table (at most one draft per vendor and
-- live, plus unbound drafts that expire).
DO $$
BEGIN
  PERFORM pg_catalog.set_config('lock_timeout', '5s', true);
END
$$;

-- AddForeignKey
-- The unique index "LiveStudioDraft_vendorId_liveId_key" serves the lookups of
-- this key; "Live_vendorId_id_key" is the referenced unique key.
--
-- The column list of SET NULL is PostgreSQL 15+ syntax. On an older server a
-- plain statement would fail while parsing with a bare syntax error, so the
-- statement runs through EXECUTE behind an explicit version check: an older
-- server stops here with a readable message and nothing changes (the file is
-- one transaction). See docs/operations/prisma-migration-guards-runbook.md §8.
DO $$
DECLARE
  server_version integer := current_setting('server_version_num')::integer;
BEGIN
  IF server_version < 150000 THEN
    RAISE EXCEPTION 'A3-02 needs PostgreSQL 15+ for ON DELETE SET NULL ("liveId"); this server is %', current_setting('server_version');
  END IF;
  EXECUTE 'ALTER TABLE "LiveStudioDraft" ADD CONSTRAINT "LiveStudioDraft_vendorId_liveId_fkey" FOREIGN KEY ("vendorId", "liveId") REFERENCES "Live"("vendorId", "id") ON DELETE SET NULL ("liveId") ON UPDATE CASCADE NOT VALID';
END
$$;
