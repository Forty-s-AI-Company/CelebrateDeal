import { Prisma, type PrismaClient } from "@prisma/client";
import { findOrCreateChapter } from "./course-curriculum";
import { lessonChapterTitle, trustedChapterLink } from "./course-learning";

/**
 * F-5 chapter link repair.
 *
 * `CourseLesson.chapterId` is a cache of the chapter `lessonChapterTitle` names
 * (src/lib/course-learning.ts). While pre-F-5 code can still write lessons it can
 * leave the cache empty (new lesson) or stale (chapterTitle changed, chapterId
 * kept). This re-links every such lesson to the chapter its title names, creating
 * the chapter at the end of the course's chapter order when none exists. It never
 * changes `chapterTitle`, positions or anything a learner sees, and is safe to run
 * repeatedly. Run it, and see both checks below return 0, before the migration
 * that makes `chapterId` NOT NULL (docs/codex-goal/PRISMA_INVARIANTS.md).
 */

/** JavaScript String.prototype.trim as a PostgreSQL regular expression (the same
 * pattern as the backfill in 20261113120000_course_chapter/migration.sql). */
// Doubled backslashes: the SQL text carries the escapes (\t, \u00a0, ...), not the characters.
const TRIM_CLASS = "[ \\t\\n\\v\\f\\r\\u00a0\\u1680\\u2000-\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000\\ufeff]";
export const COURSE_CHAPTER_TRIM_PATTERN = `^${TRIM_CLASS}+|${TRIM_CLASS}+$`;

/** Read-only check 1: lessons without a chapter link. */
export const UNLINKED_COURSE_LESSONS_SQL = `SELECT count(*) AS "count" FROM "CourseLesson" WHERE "chapterId" IS NULL`;

/** Read-only check 2: lessons linked to a chapter their chapterTitle does not name. */
export const STALE_COURSE_LESSON_LINKS_SQL = `SELECT count(*) AS "count" FROM "CourseLesson" AS lesson JOIN "CourseChapter" AS chapter ON chapter."id" = lesson."chapterId" WHERE chapter."title" <> COALESCE(NULLIF(regexp_replace(lesson."chapterTitle", '${COURSE_CHAPTER_TRIM_PATTERN}', '', 'g'), ''), '未分類章節')`;

export type CourseChapterRepairScope = { vendorId?: string; productId?: string };
export type CourseChapterRepairResult = { coursesRepaired: number; lessonsRelinked: number; chaptersCreated: number };

const SCAN_BATCH = 500;
const MAX_ATTEMPTS = 5;

type ScannedLesson = { id: string; vendorId: string; productId: string; chapterTitle: string; chapterId: string | null; chapter: { id: string; title: string } | null };

function needsRepair(lesson: Pick<ScannedLesson, "chapterTitle" | "chapter">) {
  return !trustedChapterLink(lesson);
}

/** Courses (vendor + product) with at least one lesson whose link needs repair. */
async function coursesNeedingRepair(db: PrismaClient, scope: CourseChapterRepairScope) {
  const courses = new Map<string, { vendorId: string; productId: string }>();
  let cursor: string | undefined;
  for (;;) {
    const page: ScannedLesson[] = await db.courseLesson.findMany({
      where: { ...(scope.vendorId ? { vendorId: scope.vendorId } : {}), ...(scope.productId ? { productId: scope.productId } : {}) },
      orderBy: { id: "asc" },
      take: SCAN_BATCH,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      select: { id: true, vendorId: true, productId: true, chapterTitle: true, chapterId: true, chapter: { select: { id: true, title: true } } },
    });
    for (const lesson of page) {
      if (needsRepair(lesson)) courses.set(JSON.stringify([lesson.vendorId, lesson.productId]), { vendorId: lesson.vendorId, productId: lesson.productId });
    }
    if (page.length < SCAN_BATCH) return [...courses.values()];
    cursor = page[page.length - 1]!.id;
  }
}

async function repairCourse(db: PrismaClient, vendorId: string, productId: string) {
  return db.$transaction(async (tx) => {
    const scope = { vendorId, productId };
    const chaptersBefore = await tx.courseChapter.count({ where: scope });
    const lessons = await tx.courseLesson.findMany({
      where: scope,
      // New chapters are appended in first-lesson order, like the backfill.
      orderBy: [{ position: "asc" }, { id: "asc" }],
      select: { id: true, chapterTitle: true, chapterId: true, chapter: { select: { id: true, title: true } } },
    });
    let lessonsRelinked = 0;
    for (const lesson of lessons) {
      if (!needsRepair(lesson)) continue;
      const chapterId = await findOrCreateChapter(tx, vendorId, productId, lessonChapterTitle(lesson));
      // Compare-and-set on what was read, bound to the vendor and the course.
      const relinked = await tx.courseLesson.updateMany({
        where: { ...scope, id: lesson.id, chapterTitle: lesson.chapterTitle, chapterId: lesson.chapterId },
        data: { chapterId },
      });
      lessonsRelinked += relinked.count;
    }
    const chaptersCreated = (await tx.courseChapter.count({ where: scope })) - chaptersBefore;
    return { lessonsRelinked, chaptersCreated };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}

/** Re-links unlinked and stale-linked lessons, one Serializable transaction per
 * course. A serialization conflict with a concurrent curriculum edit retries that
 * course; the function can simply be run again after any failure. */
export async function repairCourseChapterLinks(db: PrismaClient, scope: CourseChapterRepairScope = {}): Promise<CourseChapterRepairResult> {
  const result: CourseChapterRepairResult = { coursesRepaired: 0, lessonsRelinked: 0, chaptersCreated: 0 };
  for (const course of await coursesNeedingRepair(db, scope)) {
    for (let attempt = 1; ; attempt += 1) {
      try {
        const repaired = await repairCourse(db, course.vendorId, course.productId);
        result.coursesRepaired += 1;
        result.lessonsRelinked += repaired.lessonsRelinked;
        result.chaptersCreated += repaired.chaptersCreated;
        break;
      } catch (error) {
        const retryable = error instanceof Prisma.PrismaClientKnownRequestError && ["P2002", "P2034"].includes(error.code);
        if (!retryable || attempt >= MAX_ATTEMPTS) throw error;
      }
    }
  }
  return result;
}
