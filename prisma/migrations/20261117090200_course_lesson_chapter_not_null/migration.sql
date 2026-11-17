-- Q-14 (3/3): "CourseLesson"."chapterId" NOT NULL.
--
-- SET NOT NULL needs ACCESS EXCLUSIVE on "CourseLesson", but does not scan the
-- table: PostgreSQL (12+) uses the CHECK ("chapterId" IS NOT NULL) validated by
-- 20261117090100 as the proof. The CHECK is then redundant and dropped; the
-- column constraint replaces it. Both statements change catalog rows only, so
-- the lock is held for milliseconds, after waiting at most 5s for it.
-- No row changes. Forward-only: there is no down migration, and making the
-- column nullable again would be a new migration.
DO $$
BEGIN
  PERFORM pg_catalog.set_config('lock_timeout', '5s', true);
END
$$;

ALTER TABLE "CourseLesson" ALTER COLUMN "chapterId" SET NOT NULL;
ALTER TABLE "CourseLesson" DROP CONSTRAINT "CourseLesson_chapterId_not_null_check";
