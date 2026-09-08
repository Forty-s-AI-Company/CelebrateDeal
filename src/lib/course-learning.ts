/**
 * Framework-independent course-player rules.  Keeping these calculations out
 * of the UI makes the 90% completion rule consistent for browser and API
 * callers, and easy to cover with unit tests.
 */
export type CourseLesson = {
  id: string;
  chapterTitle: string;
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

/** Groups a flat, ordered lesson list into the player sidebar's chapter tree. */
export function courseChapters(lessons: readonly CourseLesson[]) {
  const chapters = new Map<string, CourseLesson[]>();
  for (const lesson of [...lessons].sort((a, b) => a.position - b.position || a.id.localeCompare(b.id))) {
    const chapter = lesson.chapterTitle.trim() || "未分類章節";
    chapters.set(chapter, [...(chapters.get(chapter) ?? []), lesson]);
  }
  return [...chapters].map(([title, items]) => ({ title, lessons: items }));
}
