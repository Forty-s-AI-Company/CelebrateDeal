-- Q-14 (2/3): validate CHECK ("chapterId" IS NOT NULL), added NOT VALID by
-- 20261117090000_course_lesson_chapter_repair.
--
-- Its own file because Prisma runs each migration file as one transaction:
-- VALIDATE holds only SHARE UPDATE EXCLUSIVE on "CourseLesson", so learners
-- keep reading and managers keep writing lessons while it scans the table.
-- 1/3 already proved under its lock that no NULL exists and the CHECK has
-- rejected new ones since, so this passes. If it did not, this migration would
-- fail and roll back; the CHECK then stays NOT VALID and keeps checking writes.
-- No row changes.
DO $$
BEGIN
  PERFORM pg_catalog.set_config('lock_timeout', '5s', true);
END
$$;

ALTER TABLE "CourseLesson" VALIDATE CONSTRAINT "CourseLesson_chapterId_not_null_check";
