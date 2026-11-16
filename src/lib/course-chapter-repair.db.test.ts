import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { COURSE_CHAPTER_TRIM_PATTERN, STALE_COURSE_LESSON_LINKS_SQL, UNLINKED_COURSE_LESSONS_SQL, courseChapterLinkCounts, repairCourseChapterLinks } from "@/lib/course-chapter-repair";
import { saveCourseLesson } from "@/lib/course-curriculum";
import { lessonChapterTitle } from "@/lib/course-learning";
import { getDb } from "@/lib/db";

const ROOT = path.resolve(__dirname, "../..");
const db = getDb();
const vendors: string[] = [];
/** U+3000 IDEOGRAPHIC SPACE, which JavaScript's trim removes and btrim does not. */
const IDEOGRAPHIC_SPACE = String.fromCharCode(0x3000);

async function vendor() {
  const suffix = randomUUID();
  const row = await db.vendor.create({ data: { name: "Synthetic repair academy", slug: `repair-${suffix}`, email: `${suffix}@example.test`, passwordHash: "synthetic-only" } });
  vendors.push(row.id);
  return row;
}

async function course(existingVendor?: { id: string }) {
  const owner = existingVendor ?? await vendor();
  const product = await db.product.create({ data: { vendorId: owner.id, name: "Synthetic course", slug: `course-${randomUUID()}`, priceCents: 10000, commerceDomain: "course", fulfillmentType: "course", isActive: true } });
  return { vendor: owner, product };
}

async function save(f: Awaited<ReturnType<typeof course>>, chapterTitle: string, title: string) {
  const { revision } = await db.product.findUniqueOrThrow({ where: { id: f.product.id } });
  return saveCourseLesson(db, f.vendor.id, { productId: f.product.id, revision, chapterTitle, title, videoUrl: "", durationSeconds: 0, published: false });
}

/** A lesson as pre-F-5 code writes it: no chapterId. `id` lets a test fix the scan order. */
async function legacyInsert(f: Awaited<ReturnType<typeof course>>, chapterTitle: string, title: string, id?: string) {
  const last = await db.courseLesson.aggregate({ where: { productId: f.product.id }, _max: { position: true } });
  return (await db.courseLesson.create({ data: { ...(id ? { id } : {}), vendorId: f.vendor.id, productId: f.product.id, chapterTitle, title, position: (last._max.position ?? -1) + 1 } })).id;
}

const snapshot = (vendorId: string) => db.courseLesson.findMany({ where: { vendorId }, orderBy: { position: "asc" }, select: { id: true, chapterTitle: true, position: true, chapter: { select: { title: true } } } });

afterEach(async () => {
  await db.vendor.deleteMany({ where: { id: { in: vendors.splice(0) } } });
});

