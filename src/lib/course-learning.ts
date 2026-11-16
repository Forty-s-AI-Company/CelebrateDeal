/**
 * Framework-independent course-player rules.  Keeping these calculations out
 * of the UI makes the 90% completion rule consistent for browser and API
 * callers, and easy to cover with unit tests.
 */
export type CourseLesson = {
  id: string;
  /** Legacy free-text chapter; written with the chapter title since F-5. */
  chapterTitle: string;
  /** F-5 chapter row (same vendor and course by FK). Null for a lesson written by
   * code older than F-5 that has not been linked yet; omitted by callers that do
   * not group lessons into chapters. */
  chapter?: { id: string; title: string } | null;
  title: string;
  durationSeconds: number;
  position: number;
};

export type CourseLessonProgress = {
  lessonId: string;
  watchedSeconds: number;
  completedAt: Date | null;
};

export const AUTO_COMPLETE_PERCENT = 90;

function finiteNonNegative(value: number) {
  return Number.isFinite(value) && value >= 0;
}

/** Prevents malformed media events from claiming an impossible watch time. */
export function normalizedWatchedSeconds(watchedSeconds: number, durationSeconds: number) {
  if (!finiteNonNegative(watchedSeconds) || !finiteNonNegative(durationSeconds)) {
    throw new Error("Lesson time values must be finite, non-negative numbers.");
  }
  return Math.min(Math.floor(watchedSeconds), Math.floor(durationSeconds));
}

/** A zero-duration lesson needs the explicit manual completion action. */
export function shouldAutoCompleteLesson(watchedSeconds: number, durationSeconds: number) {
  const watched = normalizedWatchedSeconds(watchedSeconds, durationSeconds);
  return durationSeconds > 0 && watched / durationSeconds >= AUTO_COMPLETE_PERCENT / 100;
}

export function nextLessonProgress(input: {
  lesson: Pick<CourseLesson, "durationSeconds">;
  previous: Pick<CourseLessonProgress, "watchedSeconds" | "completedAt"> | null;
  reportedWatchedSeconds: number;
  markedComplete: boolean;
  now?: Date;
}): Pick<CourseLessonProgress, "watchedSeconds" | "completedAt"> {
  const durationSeconds = input.lesson.durationSeconds;
  const reported = normalizedWatchedSeconds(input.reportedWatchedSeconds, durationSeconds);
  const previous = input.previous ? normalizedWatchedSeconds(input.previous.watchedSeconds, durationSeconds) : 0;
  // A client can resume from an earlier timestamp, but cannot make the saved
  // checkpoint move backwards or use a forged oversized number.
  const watchedSeconds = Math.max(previous, reported);
  const completedAt = input.previous?.completedAt
    ?? (input.markedComplete || shouldAutoCompleteLesson(watchedSeconds, durationSeconds) ? (input.now ?? new Date()) : null);
  return { watchedSeconds, completedAt };
}

export function courseCompletion(lessons: readonly Pick<CourseLesson, "id">[], progress: readonly Pick<CourseLessonProgress, "lessonId" | "completedAt">[]) {
  if (lessons.length === 0) return { completedLessons: 0, totalLessons: 0, percent: 0, complete: false };
  const lessonIds = new Set(lessons.map((lesson) => lesson.id));
  const completedIds = new Set(progress.filter((item) => item.completedAt && lessonIds.has(item.lessonId)).map((item) => item.lessonId));
  const completedLessons = completedIds.size;
  const percent = Math.round((completedLessons / lessons.length) * 100);
  return { completedLessons, totalLessons: lessons.length, percent, complete: completedLessons === lessons.length };
}

export const UNCATEGORIZED_CHAPTER_TITLE = "未分類章節";

/** The chapter title the player showed before F-5: the trimmed free text. */
export function legacyChapterTitle(chapterTitle: string) {
  return chapterTitle.trim() || UNCATEGORIZED_CHAPTER_TITLE;
}

