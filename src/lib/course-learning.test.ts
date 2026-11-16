import { describe, expect, it } from "vitest";
import { courseChapters, courseCompletion, legacyChapterTitle, nextLessonProgress, shouldAutoCompleteLesson, type CourseLesson } from "@/lib/course-learning";

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
  it("attaches the chapter id and uses it as the group identity", () => {
    const chapter = { id: "chp-1", title: "第一章" };
    const groups = courseChapters([{ ...lessons[0]!, chapter }, { ...lessons[1]!, chapter }, { ...lessons[2]!, chapter: null }]);
    expect(groups.map((group) => [group.id, group.title, group.lessons.map((lesson) => lesson.id)])).toEqual([["chp-1", "第一章", ["lesson-1", "lesson-2"]], [null, "第二章", ["lesson-3"]]]);
  });
});

/** The pre-F-5 implementation, kept verbatim as the oracle for what learners saw. */
function legacyCourseChapters(input: readonly CourseLesson[]) {
  const chapters = new Map<string, CourseLesson[]>();
  for (const lesson of [...input].sort((a, b) => a.position - b.position || a.id.localeCompare(b.id))) {
    const chapter = lesson.chapterTitle.trim() || "未分類章節";
    chapters.set(chapter, [...(chapters.get(chapter) ?? []), lesson]);
  }
  return [...chapters].map(([title, items]) => ({ title, lessons: items }));
}

const shape = (groups: ReadonlyArray<{ title: string; lessons: ReadonlyArray<{ id: string }> }>) => groups.map((group) => [group.title, group.lessons.map((lesson) => lesson.id)]);

type DraftLesson = CourseLesson & { published: boolean };

/** Links lessons to chapters the way the F-5 backfill does: one chapter per
 * (course, trimmed title), so equal trimmed titles share one chapter id. */
function backfill(drafts: readonly Omit<DraftLesson, "chapter">[]): DraftLesson[] {
  const ids = new Map<string, string>();
  return drafts.map((draft) => {
    const title = legacyChapterTitle(draft.chapterTitle);
    if (!ids.has(title)) ids.set(title, `chp-${ids.size}`);
    return { ...draft, chapter: { id: ids.get(title)!, title } };
  });
}

const visible = (all: readonly DraftLesson[]) => all.filter((lesson) => lesson.published);

describe("learner chapter tree is unchanged by F-5 chapter rows", () => {
  it("keeps titles, chapter order and lesson order for the reviewed fixtures", () => {
    const course = backfill([
      { id: "a", chapterTitle: "第一章", title: "unpublished first lesson", durationSeconds: 10, position: 0, published: false },
      { id: "b", chapterTitle: "  第二章 ", title: "b", durationSeconds: 10, position: 1, published: true },
      { id: "c", chapterTitle: "第一章", title: "c", durationSeconds: 10, position: 2, published: true },
      { id: "d", chapterTitle: "第二章\u3000", title: "d", durationSeconds: 10, position: 3, published: true },
      { id: "e", chapterTitle: "第三章", title: "e", durationSeconds: 10, position: 4, published: false },
      { id: "f", chapterTitle: "第一章", title: "f", durationSeconds: 10, position: 5, published: true },
      { id: "g", chapterTitle: "\u3000", title: "g", durationSeconds: 10, position: 6, published: true },
    ]);
    const learner = visible(course);
    // 第一章's first lesson is unpublished, so 第二章 comes first for learners even
    // though the backfill gives 第一章 position 0.
    expect(shape(courseChapters(learner))).toEqual([["第二章", ["b", "d"]], ["第一章", ["c", "f"]], ["未分類章節", ["g"]]]);
    expect(shape(courseChapters(learner))).toEqual(shape(legacyCourseChapters(learner)));
    expect(shape(courseChapters(course))).toEqual(shape(legacyCourseChapters(course)));
    // Progress, completion and the certificate condition only read lesson ids.
    const progress = [{ lessonId: "b", completedAt: new Date() }, { lessonId: "c", completedAt: new Date() }, { lessonId: "a", completedAt: new Date() }];
    expect(courseCompletion(learner, progress)).toEqual(courseCompletion(learner.map((lesson) => ({ id: lesson.id })), progress));
  });

  it("matches the pre-F-5 grouping for random courses, including unlinked and mismatched lessons", () => {
    let seed = 20261113;
    const random = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
    const pick = <T,>(items: readonly T[]) => items[Math.floor(random() * items.length)]!;
    const titles = ["第一章", " 第一章", "第一章\u3000", "第二章", "\t第二章\n", "第三章", "\u3000", "未分類章節", "Intro", "intro"];
    for (let round = 0; round < 500; round += 1) {
      const count = 1 + Math.floor(random() * 12);
      const positions = [...Array(count).keys()].sort(() => random() - 0.5);
      const course = backfill(positions.map((position, index) => ({ id: `l${index}`, chapterTitle: pick(titles), title: "x", durationSeconds: 1, position, published: random() < 0.7 })))
        .map((lesson): DraftLesson => {
          const roll = random();
          // Written by old code during a rollout: no chapter link yet.
          if (roll < 0.15) return { ...lesson, chapter: null };
          // Old code moved the lesson to another title without touching chapterId.
          if (roll < 0.25) return { ...lesson, chapterTitle: pick(titles) };
          return lesson;
        });
      const learner = visible(course);
      expect(shape(courseChapters(learner))).toEqual(shape(legacyCourseChapters(learner)));
      expect(shape(courseChapters(course))).toEqual(shape(legacyCourseChapters(course)));
      for (const group of courseChapters(learner)) {
        // A group carries an id only when it is a real chapter with that title.
        if (group.id) expect(group.lessons.some((lesson) => lesson.chapter?.id === group.id && lesson.chapter.title === group.title)).toBe(true);
      }
    }
  });

  it("shows a renamed chapter's new title in the same place", () => {
    const course = backfill([
      { id: "a", chapterTitle: "第一章", title: "a", durationSeconds: 1, position: 0, published: true },
      { id: "b", chapterTitle: "第二章", title: "b", durationSeconds: 1, position: 1, published: true },
    ]);
    // renameCourseChapter rewrites the chapter title and every lesson's chapterTitle together.
    const renamed = course.map((lesson) => lesson.chapter?.id === "chp-0" ? { ...lesson, chapterTitle: "開場", chapter: { id: "chp-0", title: "開場" } } : lesson);
    expect(courseChapters(renamed).map((group) => [group.id, group.title])).toEqual([["chp-0", "開場"], ["chp-1", "第二章"]]);
  });
});