describe("repairCourseChapterLinks (F-5)", () => {
  it("re-links unlinked and stale-linked lessons by title, creating missing chapters after the existing ones", async () => {
    const f = await course();
    await save(f, "第一章", "a");
    const stale = await save(f, "第二章", "b");
    const unlinked = await legacyInsert(f, ` 第一章${IDEOGRAPHIC_SPACE}`, "c");
    const orphanTitle = await legacyInsert(f, "附錄", "d");
    const blank = await legacyInsert(f, IDEOGRAPHIC_SPACE, "e");
    await db.courseLesson.update({ where: { id: stale }, data: { chapterTitle: "番外" } });
    const before = await snapshot(f.vendor.id);
    expect(await courseChapterLinkCounts(db, { vendorId: f.vendor.id })).toEqual({ unlinked: 3, staleLinks: 1 });

    const result = await repairCourseChapterLinks(db, { vendorId: f.vendor.id });
    expect(result).toEqual({ coursesRepaired: 1, lessonsRelinked: 4, chaptersCreated: 3, failedCourses: [] });
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
    expect(await courseChapterLinkCounts(db, { vendorId: f.vendor.id })).toEqual({ unlinked: 0, staleLinks: 0 });

    // Idempotent.
    expect(await repairCourseChapterLinks(db, { vendorId: f.vendor.id })).toEqual({ coursesRepaired: 0, lessonsRelinked: 0, chaptersCreated: 0, failedCourses: [] });
  });

  it("stays inside its scope and keeps tenants apart", async () => {
    const a = await course();
    const b = await course();
    await legacyInsert(a, "第一章", "a");
    const other = await legacyInsert(b, "第一章", "b");
    await repairCourseChapterLinks(db, { vendorId: a.vendor.id, productId: a.product.id });
    expect((await db.courseLesson.findUniqueOrThrow({ where: { id: other } })).chapterId).toBeNull();
    expect(await courseChapterLinkCounts(db, { vendorId: b.vendor.id })).toEqual({ unlinked: 1, staleLinks: 0 });
    await repairCourseChapterLinks(db, { vendorId: b.vendor.id });
    const chapters = await db.courseChapter.findMany({ where: { vendorId: { in: [a.vendor.id, b.vendor.id] } }, select: { vendorId: true, productId: true, title: true } });
    expect(chapters).toHaveLength(2);
    for (const lesson of await db.courseLesson.findMany({ where: { vendorId: { in: [a.vendor.id, b.vendor.id] } }, select: { vendorId: true, productId: true, chapter: { select: { vendorId: true, productId: true } } } })) {
      expect(lesson.chapter).toEqual({ vendorId: lesson.vendorId, productId: lesson.productId });
    }
  });

  it("keeps scanning when the last lesson of a page is deleted during the scan (S-1)", async () => {
    const owner = await vendor();
    const first = await course(owner);
    const second = await course(owner);
    const prefix = `zz-repair-${randomUUID()}`;
    // Ids fix the scan order: first's lesson, then second's two lessons.
    const deleted = await legacyInsert(first, "第一章", "a", `${prefix}-1`);
    const b1 = await legacyInsert(second, "第一章", "b1", `${prefix}-2`);
    const b2 = await legacyInsert(second, "第二章", "b2", `${prefix}-3`);
    const result = await repairCourseChapterLinks(db, { vendorId: owner.id }, {
      scanBatchSize: 1,
      afterScanPage: async (lastLessonId) => {
        if (lastLessonId === deleted) await db.courseLesson.delete({ where: { id: deleted } });
      },
    });
    expect(result.failedCourses).toEqual([]);
    const linked = await db.courseLesson.findMany({ where: { id: { in: [b1, b2] } }, orderBy: { id: "asc" }, select: { chapter: { select: { title: true } } } });
    expect(linked.map((lesson) => lesson.chapter?.title)).toEqual(["第一章", "第二章"]);
    expect(await courseChapterLinkCounts(db, { vendorId: owner.id })).toEqual({ unlinked: 0, staleLinks: 0 });
  });

  it("reports a course whose transaction keeps expiring and continues with the next one (S-2)", async () => {
    const owner = await vendor();
    const first = await course(owner);
    const second = await course(owner);
    for (let index = 0; index < 30; index += 1) await legacyInsert(first, `第${index}章`, `a${index}`);
    await legacyInsert(second, "第一章", "b");
    // A 1 ms interactive transaction always expires (P2028) before it can commit.
    const expired = await repairCourseChapterLinks(db, { vendorId: owner.id }, { transactionTimeoutMs: 1, maxAttempts: 2 });
    expect(expired.coursesRepaired).toBe(0);
    expect(expired.failedCourses.map(({ productId, reason }) => [productId, reason]).sort()).toEqual([[first.product.id, "P2028"], [second.product.id, "P2028"]].sort());
    // Nothing was half-written; a normal rerun repairs both.
    expect(await courseChapterLinkCounts(db, { vendorId: owner.id })).toEqual({ unlinked: 31, staleLinks: 0 });
    const rerun = await repairCourseChapterLinks(db, { vendorId: owner.id });
    expect(rerun).toMatchObject({ coursesRepaired: 2, lessonsRelinked: 31, chaptersCreated: 31, failedCourses: [] });
  });

  it("uses the migration's trim pattern and the read-only checks documented for the NOT NULL step", () => {
    const migration = readFileSync(path.join(ROOT, "prisma/migrations/20261113120100_course_lesson_chapter_link/migration.sql"), "utf8");
    expect(migration).toContain(`'${COURSE_CHAPTER_TRIM_PATTERN}'`);
    const invariants = readFileSync(path.join(ROOT, "docs/codex-goal/PRISMA_INVARIANTS.md"), "utf8");
    expect(invariants).toContain(UNLINKED_COURSE_LESSONS_SQL);
    expect(invariants).toContain(STALE_COURSE_LESSON_LINKS_SQL);
  });
});
