import { describe, expect, it } from "vitest";
import { courseChapters, courseCompletion, nextLessonProgress, shouldAutoCompleteLesson } from "@/lib/course-learning";

describe("course player progress", () => {
  const lessons = [
    { id: "lesson-1", chapterTitle: "第一章", title: "開始前準備", durationSeconds: 100, position: 1 },
    { id: "lesson-2", chapterTitle: "第一章", title: "成交框架", durationSeconds: 200, position: 2 },
    { id: "lesson-3", chapterTitle: "第二章", title: "實戰演練", durationSeconds: 60, position: 3 },
  ];

  it("marks a lesson complete at 90%, keeps a safe resume checkpoint, and never rewinds it", () => {
    expect(shouldAutoCompleteLesson(89, 100)).toBe(false);
    expect(shouldAutoCompleteLesson(90, 100)).toBe(true);
    expect(nextLessonProgress({ lesson: lessons[0]!, previous: { watchedSeconds: 80, completedAt: null }, reportedWatchedSeconds: 15, markedComplete: false, now: new Date("2026-09-09T00:00:00Z") })).toEqual({ watchedSeconds: 80, completedAt: null });
    expect(nextLessonProgress({ lesson: lessons[0]!, previous: null, reportedWatchedSeconds: 10_000, markedComplete: false, now: new Date("2026-09-09T00:00:00Z") })).toMatchObject({ watchedSeconds: 100, completedAt: new Date("2026-09-09T00:00:00Z") });
  });

  it("calculates the whole-course percentage from unique completed lessons", () => {
    expect(courseCompletion(lessons, [{ lessonId: "lesson-1", completedAt: new Date() }, { lessonId: "lesson-1", completedAt: new Date() }, { lessonId: "foreign", completedAt: new Date() }])).toEqual({ completedLessons: 1, totalLessons: 3, percent: 33, complete: false });
    expect(courseCompletion(lessons, lessons.map((lesson) => ({ lessonId: lesson.id, completedAt: new Date() })))).toMatchObject({ percent: 100, complete: true });
  });

  it("builds an ordered chapter tree for the player sidebar", () => {
    expect(courseChapters([...lessons].reverse()).map((chapter) => [chapter.title, chapter.lessons.map((lesson) => lesson.id)])).toEqual([["第一章", ["lesson-1", "lesson-2"]], ["第二章", ["lesson-3"]]]);
  });
});
