import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { courseChapters, legacyChapterTitle, type CourseLesson } from "@/lib/course-learning";
import { getDb } from "@/lib/db";

/**
 * F-5 backfill. The migration's backfill block is read from the migration file
 * itself and executed here, so the test and the deployed SQL are one text.
 * Lessons are inserted the way pre-F-5 code wrote them (no chapterId).
 */
const MIGRATION = readFileSync(path.resolve(__dirname, "../../prisma/migrations/20261113120000_course_chapter/migration.sql"), "utf8");

function dollarBlock(tag: string) {
  const start = MIGRATION.indexOf(`DO $${tag}$`);
  const endMarker = `$${tag}$;`;
  const end = MIGRATION.indexOf(endMarker, start + tag.length + 5);
  if (start < 0 || end < 0) throw new Error(`Block ${tag} is missing from the migration.`);
  return MIGRATION.slice(start, end + endMarker.length - 1);
}

const BACKFILL = dollarBlock("course_chapter_backfill");
const BACKFILL_CHECK = dollarBlock("course_chapter_backfill_check");
const TRIM_PATTERN = /regexp_replace\(lesson\."chapterTitle", '([^']+)', '', 'g'\)/u.exec(BACKFILL)?.[1];

const db = getDb();
const vendors: string[] = [];

async function vendorWithCourses(courseCount: number) {
  const suffix = randomUUID();
  const vendor = await db.vendor.create({ data: { name: "Synthetic chapter academy", slug: `chapters-${suffix}`, email: `${suffix}@example.test`, passwordHash: "synthetic-only" } });
  vendors.push(vendor.id);
  const courses = [];
  for (let index = 0; index < courseCount; index += 1) {
    courses.push(await db.product.create({ data: { vendorId: vendor.id, name: `Synthetic course ${index}`, slug: `course-${index}-${suffix}`, priceCents: 10000, commerceDomain: "course", fulfillmentType: "course", isActive: true } }));
  }
  return { vendor, courses };
}

/** A lesson as written before F-5: free-text chapterTitle, no chapterId. */
async function legacyLesson(vendorId: string, productId: string, position: number, chapterTitle: string, published = true) {
  return db.courseLesson.create({ data: { vendorId, productId, position, chapterTitle, title: `Lesson ${position}`, durationSeconds: 60, publishedAt: published ? new Date() : null } });
}

const runBackfill = () => db.$executeRawUnsafe(BACKFILL);

async function chaptersOf(vendorId: string, productId: string) {
  return db.courseChapter.findMany({ where: { vendorId, productId }, orderBy: { position: "asc" }, select: { id: true, title: true, position: true } });
}

async function lessonsOf(vendorId: string, productId: string) {
  return db.courseLesson.findMany({ where: { vendorId, productId }, orderBy: { position: "asc" }, select: { id: true, chapterTitle: true, title: true, durationSeconds: true, position: true, publishedAt: true, chapterId: true, chapter: { select: { id: true, title: true } } } });
}

/** The pre-F-5 grouping, verbatim, as the oracle for what learners saw. */
function legacyCourseChapters(input: readonly CourseLesson[]) {
  const chapters = new Map<string, CourseLesson[]>();
  for (const lesson of [...input].sort((a, b) => a.position - b.position || a.id.localeCompare(b.id))) {
    const chapter = lesson.chapterTitle.trim() || "未分類章節";
    chapters.set(chapter, [...(chapters.get(chapter) ?? []), lesson]);
  }
  return [...chapters].map(([title, items]) => ({ title, lessons: items }));
}
const shape = (groups: ReadonlyArray<{ title: string; lessons: ReadonlyArray<{ id: string }> }>) => groups.map((group) => [group.title, group.lessons.map((lesson) => lesson.id)]);

afterEach(async () => {
  await db.vendor.deleteMany({ where: { id: { in: vendors.splice(0) } } });
});

