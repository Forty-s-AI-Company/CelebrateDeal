-- Waiting room media (owner 2026-11-27): a Live can name one pre-recorded
-- video that plays muted and looped behind the waiting room before the start.
--
--   * "Live"."waitingVideoId": nullable, no default. Existing rows stay NULL
--     (no waiting video), so nothing changes for any existing Live.
--   * "Live_vendorId_waitingVideoId_fkey": composite ("vendorId",
--     "waitingVideoId") -> "Video"("vendorId", "id") (the existing unique key
--     "Video_vendorId_id_key"), so the database refuses a video of another
--     vendor. ON DELETE NO ACTION (checked at the end of the statement):
--     deleting a bound video is refused (the application never hard-deletes a
--     video; it archives), while a Vendor delete still cascades to both
--     tables in the same statement. SET NULL is not used: on a composite key it
--     would also null the NOT NULL "vendorId"; CASCADE would delete the Live.
--   * "Live_waitingVideoId_idx": serves the NO ACTION check when a video row
--     is deleted, without scanning "Live".
--
-- Locks (within lock_timeout 5s, held until this file commits):
--   * ADD COLUMN takes ACCESS EXCLUSIVE on "Live" (catalog-only: a nullable
--     column without a default rewrites nothing). Reads and writes of "Live"
--     wait from here to the commit.
--   * CREATE INDEX and the foreign key validation each scan "Live" once; every
--     value is NULL, so both are proportional only to the number of Live rows
--     (one row per live room, a small table).
--   * ADD FOREIGN KEY also takes SHARE ROW EXCLUSIVE on "Video" until the
--     commit: video writes wait, video reads do not.
--
-- Forward-only and additive: one nullable column, one index, one foreign key;
-- no existing row changes.
DO $$
BEGIN
  PERFORM pg_catalog.set_config('lock_timeout', '5s', true);
END
$$;

-- AlterTable
ALTER TABLE "Live" ADD COLUMN "waitingVideoId" TEXT;

-- CreateIndex
CREATE INDEX "Live_waitingVideoId_idx" ON "Live"("waitingVideoId");

-- AddForeignKey
ALTER TABLE "Live" ADD CONSTRAINT "Live_vendorId_waitingVideoId_fkey" FOREIGN KEY ("vendorId", "waitingVideoId") REFERENCES "Video"("vendorId", "id") ON DELETE NO ACTION ON UPDATE CASCADE;
