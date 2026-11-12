import { randomInt } from "node:crypto";
import { setTimeout as waitForRetry } from "node:timers/promises";
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
 * repeatedly. Run it (scripts/repair-course-chapter-links.ts) and see both
 * checks below return 0 before the migration that makes `chapterId` NOT NULL
 * (docs/codex-goal/PRISMA_INVARIANTS.md).
 */

/** JavaScript String.prototype.trim as a PostgreSQL regular expression (the same
 * pattern as the backfill in 20261113120100_course_lesson_chapter_link/migration.sql). */
// Doubled backslashes: the SQL text carries the escapes (\t, \u00a0, ...), not the characters.
const TRIM_CLASS = "[ \\t\\n\\v\\f\\r\\u00a0\\u1680\\u2000-\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000\\ufeff]";
export const COURSE_CHAPTER_TRIM_PATTERN = `^${TRIM_CLASS}+|${TRIM_CLASS}+$`;

/** Read-only check 1: lessons without a chapter link. */
export const UNLINKED_COURSE_LESSONS_SQL = `SELECT count(*) AS "count" FROM "CourseLesson" WHERE "chapterId" IS NULL`;

/** Read-only check 2: lessons linked to a chapter their chapterTitle does not name. */
export const STALE_COURSE_LESSON_LINKS_SQL = `SELECT count(*) AS "count" FROM "CourseLesson" AS lesson JOIN "CourseChapter" AS chapter ON chapter."id" = lesson."chapterId" WHERE chapter."title" <> COALESCE(NULLIF(regexp_replace(lesson."chapterTitle", '${COURSE_CHAPTER_TRIM_PATTERN}', '', 'g'), ''), '未分類章節')`;

export type CourseChapterRepairScope = { vendorId?: string; productId?: string };

export type CourseChapterRepairFailure = { vendorId: string; productId: string; reason: string };
export type CourseChapterRepairResult = {
  coursesRepaired: number;
  lessonsRelinked: number;
  chaptersCreated: number;
  /** Courses left as they were after every attempt failed; rerun to retry them. */
  failedCourses: CourseChapterRepairFailure[];
};

export type CourseChapterRepairOptions = {
  /** Lessons read per scan page (default 500). */
  scanBatchSize?: number;
  /** Interactive transaction timeout per course in ms (default 30 000). */
  transactionTimeoutMs?: number;
  /** Attempts per course before it is reported in failedCourses (default 5). */
  maxAttempts?: number;
  /** Test hook: called after each full scan page with the last lesson id read. */
  afterScanPage?: (lastLessonId: string) => Promise<void> | void;
};

const DEFAULT_SCAN_BATCH = 500;
const DEFAULT_TRANSACTION_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_ATTEMPTS = 5;
const UPDATE_CHUNK = 500;
/** Serialization conflict (P2034), a unique race on a new chapter (P2002) and an
 * expired or closed interactive transaction (P2028) are worth another attempt. */
const RETRYABLE_CODES = new Set(["P2002", "P2028", "P2034"]);

type LinkRow = { chapterTitle: string; chapter: { id: string; title: string } | null };

function needsRepair(lesson: LinkRow) {
  return !trustedChapterLink(lesson);
}

function scopeWhere(scope: CourseChapterRepairScope) {
  return { ...(scope.vendorId ? { vendorId: scope.vendorId } : {}), ...(scope.productId ? { productId: scope.productId } : {}) };
}

/** Courses (vendor + product) with at least one lesson whose link needs repair.
 * Keyset pagination on id: a lesson deleted during the scan (even the last one of
 * a page) cannot end it early, unlike a Prisma `cursor`. */
async function coursesNeedingRepair(db: PrismaClient, scope: CourseChapterRepairScope, options: CourseChapterRepairOptions) {
  const batch = options.scanBatchSize ?? DEFAULT_SCAN_BATCH;
  const courses = new Map<string, { vendorId: string; productId: string }>();
  let after: string | undefined;
  for (;;) {
    const page = await db.courseLesson.findMany({
      where: { ...scopeWhere(scope), ...(after ? { id: { gt: after } } : {}) },
      orderBy: { id: "asc" },
      take: batch,
      select: { id: true, vendorId: true, productId: true, chapterTitle: true, chapter: { select: { id: true, title: true } } },
    });
    for (const lesson of page) {
      if (needsRepair(lesson)) courses.set(JSON.stringify([lesson.vendorId, lesson.productId]), { vendorId: lesson.vendorId, productId: lesson.productId });
    }
    if (page.length < batch) return [...courses.values()];
    after = page[page.length - 1]!.id;
    await options.afterScanPage?.(after);
  }
}

