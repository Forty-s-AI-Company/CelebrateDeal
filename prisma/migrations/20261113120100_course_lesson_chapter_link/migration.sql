-- F-5 (2/2): link every lesson to its chapter.
--
-- Adds "CourseLesson"."chapterId", backfills "CourseChapter" rows from the
-- free-text "chapterTitle" (table created by 20261113120000_course_chapter),
-- checks that every lesson is linked, then adds the index and the foreign key.
-- Forward-only and additive: one nullable column, one index, one foreign key
-- and a backfill. "chapterTitle" is kept and still written (with the chapter
-- title); no row is deleted and no existing value changes.
--
-- "chapterId" stays nullable here. While this release rolls out, code older
-- than F-5 can still insert or edit lessons without a chapterId (or change
-- chapterTitle and leave a stale chapterId). Every reader decides membership by
-- the title (lessonChapterTitle in src/lib/course-learning.ts), so those rows
-- still show correctly. Before a later migration adds NOT NULL, run
-- repairCourseChapterLinks (scripts/repair-course-chapter-links.ts) until both
-- read-only checks in docs/codex-goal/PRISMA_INVARIANTS.md return 0.
--
-- Locks. Only "CourseLesson" is locked explicitly, ACCESS EXCLUSIVE, before
-- anything else, so no lesson can be written between the backfill and the
-- check at the end. "Vendor" and "Product" are not locked as tables: inserting
-- chapters only checks their rows with FOR KEY SHARE. Against saveCourseLesson
-- (old code: UPDATE "Product" SET revision, then read and write
-- "CourseLesson"):
--   * If it runs first, it holds a FOR NO KEY UPDATE row lock on the product
--     (revision is not a key column) and the table locks on "CourseLesson";
--     LOCK TABLE waits for it to commit. The migration holds nothing yet.
--   * If the migration runs first, it waits at "CourseLesson" (ACCESS SHARE
--     conflicts with ACCESS EXCLUSIVE) while holding its product row lock. The
--     backfill's FOR KEY SHARE on that product row does not conflict with FOR
--     NO KEY UPDATE, so the migration never waits for it: no cycle.
--   "CourseChapter" is new and only F-5 code writes it; migrate deploy runs
--   both F-5 migrations before that code is deployed.
-- A transaction that locks a "Vendor" or "Product" row FOR UPDATE (a delete)
-- and then touches "CourseLesson" can still deadlock with the backfill;
-- PostgreSQL aborts one of the two. Every lock waits at most 5s and this is one
-- transaction: on any failure nothing is applied. Run
-- `prisma migrate resolve --rolled-back 20261113120100_course_lesson_chapter_link`
-- and `migrate deploy` again.
SET LOCAL lock_timeout = '5s';
LOCK TABLE "CourseLesson" IN ACCESS EXCLUSIVE MODE;

ALTER TABLE "CourseLesson" ADD COLUMN "chapterId" TEXT;

-- Backfill. src/lib/course-chapter-backfill.db.test.ts reads this exact block
-- from this file and reruns it, so keep it one DO statement between the
-- BEGIN/END markers.
--
-- * One chapter per (vendor, course, trimmed chapterTitle): lessons that share
--   a title share a chapter even when they are not adjacent, which is what the
--   player showed before (it grouped by the trimmed title).
-- * "Trimmed" is JavaScript's String.prototype.trim (all Unicode white space,
--   e.g. U+3000), which the player used, not btrim (spaces only). A title that
--   is empty after trimming became "未分類章節" in the player and does here.
-- * position: the course's chapters ordered by their first lesson (any lesson,
--   published or not), numbered from 0 (after any chapter that already exists).
-- * id: 'chp_' || md5(vendor, course, title, first lesson id) is deterministic,
--   so rerunning the block after clearing the rows gives the same ids. The first
--   lesson id keeps it from colliding with a chapter that was later renamed
--   away from the same title.
-- * Only lessons without a chapterId are touched; "chapterTitle" is not changed.
-- The trim pattern below relies on backslash escapes reaching the regular
-- expression engine (standard_conforming_strings = on) and on \uXXXX naming
-- Unicode code points (a UTF8 database). Refuse to run otherwise.
DO $course_chapter_backfill_settings$
BEGIN
  IF current_setting('standard_conforming_strings') <> 'on' OR current_setting('server_encoding') <> 'UTF8' THEN
    RAISE EXCEPTION 'course chapter backfill needs standard_conforming_strings = on and a UTF8 database (got %, %)',
      current_setting('standard_conforming_strings'), current_setting('server_encoding');
  END IF;
