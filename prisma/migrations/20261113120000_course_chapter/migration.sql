-- F-5: course chapters become their own rows.
--
-- Until now a chapter was only the free-text "CourseLesson"."chapterTitle";
-- the learner player grouped lessons by its trimmed value. "CourseChapter"
-- gives each chapter an identity (so a later feature can reorder, rename or
-- remove it) and "CourseLesson"."chapterId" links a lesson to it.
--
-- Forward-only and additive: one new table, one nullable column, one index,
-- three foreign keys and a backfill. "chapterTitle" is kept and still written
-- (with the chapter title); no row is deleted and no existing value changes.
--
-- "chapterId" stays nullable in this migration. While this release rolls out,
-- code older than F-5 can still insert or edit lessons without a chapterId;
-- readers fall back to "chapterTitle" for those rows, and a later migration
-- reruns the backfill below and adds NOT NULL.
--
-- Locks: ADD COLUMN takes ACCESS EXCLUSIVE on "CourseLesson" first, so no
-- lesson can be written between the backfill and the check at the end. The
-- closed-beta course tables are small; every statement waits at most 5s for
-- a lock and the whole migration is one transaction.
SET LOCAL lock_timeout = '5s';

ALTER TABLE "CourseLesson" ADD COLUMN "chapterId" TEXT;

-- CreateTable
CREATE TABLE "CourseChapter" (
    "id" TEXT NOT NULL,
    "vendorId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CourseChapter_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CourseChapter_vendorId_id_key" ON "CourseChapter"("vendorId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "CourseChapter_vendorId_productId_id_key" ON "CourseChapter"("vendorId", "productId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "CourseChapter_vendorId_productId_position_key" ON "CourseChapter"("vendorId", "productId", "position");

-- CreateIndex
-- One chapter per title in a course: renaming onto an existing title is an
-- error, never a silent merge (src/lib/course-curriculum.ts).
CREATE UNIQUE INDEX "CourseChapter_vendorId_productId_title_key" ON "CourseChapter"("vendorId", "productId", "title");

-- AddForeignKey
ALTER TABLE "CourseChapter" ADD CONSTRAINT "CourseChapter_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CourseChapter" ADD CONSTRAINT "CourseChapter_vendorId_productId_fkey" FOREIGN KEY ("vendorId", "productId") REFERENCES "Product"("vendorId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Same bounds as "CourseLesson"."chapterTitle" (1-120 characters after
-- btrim), but a chapter title is stored already trimmed.
ALTER TABLE "CourseChapter" ADD CONSTRAINT "CourseChapter_title_bounds" CHECK ("title" = btrim("title") AND length(btrim("title")) BETWEEN 1 AND 120);
ALTER TABLE "CourseChapter" ADD CONSTRAINT "CourseChapter_position_nonnegative" CHECK ("position" >= 0);

-- Access is through the authenticated server repository; no public policies.
ALTER TABLE "CourseChapter" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE "CourseChapter" FROM PUBLIC;
DO $course_chapter_data_api$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'anon') THEN REVOKE ALL ON TABLE "CourseChapter" FROM anon; END IF;
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'authenticated') THEN REVOKE ALL ON TABLE "CourseChapter" FROM authenticated; END IF;
END
$course_chapter_data_api$;

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
-- BEGIN course_chapter_backfill
DO $course_chapter_backfill$
BEGIN
  WITH "lessonTitle" AS (
    SELECT
      lesson."id",
      lesson."vendorId",
      lesson."productId",
      lesson."position",
      COALESCE(NULLIF(regexp_replace(lesson."chapterTitle", '^[ \t\n\v\f\r   -     　﻿]+|[ \t\n\v\f\r   -     　﻿]+$', '', 'g'), ''), '未分類章節') AS "title"
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
    AND chapter."title" = COALESCE(NULLIF(regexp_replace(lesson."chapterTitle", '^[ \t\n\v\f\r   -     　﻿]+|[ \t\n\v\f\r   -     　﻿]+$', '', 'g'), ''), '未分類章節');
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