/**
 * F-5: the one definition of which chapter a lesson belongs to. Every reader
 * and writer (learner tree, manager page, rename, repair) uses it.
 *
 * A lesson belongs to the chapter titled `legacyChapterTitle(chapterTitle)`;
 * chapter titles are unique per course, so the title names at most one chapter
 * row. `chapterId` is a cache of that answer: it is trusted only when the linked
 * chapter carries the same title. A lesson without a link (written by code older
 * than F-5 during a rollout) or with a stale link (an old deployment changed its
 * `chapterTitle` without touching `chapterId`) still belongs by its title, as it
 * did before F-5. `repairCourseChapterLinks` rewrites such links.
 */
export function lessonChapterTitle(lesson: Pick<CourseLesson, "chapterTitle">) {
  return legacyChapterTitle(lesson.chapterTitle);
}

/** The lesson's chapter link when it agrees with `lessonChapterTitle`, otherwise null. */
export function trustedChapterLink<Chapter extends { id: string; title: string }>(lesson: { chapterTitle: string; chapter?: Chapter | null }) {
  return lesson.chapter && lesson.chapter.title === lessonChapterTitle(lesson) ? lesson.chapter : null;
}

export type CourseChapterGroup<Lesson extends CourseLesson = CourseLesson> = {
  /** The CourseChapter id; null when no lesson of the group is linked to a chapter. */
  id: string | null;
  title: string;
  lessons: Lesson[];
};

const byPosition = <Lesson extends Pick<CourseLesson, "id" | "position">>(a: Lesson, b: Lesson) => a.position - b.position || a.id.localeCompare(b.id);

/**
 * Groups a flat lesson list into the player sidebar's chapter tree.
 *
 * Membership follows `lessonChapterTitle` (see above). A group carries the
 * chapter id when at least one of its lessons has a trusted link to it.
 *
 * Order (deliberate trade-off): chapters follow their first lesson in the given
 * list, by lesson position, which is the pre-F-5 rule. The learner list holds
 * only published lessons, so this is the first *visible* lesson. It does NOT use
 * `CourseChapter.position`: the F-5 backfill numbered chapters by their first
 * lesson including unpublished ones, so adopting it would reorder what learners
 * already see. `CourseChapter.position` orders the manager page and a later
 * chapter-reordering feature; that feature decides when learners follow it.
 */
export function courseChapters<Lesson extends CourseLesson>(lessons: readonly Lesson[]): CourseChapterGroup<Lesson>[] {
  const ordered = [...lessons].sort(byPosition);
  const chapterIdByTitle = new Map<string, string>();
  for (const lesson of ordered) {
    const chapter = trustedChapterLink(lesson);
    if (chapter && !chapterIdByTitle.has(chapter.title)) chapterIdByTitle.set(chapter.title, chapter.id);
  }
  const groups = new Map<string, CourseChapterGroup<Lesson>>();
  for (const lesson of ordered) {
    const title = lessonChapterTitle(lesson);
    const group = groups.get(title);
    if (group) group.lessons.push(lesson);
    else groups.set(title, { id: chapterIdByTitle.get(title) ?? null, title, lessons: [lesson] });
  }
  return [...groups.values()];
}

/**
 * The manager curriculum page: every chapter row in `CourseChapter.position`
 * order (empty ones too), each holding the lessons that belong to it by
 * `lessonChapterTitle`, whatever their `chapterId` says. Lessons whose title
 * names no chapter row yet come after, grouped by title, in first-lesson order.
 * Restricted to published lessons, the partition is the learner tree's.
 */
export function managerChapterGroups<Lesson extends Pick<CourseLesson, "id" | "position" | "chapterTitle">>(
  chapters: readonly { id: string; title: string }[],
  lessons: readonly Lesson[],
) {
  const ordered = [...lessons].sort(byPosition);
  const linked = chapters.map((chapter) => ({ id: chapter.id, title: chapter.title, lessons: [] as Lesson[] }));
  const unlinked: Array<{ id: null; title: string; lessons: Lesson[] }> = [];
  const byTitle = new Map<string, { lessons: Lesson[] }>(linked.map((group) => [group.title, group]));
  for (const lesson of ordered) {
    const title = lessonChapterTitle(lesson);
    let group = byTitle.get(title);
    if (!group) {
      const created = { id: null, title, lessons: [] as Lesson[] };
      unlinked.push(created);
      byTitle.set(title, created);
      group = created;
    }
    group.lessons.push(lesson);
  }
  return { chapters: linked, unlinked };
}