END
$course_chapter_backfill_settings$;

-- BEGIN course_chapter_backfill
DO $course_chapter_backfill$
BEGIN
  WITH "lessonTitle" AS (
    SELECT
      lesson."id",
      lesson."vendorId",
      lesson."productId",
      lesson."position",
      COALESCE(NULLIF(regexp_replace(lesson."chapterTitle", '^[ \t\n\v\f\r\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff]+|[ \t\n\v\f\r\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff]+$', '', 'g'), ''), '未分類章節') AS "title"
    FROM "CourseLesson" AS lesson
    WHERE lesson."chapterId" IS NULL
  ),
  "newChapter" AS (
    SELECT
      t."vendorId",
      t."productId",
      t."title",
      min(t."position") AS "firstPosition",
      (array_agg(t."id" ORDER BY t."position", t."id"))[1] AS "firstLessonId"
    FROM "lessonTitle" AS t
    WHERE NOT EXISTS (
      SELECT 1 FROM "CourseChapter" AS existing
      WHERE existing."vendorId" = t."vendorId" AND existing."productId" = t."productId" AND existing."title" = t."title"
    )
    GROUP BY t."vendorId", t."productId", t."title"
  )
  INSERT INTO "CourseChapter" ("id", "vendorId", "productId", "title", "position", "createdAt", "updatedAt")
  SELECT
    'chp_' || md5(c."vendorId" || ':' || c."productId" || ':' || c."title" || ':' || c."firstLessonId"),
    c."vendorId",
    c."productId",
    c."title",
    COALESCE((
      SELECT max(existing."position") + 1 FROM "CourseChapter" AS existing
      WHERE existing."vendorId" = c."vendorId" AND existing."productId" = c."productId"
    ), 0) + (row_number() OVER (PARTITION BY c."vendorId", c."productId" ORDER BY c."firstPosition") - 1),
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
  FROM "newChapter" AS c
  ON CONFLICT DO NOTHING;

  UPDATE "CourseLesson" AS lesson
  SET "chapterId" = chapter."id"
  FROM "CourseChapter" AS chapter
  WHERE lesson."chapterId" IS NULL
    AND chapter."vendorId" = lesson."vendorId"
    AND chapter."productId" = lesson."productId"
    AND chapter."title" = COALESCE(NULLIF(regexp_replace(lesson."chapterTitle", '^[ \t\n\v\f\r\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff]+|[ \t\n\v\f\r\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff]+$', '', 'g'), ''), '未分類章節');
END
$course_chapter_backfill$;
-- END course_chapter_backfill

-- Fail closed: the backfill must have linked every lesson.
DO $course_chapter_backfill_check$
DECLARE
  missing bigint;
BEGIN
  SELECT count(*) INTO missing FROM "CourseLesson" WHERE "chapterId" IS NULL;
  IF missing > 0 THEN
    RAISE EXCEPTION 'course chapter backfill left % lesson(s) without a chapter', missing;
  END IF;
END
$course_chapter_backfill_check$;

-- CreateIndex
CREATE INDEX "CourseLesson_vendorId_productId_chapterId_idx" ON "CourseLesson"("vendorId", "productId", "chapterId");

-- AddForeignKey
-- Includes the tenant and the course: a lesson can only join a chapter of its
-- own course. RESTRICT keeps a chapter that still has lessons; deleting the
-- vendor or the course still cascades to both tables.
ALTER TABLE "CourseLesson" ADD CONSTRAINT "CourseLesson_vendorId_productId_chapterId_fkey" FOREIGN KEY ("vendorId", "productId", "chapterId") REFERENCES "CourseChapter"("vendorId", "productId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