describe("F-5 course chapter backfill (migration SQL)", () => {
  it("is the single DO block between the markers and keeps its trim rule in one pattern", () => {
    expect(MIGRATION).toMatch(/-- BEGIN course_chapter_backfill\r?\nDO \$course_chapter_backfill\$/u);
    expect(MIGRATION).toMatch(/\$course_chapter_backfill\$;\r?\n-- END course_chapter_backfill/u);
    expect(TRIM_PATTERN).toBeTruthy();
    expect(BACKFILL.split(TRIM_PATTERN!).length).toBe(3);
  });

  it("trims exactly like String.prototype.trim, which the player used", async () => {
    const samples = [" 第一章 ", "\t第一章\n", "第一章　", " 第一章 ", "﻿第一章 ", "　", "  ", "第 一 章", "​第一章", "\u0085第一章", "第一章\r\n"];
    for (const sample of samples) {
      const [row] = await db.$queryRaw<Array<{ trimmed: string }>>`SELECT regexp_replace(${sample}::text, ${TRIM_PATTERN!}::text, '', 'g') AS trimmed`;
      expect([sample, row?.trimmed]).toEqual([sample, sample.trim()]);
    }
  });

  it("creates one chapter per trimmed title, merges non-adjacent repeats and orders by first lesson", async () => {
    const { vendor, courses: [course] } = await vendorWithCourses(1);
    const l0 = await legacyLesson(vendor.id, course!.id, 0, "第一章", false); // first lesson unpublished
    const l1 = await legacyLesson(vendor.id, course!.id, 1, "  第二章 ");
    const l2 = await legacyLesson(vendor.id, course!.id, 2, "第一章");
    const l3 = await legacyLesson(vendor.id, course!.id, 3, "第二章　");
    const l4 = await legacyLesson(vendor.id, course!.id, 4, "第三章", false);
    const l5 = await legacyLesson(vendor.id, course!.id, 5, "第一章"); // non-adjacent repeat
    const l6 = await legacyLesson(vendor.id, course!.id, 6, "　"); // empty after trim
    await runBackfill();

    const chapters = await chaptersOf(vendor.id, course!.id);
    expect(chapters.map((chapter) => [chapter.title, chapter.position])).toEqual([["第一章", 0], ["第二章", 1], ["第三章", 2], ["未分類章節", 3]]);
    for (const chapter of chapters) expect(chapter.id).toMatch(/^chp_[0-9a-f]{32}$/u);
    const byTitle = new Map(chapters.map((chapter) => [chapter.title, chapter.id]));
    const lessons = await lessonsOf(vendor.id, course!.id);
    expect(lessons.map((lesson) => [lesson.id, lesson.chapterId])).toEqual([
      [l0.id, byTitle.get("第一章")], [l1.id, byTitle.get("第二章")], [l2.id, byTitle.get("第一章")], [l3.id, byTitle.get("第二章")],
      [l4.id, byTitle.get("第三章")], [l5.id, byTitle.get("第一章")], [l6.id, byTitle.get("未分類章節")],
    ]);
    // The original free text is not rewritten.
    expect(lessons.map((lesson) => lesson.chapterTitle)).toEqual(["第一章", "  第二章 ", "第一章", "第二章　", "第三章", "第一章", "　"]);
    for (const lesson of lessons) expect(lesson.chapter?.title).toBe(legacyChapterTitle(lesson.chapterTitle));

    // What learners see (published lessons only) is unchanged, including a chapter
    // whose first lesson is unpublished: 第二章 still comes before 第一章.
    const learner = lessons.filter((lesson) => lesson.publishedAt);
    expect(shape(courseChapters(learner))).toEqual([["第二章", [l1.id, l3.id]], ["第一章", [l2.id, l5.id]], ["未分類章節", [l6.id]]]);
    expect(shape(courseChapters(learner))).toEqual(shape(legacyCourseChapters(learner)));
    expect(courseChapters(learner).every((group) => group.id !== null)).toBe(true);
  });

  it("keeps the same title of other vendors and other courses apart", async () => {
    const a = await vendorWithCourses(2);
    const b = await vendorWithCourses(1);
    await legacyLesson(a.vendor.id, a.courses[0]!.id, 0, "第一章");
    await legacyLesson(a.vendor.id, a.courses[1]!.id, 0, "第一章");
    await legacyLesson(b.vendor.id, b.courses[0]!.id, 0, "第一章");
    await runBackfill();
    const chapters = await db.courseChapter.findMany({ where: { vendorId: { in: [a.vendor.id, b.vendor.id] } }, select: { id: true, vendorId: true, productId: true, title: true, position: true } });
    expect(chapters).toHaveLength(3);
    expect(new Set(chapters.map((chapter) => chapter.id)).size).toBe(3);
    for (const chapter of chapters) expect(chapter).toMatchObject({ title: "第一章", position: 0 });
    for (const lesson of await db.courseLesson.findMany({ where: { vendorId: { in: [a.vendor.id, b.vendor.id] } }, select: { vendorId: true, productId: true, chapter: { select: { vendorId: true, productId: true } } } })) {
      expect(lesson.chapter).toEqual({ vendorId: lesson.vendorId, productId: lesson.productId });
    }
  });

  it("can be rerun: no duplicates, the same ids after clearing, and late legacy lessons are linked", async () => {
    const { vendor, courses: [course] } = await vendorWithCourses(1);
    await legacyLesson(vendor.id, course!.id, 0, "第一章");
    await legacyLesson(vendor.id, course!.id, 1, "第二章");
    await runBackfill();
    const first = await chaptersOf(vendor.id, course!.id);

    await runBackfill();
    expect(await chaptersOf(vendor.id, course!.id)).toEqual(first);

    // Clear the links and the rows, then rerun: identical ids and positions.
    await db.courseLesson.updateMany({ where: { vendorId: vendor.id }, data: { chapterId: null } });
    await db.courseChapter.deleteMany({ where: { vendorId: vendor.id } });
    await runBackfill();
    expect(await chaptersOf(vendor.id, course!.id)).toEqual(first);

    // Lessons written by pre-F-5 code after the migration: an existing title joins
    // its chapter, a new title gets a new chapter after the existing ones.
    const late = await legacyLesson(vendor.id, course!.id, 2, " 第一章");
    const fresh = await legacyLesson(vendor.id, course!.id, 3, "第三章");
    await runBackfill();
    const after = await chaptersOf(vendor.id, course!.id);
    expect(after.map((chapter) => [chapter.title, chapter.position])).toEqual([["第一章", 0], ["第二章", 1], ["第三章", 2]]);
    expect((await db.courseLesson.findUniqueOrThrow({ where: { id: late.id } })).chapterId).toBe(first[0]!.id);
    expect((await db.courseLesson.findUniqueOrThrow({ where: { id: fresh.id } })).chapterId).toBe(after[2]!.id);
  });

  it("does not collide with a chapter that was renamed away from a title", async () => {
    const { vendor, courses: [course] } = await vendorWithCourses(1);
    await legacyLesson(vendor.id, course!.id, 0, "第一章");
    await runBackfill();
    const [original] = await chaptersOf(vendor.id, course!.id);
    await db.courseChapter.update({ where: { id: original!.id }, data: { title: "開場" } });
    await db.courseLesson.updateMany({ where: { chapterId: original!.id }, data: { chapterTitle: "開場" } });
    const late = await legacyLesson(vendor.id, course!.id, 1, "第一章");
    await runBackfill();
    const chapters = await chaptersOf(vendor.id, course!.id);
    expect(chapters.map((chapter) => [chapter.title, chapter.position])).toEqual([["開場", 0], ["第一章", 1]]);
    expect((await db.courseLesson.findUniqueOrThrow({ where: { id: late.id } })).chapterId).toBe(chapters[1]!.id);
  });

  it("leaves no lesson without a chapter, and the migration's check fails closed", async () => {
    const { vendor, courses: [course] } = await vendorWithCourses(1);
    await legacyLesson(vendor.id, course!.id, 0, "第一章");
    await runBackfill();
    // The verification query of the migration, over the whole table.
    const [missing] = await db.$queryRaw<Array<{ count: bigint }>>`SELECT count(*) AS count FROM "CourseLesson" WHERE "chapterId" IS NULL`;
    expect(missing?.count).toBe(BigInt(0));
    await expect(db.$executeRawUnsafe(BACKFILL_CHECK)).resolves.toBeDefined();
    const orphan = await legacyLesson(vendor.id, course!.id, 1, "第二章");
    await expect(db.$executeRawUnsafe(BACKFILL_CHECK)).rejects.toThrow(/without a chapter/u);
    await db.courseLesson.delete({ where: { id: orphan.id } });
  });
});
