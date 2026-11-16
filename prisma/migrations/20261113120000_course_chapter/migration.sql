-- F-5 (1/2): course chapters become their own rows.
--
-- Until now a chapter was only the free-text "CourseLesson"."chapterTitle";
-- the learner player grouped lessons by its trimmed value. "CourseChapter"
-- gives each chapter an identity (so a later feature can reorder, rename or
-- remove it). The next migration, 20261113120100_course_lesson_chapter_link,
-- links lessons to it and backfills the rows.
--
-- Forward-only and additive: one new, empty table with its constraints, two
-- foreign keys and RLS. No existing table or row changes.
--
-- Kept short on purpose: the two ADD FOREIGN KEY statements take SHARE ROW
-- EXCLUSIVE on "Vendor" and then "Product" (blocking writes to those tables)
-- only until this small transaction commits; validating them reads an empty
-- table. Every lock waits at most 5s. On a lock_timeout failure nothing is
-- applied: run `prisma migrate resolve --rolled-back 20261113120000_course_chapter`
-- and `migrate deploy` again.
SET LOCAL lock_timeout = '5s';

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
