-- Q-14 (1/3): repair every CourseLesson chapter link, then forbid new NULLs.
--
-- F-5 (20261113120100_course_lesson_chapter_link) left "chapterId" nullable
-- while code older than F-5 could still write lessons. This migration does in
-- SQL what repairCourseChapterLinks (src/lib/course-chapter-repair.ts) does, so
-- a database that still has unlinked or stale-linked lessons is repaired by
-- `prisma migrate deploy` alone:
--
-- * A lesson belongs to the chapter titled lessonChapterTitle(chapterTitle):
--   chapterTitle trimmed like JavaScript's String.prototype.trim (the pattern
--   below is COURSE_CHAPTER_TRIM_PATTERN), or '未分類章節' when that is empty.
-- * A link is kept when it points to a chapter of the same vendor and course
--   with exactly that title (trustedChapterLink). Every other lesson is
--   "to repair": chapterId NULL, a chapter of another course (impossible under
--   the composite foreign key, handled anyway), or a chapter whose title is not
--   the lesson's.
-- * For each course, the titles of the lessons to repair that no chapter of
--   the course carries yet get a new chapter, appended after the course's
--   current maximum position (0 when it has none), in the order of each
--   title's first lesson to repair (position, then id). That is the order in
--   which repairCourseChapterLinks calls findOrCreateChapter (max + 1 each).
-- * Each lesson to repair is linked to its title's chapter and gets a new
--   "updatedAt" (Prisma's updateMany sets it in the TypeScript repair).
--   "chapterTitle", positions, publishedAt, progress and every other column
--   are not changed, so learners see the same chapters in the same order.
-- * New chapter ids are 'chp_' || 32 random hex digits (the TypeScript repair
--   uses random cuids), so a rerun can never collide with an earlier id.
--
-- The repair block can be rerun at any time: with nothing to repair it changes
-- no row. src/lib/course-lesson-chapter-not-null-migration.db.test.ts reads
-- the block between the BEGIN/END markers from this file and compares it with
-- repairCourseChapterLinks, so keep it one DO statement.
--
-- After the repair, a fail-closed check (both read-only checks of
-- docs/codex-goal/PRISMA_INVARIANTS.md must be 0) and
-- CHECK ("chapterId" IS NOT NULL) NOT VALID: no new NULL can be written from
-- here on. 20261117090100 validates it without blocking writes and
-- 20261117090200 sets NOT NULL (no table scan: the validated CHECK proves it)
-- and drops the CHECK. Prisma runs each migration file as one transaction,
-- which is why these are three files.
--
-- Locks. Like F-5, "CourseLesson" is locked ACCESS EXCLUSIVE before anything
-- else and held to the commit, so no lesson is written or read between the
-- repair and the check, and the lock never has to be upgraded for the ADD
-- CONSTRAINT. "Vendor" and "Product" are not locked as tables: inserting a
-- chapter only takes FOR KEY SHARE on its vendor and product rows, which does
-- not wait for a curriculum edit's FOR NO KEY UPDATE on the product revision.
-- "CourseChapter" is not locked as a table either. A curriculum edit that has
-- already inserted a chapter (uncommitted) and then waits for "CourseLesson"
-- can deadlock with this repair only if the repair inserts the same title or
-- position in the same course at that moment; PostgreSQL then aborts one of
-- the two. Every lock waits at most 5s. On any failure nothing is applied: run
-- `prisma migrate resolve --rolled-back 20261117090000_course_lesson_chapter_repair`
-- and `migrate deploy` again. Every new chapter title passes
-- CourseChapter_title_bounds: CourseLesson_title_bounds keeps chapterTitle at
-- 1-120 characters after btrim, and the JavaScript trim removes at least as
-- much, so the result has no edge spaces and is at most 120 characters.
DO $$
BEGIN
  PERFORM pg_catalog.set_config('lock_timeout', '5s', true);
END
$$;

LOCK TABLE "CourseLesson" IN ACCESS EXCLUSIVE MODE;

-- The trim pattern relies on backslash escapes reaching the regular
-- expression engine (standard_conforming_strings = on) and on \uXXXX naming
-- Unicode code points (a UTF8 database). Refuse to run otherwise.
DO $course_lesson_chapter_repair_settings$
BEGIN
  IF current_setting('standard_conforming_strings') <> 'on' OR current_setting('server_encoding') <> 'UTF8' THEN
    RAISE EXCEPTION 'course lesson chapter repair needs standard_conforming_strings = on and a UTF8 database (got %, %)',
      current_setting('standard_conforming_strings'), current_setting('server_encoding');
  END IF;
END
$course_lesson_chapter_repair_settings$;

-- BEGIN course_lesson_chapter_repair
DO $course_lesson_chapter_repair$
BEGIN
  WITH "lessonTitle" AS (
    SELECT
      lesson."id",
      lesson."vendorId",
      lesson."productId",
      lesson."position",
      linked."title" AS "linkedTitle",
      COALESCE(NULLIF(regexp_replace(lesson."chapterTitle", '^[ \t\n\v\f\r\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff]+|[ \t\n\v\f\r\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff]+$', '', 'g'), ''), '未分類章節') AS "title"
    FROM "CourseLesson" AS lesson
    LEFT JOIN "CourseChapter" AS linked
      ON linked."id" = lesson."chapterId"
      AND linked."vendorId" = lesson."vendorId"
      AND linked."productId" = lesson."productId"
  ),
  "newChapter" AS (
    SELECT
      t."vendorId",
      t."productId",
      t."title",
      min(t."position") AS "firstPosition",
      (array_agg(t."id" ORDER BY t."position", t."id"))[1] AS "firstLessonId"
    FROM "lessonTitle" AS t
    WHERE t."linkedTitle" IS DISTINCT FROM t."title"
      AND NOT EXISTS (
        SELECT 1 FROM "CourseChapter" AS existing
        WHERE existing."vendorId" = t."vendorId" AND existing."productId" = t."productId" AND existing."title" = t."title"
      )
    GROUP BY t."vendorId", t."productId", t."title"
  )
  INSERT INTO "CourseChapter" ("id", "vendorId", "productId", "title", "position", "createdAt", "updatedAt")
  SELECT
    'chp_' || replace(gen_random_uuid()::text, '-', ''),
    c."vendorId",
    c."productId",
    c."title",
    COALESCE((
      SELECT max(existing."position") + 1 FROM "CourseChapter" AS existing
      WHERE existing."vendorId" = c."vendorId" AND existing."productId" = c."productId"
    ), 0) + (row_number() OVER (PARTITION BY c."vendorId", c."productId" ORDER BY c."firstPosition", c."firstLessonId") - 1),
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
  FROM "newChapter" AS c;

  -- A lesson is relinked only when its link is not already its title's
  -- chapter; a correct link is never rewritten.
  UPDATE "CourseLesson" AS lesson
  SET "chapterId" = chapter."id", "updatedAt" = CURRENT_TIMESTAMP
  FROM "CourseChapter" AS chapter
  WHERE chapter."vendorId" = lesson."vendorId"
    AND chapter."productId" = lesson."productId"
    AND chapter."title" = COALESCE(NULLIF(regexp_replace(lesson."chapterTitle", '^[ \t\n\v\f\r\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff]+|[ \t\n\v\f\r\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff]+$', '', 'g'), ''), '未分類章節')
    AND lesson."chapterId" IS DISTINCT FROM chapter."id";
END
$course_lesson_chapter_repair$;
-- END course_lesson_chapter_repair

-- Fail closed: both read-only checks must be 0 (the same queries as
-- UNLINKED_COURSE_LESSONS_SQL and STALE_COURSE_LESSON_LINKS_SQL).
DO $course_lesson_chapter_repair_check$
DECLARE
  unlinked bigint;
  stale bigint;
BEGIN
  SELECT count(*) INTO unlinked FROM "CourseLesson" WHERE "chapterId" IS NULL;
  SELECT count(*) INTO stale FROM "CourseLesson" AS lesson JOIN "CourseChapter" AS chapter ON chapter."id" = lesson."chapterId" WHERE chapter."title" <> COALESCE(NULLIF(regexp_replace(lesson."chapterTitle", '^[ \t\n\v\f\r\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff]+|[ \t\n\v\f\r\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff]+$', '', 'g'), ''), '未分類章節');
  IF unlinked > 0 OR stale > 0 THEN
    RAISE EXCEPTION 'course lesson chapter repair left % unlinked and % stale-linked lesson(s)', unlinked, stale;
  END IF;
END
$course_lesson_chapter_repair_check$;

-- No new NULL from here on. NOT VALID: no scan now (the check above already
-- proved every row under the lock); 20261117090100 validates it.
ALTER TABLE "CourseLesson" ADD CONSTRAINT "CourseLesson_chapterId_not_null_check" CHECK ("chapterId" IS NOT NULL) NOT VALID;
