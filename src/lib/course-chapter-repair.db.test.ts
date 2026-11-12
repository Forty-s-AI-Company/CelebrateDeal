import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { COURSE_CHAPTER_TRIM_PATTERN, STALE_COURSE_LESSON_LINKS_SQL, UNLINKED_COURSE_LESSONS_SQL, repairCourseChapterLinks } from "@/lib/course-chapter-repair";
import { saveCourseLesson } from "@/lib/course-curriculum";
import { lessonChapterTitle } from "@/lib/course-learning";
import { getDb } from "@/lib/db";

const ROOT = path.resolve(__dirname, "../..");
const db = getDb();
const vendors: string[] = [];

async function course() {
  const suffix = randomUUID();
  const vendor = await db.vendor.create({ data: { name: "Synthetic repair academy", slug: `repair-${suffix}`, email: `${suffix}@example.test`, passwordHash: "synthetic-only" } });
  vendors.push(vendor.id);
  const product = await db.product.create({ data: { vendorId: vendor.id, name: "Synthetic course", slug: `course-${suffix}`, priceCents: 10000, commerceDomain: "course", fulfillmentType: "course", isActive: true } });
  return { vendor, product };
}

async function save(f: Awaited<ReturnType<typeof course>>, chapterTitle: string, title: string) {
  const { revision } = await db.product.findUniqueOrThrow({ where: { id: f.product.id } });
  return saveCourseLesson(db, f.vendor.id, { productId: f.product.id, revision, chapterTitle, title, videoUrl: "", durationSeconds: 0, published: false });
}

async function legacyInsert(f: Awaited<ReturnType<typeof course>>, chapterTitle: string, title: string) {
  const last = await db.courseLesson.aggregate({ where: { productId: f.product.id }, _max: { position: true } });
  return (await db.courseLesson.create({ data: { vendorId: f.vendor.id, productId: f.product.id, chapterTitle, title, position: (last._max.position ?? -1) + 1 } })).id;
}

const count = async (sql: string) => Number((await db.$queryRawUnsafe<Array<{ count: bigint }>>(sql))[0]!.count);
const snapshot = (vendorId: string) => db.courseLesson.findMany({ where: { vendorId }, orderBy: { position: "asc" }, select: { id: true, chapterTitle: true, position: true, chapter: { select: { title: true } } } });

afterEach(async () => {
  await db.vendor.deleteMany({ where: { id: { in: vendors.splice(0) } } });
});

describe("repairCourseChapterLinks (F-5)", () => {
  it("re-links unlinked and stale-linked lessons by title, creating missing chapters after the existing ones", async () => {
    const f = await course();
    await save(f, "第一章", "a");
    const stale = await save(f, "第二章", "b");
    const unlinked = await legacyInsert(f, " 第一章\u3000", "c");
    const orphanTitle = await legacyInsert(f, "附錄", "d");
    const blank = await legacyInsert(f, "\u3000", "e");
    await db.courseLesson.update({ where: { id: stale }, data: { chapterTitle: "番外" } });
    const before = await snapshot(f.vendor.id);
    expect(await count(UNLINKED_COURSE_LESSONS_SQL)).toBeGreaterThan(0);
    expect(await count(STALE_COURSE_LESSON_LINKS_SQL)).toBeGreaterThan(0);

    const result = await repairCourseChapterLinks(db, { vendorId: f.vendor.id });
    expect(result).toEqual({ coursesRepaired: 1, lessonsRelinked: 4, chaptersCreated: 3 });
    const chapters = await db.courseChapter.findMany({ where: { vendorId: f.vendor.id }, orderBy: { position: "asc" }, select: { title: true, position: true } });
    // New chapters follow the existing ones, in first-lesson order.
    expect(chapters).toEqual([{ title: "第一章", position: 0 }, { title: "第二章", position: 1 }, { title: "番外", position: 2 }, { title: "附錄", position: 3 }, { title: "未分類章節", position: 4 }]);
    const after = await snapshot(f.vendor.id);
    for (const lesson of after) expect(lesson.chapter?.title).toBe(lessonChapterTitle(lesson));
    // Only the links change: titles, order and what learners see stay as they were.
    expect(after.map(({ id, chapterTitle, position }) => ({ id, chapterTitle, position }))).toEqual(before.map(({ id, chapterTitle, position }) => ({ id, chapterTitle, position })));
    expect(after.find((lesson) => lesson.id === unlinked)?.chapter?.title).toBe("第一章");
    expect(after.find((lesson) => lesson.id === orphanTitle)?.chapter?.title).toBe("附錄");
    expect(after.find((lesson) => lesson.id === blank)?.chapter?.title).toBe("未分類章節");
    expect(await count(UNLINKED_COURSE_LESSONS_SQL)).toBe(0);
    expect(await count(STALE_COURSE_LESSON_LINKS_SQL)).toBe(0);

    // Idempotent.
    expect(await repairCourseChapterLinks(db, { vendorId: f.vendor.id })).toEqual({ coursesRepaired: 0, lessonsRelinked: 0, chaptersCreated: 0 });
  });

  it("stays inside its scope and keeps tenants apart", async () => {
    const a = await course();
    const b = await course();
    await legacyInsert(a, "第一章", "a");
    const other = await legacyInsert(b, "第一章", "b");
    await repairCourseChapterLinks(db, { vendorId: a.vendor.id, productId: a.product.id });
    expect((await db.courseLesson.findUniqueOrThrow({ where: { id: other } })).chapterId).toBeNull();
    await repairCourseChapterLinks(db);
    const chapters = await db.courseChapter.findMany({ where: { vendorId: { in: [a.vendor.id, b.vendor.id] } }, select: { vendorId: true, productId: true, title: true } });
    expect(chapters).toHaveLength(2);
    for (const lesson of await db.courseLesson.findMany({ where: { vendorId: { in: [a.vendor.id, b.vendor.id] } }, select: { vendorId: true, productId: true, chapter: { select: { vendorId: true, productId: true } } } })) {
      expect(lesson.chapter).toEqual({ vendorId: lesson.vendorId, productId: lesson.productId });
    }
  });

  it("uses the migration's trim pattern and the read-only checks documented for the NOT NULL step", () => {
    const migration = readFileSync(path.join(ROOT, "prisma/migrations/20261113120000_course_chapter/migration.sql"), "utf8");
    expect(migration).toContain(`'${COURSE_CHAPTER_TRIM_PATTERN}'`);
    const invariants = readFileSync(path.join(ROOT, "docs/codex-goal/PRISMA_INVARIANTS.md"), "utf8");
    expect(invariants).toContain(UNLINKED_COURSE_LESSONS_SQL);
    expect(invariants).toContain(STALE_COURSE_LESSON_LINKS_SQL);
  });
});