async function repairCourse(db: PrismaClient, vendorId: string, productId: string, timeout: number) {
  return db.$transaction(async (tx) => {
    const scope = { vendorId, productId };
    const chaptersBefore = await tx.courseChapter.count({ where: scope });
    const lessons = await tx.courseLesson.findMany({
      where: scope,
      // New chapters are appended in first-lesson order, like the backfill.
      orderBy: [{ position: "asc" }, { id: "asc" }],
      select: { id: true, chapterTitle: true, chapterId: true, chapter: { select: { id: true, title: true } } },
    });
    const byTitle = new Map<string, Array<{ id: string; chapterTitle: string; chapterId: string | null }>>();
    for (const lesson of lessons) {
      if (!needsRepair(lesson)) continue;
      const title = lessonChapterTitle(lesson);
      byTitle.set(title, [...(byTitle.get(title) ?? []), { id: lesson.id, chapterTitle: lesson.chapterTitle, chapterId: lesson.chapterId }]);
    }
    let lessonsRelinked = 0;
    for (const [title, members] of byTitle) {
      // One chapter lookup per title, then one compare-and-set per chunk: each row
      // must still have the title and link that were read, bound to this course.
      const chapterId = await findOrCreateChapter(tx, vendorId, productId, title);
      for (let start = 0; start < members.length; start += UPDATE_CHUNK) {
        const chunk = members.slice(start, start + UPDATE_CHUNK);
        const relinked = await tx.courseLesson.updateMany({
          where: { ...scope, OR: chunk.map((lesson) => ({ id: lesson.id, chapterTitle: lesson.chapterTitle, chapterId: lesson.chapterId })) },
          data: { chapterId },
        });
        lessonsRelinked += relinked.count;
      }
    }
    const chaptersCreated = (await tx.courseChapter.count({ where: scope })) - chaptersBefore;
    return { lessonsRelinked, chaptersCreated };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout, maxWait: 10_000 });
}

/** Re-links unlinked and stale-linked lessons, one Serializable transaction per
 * course. A conflict with a concurrent curriculum edit or an expired transaction
 * retries that course after a short random delay; a course that still fails, or
 * fails with another known database error, is reported in `failedCourses` and the
 * run continues with the next course. Unexpected (non-database) errors are thrown. */
export async function repairCourseChapterLinks(db: PrismaClient, scope: CourseChapterRepairScope = {}, options: CourseChapterRepairOptions = {}): Promise<CourseChapterRepairResult> {
  const timeout = options.transactionTimeoutMs ?? DEFAULT_TRANSACTION_TIMEOUT_MS;
  const maxAttempts = Math.max(1, options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS);
  const result: CourseChapterRepairResult = { coursesRepaired: 0, lessonsRelinked: 0, chaptersCreated: 0, failedCourses: [] };
  for (const course of await coursesNeedingRepair(db, scope, options)) {
    for (let attempt = 1; ; attempt += 1) {
      try {
        const repaired = await repairCourse(db, course.vendorId, course.productId, timeout);
        result.coursesRepaired += 1;
        result.lessonsRelinked += repaired.lessonsRelinked;
        result.chaptersCreated += repaired.chaptersCreated;
        break;
      } catch (error) {
        if (!(error instanceof Prisma.PrismaClientKnownRequestError)) throw error;
        if (!RETRYABLE_CODES.has(error.code) || attempt >= maxAttempts) {
          result.failedCourses.push({ ...course, reason: error.code });
          break;
        }
        // Let the competing transaction finish instead of colliding again.
        await waitForRetry(Math.min(25 * 2 ** attempt, 400) + randomInt(0, 50));
      }
    }
  }
  return result;
}

/** The two read-only checks, optionally limited to one vendor (and course). */
export async function courseChapterLinkCounts(db: Pick<PrismaClient, "$queryRawUnsafe">, scope: CourseChapterRepairScope = {}) {
  const filters: string[] = [];
  const values: string[] = [];
  if (scope.vendorId) {
    values.push(scope.vendorId);
    filters.push(`lesson."vendorId" = $${values.length}`);
  }
  if (scope.productId) {
    values.push(scope.productId);
    filters.push(`lesson."productId" = $${values.length}`);
  }
  const extra = filters.length ? ` AND ${filters.join(" AND ")}` : "";
  // The documented unlinked check with the lesson alias added, so both checks
  // take the same filters. Values are bound parameters, never interpolated.
  const unlinkedSql = UNLINKED_COURSE_LESSONS_SQL.replace('FROM "CourseLesson" WHERE', 'FROM "CourseLesson" AS lesson WHERE') + extra;
  const count = async (sql: string) => Number((await db.$queryRawUnsafe<Array<{ count: bigint }>>(sql, ...values))[0]?.count ?? 0);
  return { unlinked: await count(unlinkedSql), staleLinks: await count(STALE_COURSE_LESSON_LINKS_SQL + extra) };
}
