import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { COURSE_CHAPTER_TRIM_PATTERN, STALE_COURSE_LESSON_LINKS_SQL, UNLINKED_COURSE_LESSONS_SQL, repairCourseChapterLinks } from "@/lib/course-chapter-repair";
import { courseChapters, legacyChapterTitle, type CourseLesson } from "@/lib/course-learning";
import { getDb } from "@/lib/db";
import { allowUnlinkedCourseLessons, insertRawCourseLesson } from "@/test/unlinked-course-lessons";

/**
 * Q-14: the three migrations that make "CourseLesson"."chapterId" NOT NULL.
 *
 * The repair block of 20261117090000 is read from the migration file and run
 * here unchanged, so the test and the deployed SQL are one text. Like the F-5
 * backfill it covers the whole table, which is safe because DB test files run
 * one at a time and every fixture deletes its vendors afterEach; every
 * assertion is limited to this file's vendors.
 *
 * Rows without a chapter need the column nullable again, so this file lifts
 * NOT NULL for itself (src/test/unlinked-course-lessons.ts). The Prisma client
 * cannot read such rows (the field is required), so snapshots use SQL.
 *
 * SQL vs TypeScript: repairCourseChapterLinks cannot load a lesson without a
 * chapter any more (the client treats the relation as required), so it is
 * compared on twins in which every NULL link is a stale link to a chapter both
 * twins have. The TypeScript repair handles NULL and stale links on one path
 * (needsRepair = !trustedChapterLink), and the SQL result for the twin with
 * NULLs must equal the SQL result and the TypeScript result for the stale twin.
 */
const MIGRATIONS = path.resolve(__dirname, "../../prisma/migrations");
const read = (name: string) => readFileSync(path.join(MIGRATIONS, name, "migration.sql"), "utf8");
const REPAIR_MIGRATION = read("20261117090000_course_lesson_chapter_repair");
const VALIDATE_MIGRATION = read("20261117090100_course_lesson_chapter_not_null_validate");
const NOT_NULL_MIGRATION = read("20261117090200_course_lesson_chapter_not_null");

function dollarBlock(sql: string, tag: string) {
  const start = sql.indexOf(`DO $${tag}$`);
  const endMarker = `$${tag}$;`;
  const end = sql.indexOf(endMarker, start + tag.length + 5);
  if (start < 0 || end < 0) throw new Error(`Block ${tag} is missing from the migration.`);
  return sql.slice(start, end + endMarker.length - 1);
}

const REPAIR = dollarBlock(REPAIR_MIGRATION, "course_lesson_chapter_repair");
const REPAIR_CHECK = dollarBlock(REPAIR_MIGRATION, "course_lesson_chapter_repair_check");
const REPAIR_SETTINGS = dollarBlock(REPAIR_MIGRATION, "course_lesson_chapter_repair_settings");
/** Statements of a migration file, comments removed. */
const statements = (sql: string) => sql.split(/\r?\n/u).filter((line) => !line.trim().startsWith("--")).join("\n");
const alterStatements = (sql: string) => statements(sql).match(/^ALTER TABLE [^;]+;/gmu) ?? [];

const db = getDb();
const vendors: string[] = [];
allowUnlinkedCourseLessons(db);

afterEach(async () => {
  await db.vendor.deleteMany({ where: { id: { in: vendors.splice(0) } } });
});

const runRepair = () => db.$executeRawUnsafe(REPAIR);

async function vendor(label: string) {
  const suffix = randomUUID();
  const row = await db.vendor.create({ data: { name: `Synthetic ${label} academy`, slug: `q14-${suffix}`, email: `${suffix}@example.test`, passwordHash: "synthetic-only" } });
  vendors.push(row.id);
  return row.id;
}

async function course(vendorId: string, name = "同名課程") {
  const product = await db.product.create({ data: { vendorId, name, slug: `course-${randomUUID()}`, priceCents: 10000, commerceDomain: "course", fulfillmentType: "course", isActive: true } });
  return { vendorId, productId: product.id };
}

type Scope = Awaited<ReturnType<typeof course>>;

const chapter = async (scope: Scope, title: string, position: number) => (await db.courseChapter.create({ data: { ...scope, title, position } })).id;

type LessonRow = {
  id: string; vendorId: string; productId: string; chapterId: string | null; chapterTitle: string; title: string; position: number;
  publishedAt: Date | null; durationSeconds: number; updatedAt: Date; linkTitle: string | null; linkPosition: number | null; linkVendorId: string | null; linkProductId: string | null;
};

async function lessonsOf(vendorIds: string[]) {
  return db.$queryRaw<LessonRow[]>`SELECT l."id", l."vendorId", l."productId", l."chapterId", l."chapterTitle", l."title", l."position", l."publishedAt", l."durationSeconds", l."updatedAt",
      c."title" AS "linkTitle", c."position" AS "linkPosition", c."vendorId" AS "linkVendorId", c."productId" AS "linkProductId"
    FROM "CourseLesson" AS l LEFT JOIN "CourseChapter" AS c ON c."id" = l."chapterId"
    WHERE l."vendorId" = ANY(${vendorIds}) ORDER BY l."vendorId", l."productId", l."position"`;
}

async function chaptersOf(scope: Scope) {
  return db.courseChapter.findMany({ where: scope, orderBy: { position: "asc" }, select: { id: true, title: true, position: true, updatedAt: true } });
}

/** What learners see: published lessons grouped by the player (links trusted the way Prisma loads them). */
function learnerTree(rows: readonly LessonRow[], scope: Scope) {
  const lessons = rows
    .filter((row) => row.vendorId === scope.vendorId && row.productId === scope.productId && row.publishedAt)
    .map((row) => ({ ...row, chapter: row.chapterId && row.linkVendorId === row.vendorId && row.linkProductId === row.productId ? { id: row.chapterId, title: row.linkTitle! } : null }));
  return courseChapters(lessons as unknown as CourseLesson[]).map((group) => [group.title, group.lessons.map((lesson) => lesson.id)]);
}

/** Every lesson linked to the chapter of its own course that its title names. */
function expectAllLinked(rows: readonly LessonRow[]) {
  for (const row of rows) {
    expect([row.id, row.linkVendorId, row.linkProductId, row.linkTitle]).toEqual([row.id, row.vendorId, row.productId, legacyChapterTitle(row.chapterTitle)]);
  }
}

async function readOnlyChecks(vendorIds: string[]) {
  const filter = (sql: string) => `${sql.replace('FROM "CourseLesson" WHERE', 'FROM "CourseLesson" AS lesson WHERE')} AND lesson."vendorId" = ANY($1)`;
  const count = async (sql: string) => Number((await db.$queryRawUnsafe<Array<{ count: bigint }>>(filter(sql), vendorIds))[0]?.count ?? 0);
  return { unlinked: await count(UNLINKED_COURSE_LESSONS_SQL), staleLinks: await count(STALE_COURSE_LESSON_LINKS_SQL) };
}

/** Cross-course links cannot be written through the composite foreign key; a
 * damaged row is simulated by skipping FK triggers for one statement (superuser,
 * as in CI and the disposable test database). */
async function linkAcrossCourses(lessonId: string, chapterId: string) {
  await db.$transaction([
    db.$executeRawUnsafe("SET LOCAL session_replication_role = replica"),
    db.$executeRaw`UPDATE "CourseLesson" SET "chapterId" = ${chapterId} WHERE "id" = ${lessonId}`,
  ]);
}

describe("Q-14 migration files", () => {
  it("repairs under one CourseLesson lock taken first, checks fail-closed, then adds the CHECK NOT VALID last", () => {
    // The DO blocks carry comment lines, so positions are taken in the file as written.
    const sql = REPAIR_MIGRATION;
    const order = [
      sql.indexOf("pg_catalog.set_config('lock_timeout', '5s', true)"),
      sql.indexOf('LOCK TABLE "CourseLesson" IN ACCESS EXCLUSIVE MODE;'),
      sql.indexOf(REPAIR_SETTINGS),
      sql.indexOf(REPAIR),
      sql.indexOf(REPAIR_CHECK),
      sql.indexOf('ALTER TABLE "CourseLesson" ADD CONSTRAINT "CourseLesson_chapterId_not_null_check" CHECK ("chapterId" IS NOT NULL) NOT VALID;'),
    ];
    for (const index of order) expect(index).toBeGreaterThan(-1);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(statements(sql)).not.toMatch(/LOCK TABLE "(?:Vendor|Product|CourseChapter)"|CREATE TABLE|DELETE FROM|DROP /u);
    expect(alterStatements(REPAIR_MIGRATION)).toHaveLength(1);
    expect(REPAIR_MIGRATION).toMatch(/-- BEGIN course_lesson_chapter_repair\r?\nDO \$course_lesson_chapter_repair\$/u);
    expect(REPAIR_MIGRATION).toMatch(/\$course_lesson_chapter_repair\$;\r?\n-- END course_lesson_chapter_repair/u);
  });

  it("uses the TypeScript trim rule and the documented read-only checks", () => {
    // Twice in the repair block (title, relink), once in the stale check.
    expect(REPAIR.split(`'${COURSE_CHAPTER_TRIM_PATTERN}'`)).toHaveLength(3);
    expect(REPAIR_CHECK.split(`'${COURSE_CHAPTER_TRIM_PATTERN}'`)).toHaveLength(2);
    expect(REPAIR_CHECK).toContain(UNLINKED_COURSE_LESSONS_SQL.replace('SELECT count(*) AS "count"', "SELECT count(*) INTO unlinked"));
    expect(REPAIR_CHECK).toContain(STALE_COURSE_LESSON_LINKS_SQL.replace('SELECT count(*) AS "count"', "SELECT count(*) INTO stale"));
    expect(REPAIR).toContain("'未分類章節'");
  });

  it("validates in its own file and sets NOT NULL in the next one, each behind a 5s lock timeout", () => {
    expect(alterStatements(VALIDATE_MIGRATION)).toEqual(['ALTER TABLE "CourseLesson" VALIDATE CONSTRAINT "CourseLesson_chapterId_not_null_check";']);
    expect(alterStatements(NOT_NULL_MIGRATION)).toEqual([
      'ALTER TABLE "CourseLesson" ALTER COLUMN "chapterId" SET NOT NULL;',
      'ALTER TABLE "CourseLesson" DROP CONSTRAINT "CourseLesson_chapterId_not_null_check";',
    ]);
    for (const sql of [VALIDATE_MIGRATION, NOT_NULL_MIGRATION]) {
      const body = statements(sql);
      expect(body.indexOf("pg_catalog.set_config('lock_timeout', '5s', true)")).toBeGreaterThan(-1);
      expect(body.indexOf("pg_catalog.set_config('lock_timeout', '5s', true)")).toBeLessThan(body.indexOf("ALTER TABLE"));
      expect(body).not.toMatch(/UPDATE |INSERT |DELETE |LOCK TABLE/u);
    }
  });

  it("refuses to repair unless backslash escapes reach the regex engine in a UTF8 database", async () => {
    await expect(db.$executeRawUnsafe(REPAIR_SETTINGS)).resolves.toBeDefined();
    await expect(db.$transaction(async (tx) => {
      await tx.$executeRawUnsafe("SET LOCAL standard_conforming_strings = off");
      await tx.$executeRawUnsafe(REPAIR_SETTINGS);
    })).rejects.toThrow(/standard_conforming_strings = on/u);
  });
});

describe("Q-14 repair (migration SQL)", () => {
  it("links NULL, stale, cross-course and missing-chapter lessons like repairCourseChapterLinks, keeping titles, order, learners' view and progress", async () => {
    const v = await vendor("repair");
    const c = await course(v);
    const other = await course(v, "另一門課");
    const first = await chapter(c, "第一章", 0);
    const second = await chapter(c, "第二章", 5); // a gap: new chapters follow the maximum
    const otherFirst = await chapter(other, "第一章", 0);
    const at = new Date("2026-11-01T00:00:00Z");
    const ids = {
      // Inserted out of position order: new chapters follow the first lesson by position, not by insertion.
      appendix: await insertRawCourseLesson(db, { ...c, position: 7, chapterTitle: "附錄", title: "appendix-late", chapterId: first, publishedAt: at }),
      ok: await insertRawCourseLesson(db, { ...c, position: 0, chapterTitle: "第一章", title: "ok", chapterId: first, publishedAt: at }),
      nullExisting: await insertRawCourseLesson(db, { ...c, position: 1, chapterTitle: " 第二章\u3000", title: "null-existing", publishedAt: at }),
      staleMissing: await insertRawCourseLesson(db, { ...c, position: 2, chapterTitle: "番外", title: "stale-missing", chapterId: second, publishedAt: at }),
      nullMissingUnpublished: await insertRawCourseLesson(db, { ...c, position: 3, chapterTitle: "附錄", title: "null-missing-unpublished" }),
      blank: await insertRawCourseLesson(db, { ...c, position: 4, chapterTitle: "\u3000", title: "blank", publishedAt: at }),
      crossCourse: await insertRawCourseLesson(db, { ...c, position: 5, chapterTitle: "第一章", title: "cross-course", chapterId: first, publishedAt: at }),
      okSecond: await insertRawCourseLesson(db, { ...c, position: 6, chapterTitle: "第二章", title: "ok-second", chapterId: second, publishedAt: at }),
    };
    await linkAcrossCourses(ids.crossCourse, otherFirst);
    await db.courseLessonProgress.createMany({ data: [
      { ...c, lessonId: ids.ok, customerKeyHash: "synthetic-learner", watchedSeconds: 60, completedAt: at },
      { ...c, lessonId: ids.crossCourse, customerKeyHash: "synthetic-learner", watchedSeconds: 30 },
      { ...c, lessonId: ids.nullExisting, customerKeyHash: "synthetic-learner", watchedSeconds: 10 },
    ] });
    const before = await lessonsOf([v]);
    const progressBefore = await db.courseLessonProgress.findMany({ where: { vendorId: v }, orderBy: { lessonId: "asc" } });
    const chaptersBefore = await chaptersOf(c);
    expect(await readOnlyChecks([v])).toEqual({ unlinked: 3, staleLinks: 2 });

    await runRepair();

    const after = await lessonsOf([v]);
    expectAllLinked(after);
    expect(await readOnlyChecks([v])).toEqual({ unlinked: 0, staleLinks: 0 });
    // Existing chapters untouched; new ones after the maximum (5), in first-lesson order.
    const chapters = await chaptersOf(c);
    expect(chapters.slice(0, 2)).toEqual(chaptersBefore);
    expect(chapters.map((row) => [row.title, row.position])).toEqual([["第一章", 0], ["第二章", 5], ["番外", 6], ["附錄", 7], ["未分類章節", 8]]);
    for (const row of chapters.slice(2)) expect(row.id).toMatch(/^chp_[0-9a-f]{32}$/u);
    expect((await chaptersOf(other)).map((row) => [row.id, row.title])).toEqual([[otherFirst, "第一章"]]);
    // Only links (and updatedAt of relinked lessons) change.
    const keep = ({ id, chapterTitle, title, position, publishedAt, durationSeconds }: LessonRow) => ({ id, chapterTitle, title, position, publishedAt, durationSeconds });
    expect(after.map(keep)).toEqual(before.map(keep));
    const relinked = new Set([ids.nullExisting, ids.staleMissing, ids.nullMissingUnpublished, ids.blank, ids.crossCourse, ids.appendix]);
    for (const row of after) {
      const old = before.find((lesson) => lesson.id === row.id)!;
      if (relinked.has(row.id)) expect(row.updatedAt.getTime()).toBeGreaterThanOrEqual(old.updatedAt.getTime());
      else expect([row.id, row.chapterId, row.updatedAt]).toEqual([old.id, old.chapterId, old.updatedAt]);
    }
    expect(after.find((row) => row.id === ids.crossCourse)?.chapterId).toBe(first);
    // Learners: same chapters, same lessons, same order; progress untouched.
    expect(learnerTree(after, c)).toEqual(learnerTree(before, c));
    expect(learnerTree(after, c)).toEqual([["第一章", [ids.ok, ids.crossCourse]], ["第二章", [ids.nullExisting, ids.okSecond]], ["番外", [ids.staleMissing]], ["未分類章節", [ids.blank]], ["附錄", [ids.appendix]]]);
    expect(await db.courseLessonProgress.findMany({ where: { vendorId: v }, orderBy: { lessonId: "asc" } })).toEqual(progressBefore);
  });

  it("matches the TypeScript repair's expected result for its own fixture, with NULL links", async () => {
    // course-chapter-repair.db.test.ts asserts this result for repairCourseChapterLinks.
    const v = await vendor("repair-fixture");
    const c = await course(v);
    const first = await chapter(c, "第一章", 0);
    const second = await chapter(c, "第二章", 1);
    await insertRawCourseLesson(db, { ...c, position: 0, chapterTitle: "第一章", title: "a", chapterId: first });
    await insertRawCourseLesson(db, { ...c, position: 1, chapterTitle: "番外", title: "b", chapterId: second });
    await insertRawCourseLesson(db, { ...c, position: 2, chapterTitle: " 第一章\u3000", title: "c" });
    await insertRawCourseLesson(db, { ...c, position: 3, chapterTitle: "附錄", title: "d" });
    await insertRawCourseLesson(db, { ...c, position: 4, chapterTitle: "\u3000", title: "e" });
    await runRepair();
    expect((await chaptersOf(c)).map((row) => ({ title: row.title, position: row.position }))).toEqual([{ title: "第一章", position: 0 }, { title: "第二章", position: 1 }, { title: "番外", position: 2 }, { title: "附錄", position: 3 }, { title: "未分類章節", position: 4 }]);
    expectAllLinked(await lessonsOf([v]));
  });

  it("keeps vendors and same-named courses apart", async () => {
    const a = await vendor("tenant-a");
    const b = await vendor("tenant-b");
    const a1 = await course(a);
    const a2 = await course(a);
    const b1 = await course(b);
    for (const scope of [a1, a2, b1]) {
      await insertRawCourseLesson(db, { ...scope, position: 0, chapterTitle: "第一章", title: "x" });
      await insertRawCourseLesson(db, { ...scope, position: 1, chapterTitle: "第二章", title: "y" });
    }
    await chapter(a2, "第二章", 3);
    await runRepair();
    expectAllLinked(await lessonsOf([a, b]));
    expect((await chaptersOf(a1)).map((row) => [row.title, row.position])).toEqual([["第一章", 0], ["第二章", 1]]);
    expect((await chaptersOf(a2)).map((row) => [row.title, row.position])).toEqual([["第二章", 3], ["第一章", 4]]);
    expect((await chaptersOf(b1)).map((row) => [row.title, row.position])).toEqual([["第一章", 0], ["第二章", 1]]);
  });

  it("can be rerun: a second run changes no row", async () => {
    const v = await vendor("rerun");
    const c = await course(v);
    const old = await chapter(c, "舊章節", 0);
    await insertRawCourseLesson(db, { ...c, position: 0, chapterTitle: "第一章", title: "a" });
    await insertRawCourseLesson(db, { ...c, position: 1, chapterTitle: "第二章", title: "b", chapterId: old });
    await runRepair();
    const lessons = await lessonsOf([v]);
    const chapters = await chaptersOf(c);
    await runRepair();
    await runRepair();
    expect(await lessonsOf([v])).toEqual(lessons);
    expect(await chaptersOf(c)).toEqual(chapters);
  });

  it("fails closed when a lesson is left unlinked or stale", async () => {
    const v = await vendor("check");
    const c = await course(v);
    await insertRawCourseLesson(db, { ...c, position: 0, chapterTitle: "第一章", title: "a" });
    await runRepair();
    await expect(db.$executeRawUnsafe(REPAIR_CHECK)).resolves.toBeDefined();
    // The check is table-wide (as deployed); one lesson of this vendor is enough.
    const late = await insertRawCourseLesson(db, { ...c, position: 1, chapterTitle: "第二章", title: "b" });
    await expect(db.$executeRawUnsafe(REPAIR_CHECK)).rejects.toThrow(/1 unlinked and 0 stale-linked/u);
    const [linked] = await chaptersOf(c);
    await db.$executeRaw`UPDATE "CourseLesson" SET "chapterId" = ${linked!.id} WHERE "id" = ${late}`;
    await expect(db.$executeRawUnsafe(REPAIR_CHECK)).rejects.toThrow(/0 unlinked and 1 stale-linked/u);
    await runRepair();
    await expect(db.$executeRawUnsafe(REPAIR_CHECK)).resolves.toBeDefined();
  });
});

/** Seeded PRNG so a failure can be replayed. */
function prng(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const TITLE_POOL = ["第一章", " 第一章", "第一章\u3000", "第二章", "\t第二章\n", "番外", "附錄", "\u00a0附錄\u2003", "\u3000", "Intro", "intro", "\ufeffIntro", "第 三 章"];
const PREVIOUS = "舊章節"; // never a lesson title in the pool: the target of every stale link

type LessonSpec = { position: number; chapterTitle: string; link: "own" | "stale" | "none"; staleTo: number; published: boolean };
type CourseSpec = { vendor: number; chapters: Array<{ title: string; position: number }>; lessons: LessonSpec[] };

function randomSpec(seed: number, vendorCount: number, courseCount: number): CourseSpec[] {
  const rand = prng(seed);
  const pick = <T,>(items: readonly T[]) => items[Math.floor(rand() * items.length)]!;
  return Array.from({ length: courseCount }, () => {
    const titles = [PREVIOUS, ...new Set(Array.from({ length: Math.floor(rand() * 4) }, () => legacyChapterTitle(pick(TITLE_POOL))))];
    let position = Math.floor(rand() * 3);
    const chapters = titles.sort(() => rand() - 0.5).map((title) => ({ title, position: (position += 1 + Math.floor(rand() * 3)) }));
    const lessons = Array.from({ length: Math.floor(rand() * 12) }, (_, index) => {
      const roll = rand();
      return { position: index * 2 + Math.floor(rand() * 2), chapterTitle: pick(TITLE_POOL), link: roll < 0.4 ? "own" : roll < 0.7 ? "stale" : "none", staleTo: Math.floor(rand() * chapters.length), published: rand() < 0.8 } as LessonSpec;
    }).sort(() => rand() - 0.5);
    return { vendor: Math.floor(rand() * vendorCount), chapters, lessons };
  });
}

/** Builds one twin. "null" keeps NULL links; "stale" links them to the course's PREVIOUS chapter instead. */
async function buildTwin(spec: CourseSpec[], vendorCount: number, mode: "null" | "stale") {
  const vendorIds = [];
  for (let index = 0; index < vendorCount; index += 1) vendorIds.push(await vendor(`twin-${mode}-${index}`));
  const scopes: Scope[] = [];
  for (const courseSpec of spec) {
    const scope = await course(vendorIds[courseSpec.vendor]!);
    scopes.push(scope);
    const chapterIds = new Map<string, string>();
    for (const row of courseSpec.chapters) chapterIds.set(row.title, await chapter(scope, row.title, row.position));
    for (const lesson of courseSpec.lessons) {
      const own = chapterIds.get(legacyChapterTitle(lesson.chapterTitle));
      const stale = chapterIds.get(courseSpec.chapters[lesson.staleTo]!.title)!;
      const chapterId = lesson.link === "own" ? own ?? stale : lesson.link === "stale" ? stale : mode === "stale" ? chapterIds.get(PREVIOUS)! : null;
      await insertRawCourseLesson(db, { ...scope, position: lesson.position, chapterTitle: lesson.chapterTitle, title: `p${lesson.position}`, chapterId, publishedAt: lesson.published ? new Date("2026-11-01T00:00:00Z") : null });
    }
  }
  return { vendorIds, scopes };
}

/** Id-free view of one twin, course by course in spec order. */
async function normalized(twin: Awaited<ReturnType<typeof buildTwin>>) {
  const rows = await lessonsOf(twin.vendorIds);
  return Promise.all(twin.scopes.map(async (scope) => ({
    chapters: (await chaptersOf(scope)).map((row) => [row.title, row.position]),
    lessons: rows.filter((row) => row.productId === scope.productId).map((row) => [row.position, row.chapterTitle, row.publishedAt !== null, row.linkTitle, row.linkPosition, row.linkProductId === scope.productId]),
    learner: learnerTree(rows, scope).map(([title, lessons]) => [title, (lessons as string[]).map((id) => rows.find((row) => row.id === id)!.position)]),
  })));
}

describe("Q-14 repair SQL vs repairCourseChapterLinks (TypeScript)", () => {
  for (const seed of [11, 2026, 1117]) {
    it(`gives the same chapters, links and learner view on random courses (seed ${seed})`, async () => {
      const vendorCount = 3;
      const spec = randomSpec(seed, vendorCount, 12);
      const withNulls = await buildTwin(spec, vendorCount, "null");
      const stale = await buildTwin(spec, vendorCount, "stale");
      const viaTypeScript = await buildTwin(spec, vendorCount, "stale");
      const learnerBefore = (await normalized(withNulls)).map((row) => row.learner);

      // TypeScript first, limited to its own vendors; then the SQL over the whole table.
      for (const vendorId of viaTypeScript.vendorIds) expect((await repairCourseChapterLinks(db, { vendorId })).failedCourses).toEqual([]);
      const typeScriptRows = await lessonsOf(viaTypeScript.vendorIds);
      const typeScriptChapters = await Promise.all(viaTypeScript.scopes.map(chaptersOf));
      await runRepair();

      // The SQL finds nothing left to do in the TypeScript result...
      expect(await lessonsOf(viaTypeScript.vendorIds)).toEqual(typeScriptRows);
      expect(await Promise.all(viaTypeScript.scopes.map(chaptersOf))).toEqual(typeScriptChapters);
      // ...the TypeScript repair finds nothing left in the SQL results...
      for (const vendorId of [...withNulls.vendorIds, ...stale.vendorIds]) expect(await repairCourseChapterLinks(db, { vendorId })).toEqual({ coursesRepaired: 0, lessonsRelinked: 0, chaptersCreated: 0, failedCourses: [] });
      // ...and all three end in the same state, which learners see as before.
      const expected = await normalized(viaTypeScript);
      expect(await normalized(stale)).toEqual(expected);
      expect(await normalized(withNulls)).toEqual(expected);
      expect(expected.map((row) => row.learner)).toEqual(learnerBefore);
      expectAllLinked(await lessonsOf([...withNulls.vendorIds, ...stale.vendorIds, ...viaTypeScript.vendorIds]));
    }, 60_000); // ~3 x 12 courses of fixtures, inserted one row at a time
  }
});

describe("Q-14 NOT NULL sequence (the migration statements as written)", () => {
  it("validates and sets NOT NULL only once nothing is unlinked, then drops the CHECK", async () => {
    const v = await vendor("sequence");
    const c = await course(v);
    await insertRawCourseLesson(db, { ...c, position: 0, chapterTitle: "第一章", title: "a" });
    const [addCheck] = alterStatements(REPAIR_MIGRATION);
    const [validate] = alterStatements(VALIDATE_MIGRATION);
    const [setNotNull, dropCheck] = alterStatements(NOT_NULL_MIGRATION);
    try {
      // NOT VALID does not scan existing rows, but rejects a new NULL at once.
      await db.$executeRawUnsafe(addCheck!);
      await expect(insertRawCourseLesson(db, { ...c, position: 1, chapterTitle: "第二章", title: "b" })).rejects.toThrow(/CourseLesson_chapterId_not_null_check/u);
      // VALIDATE (2/3) fails while a NULL remains; the CHECK stays NOT VALID.
      await expect(db.$executeRawUnsafe(validate!)).rejects.toThrow(/CourseLesson_chapterId_not_null_check/u);
      await runRepair();
      await db.$executeRawUnsafe(validate!);
      await db.$executeRawUnsafe(setNotNull!);
      await db.$executeRawUnsafe(dropCheck!);
      const [column] = await db.$queryRaw<Array<{ notNull: boolean }>>`SELECT attnotnull AS "notNull" FROM pg_attribute WHERE attrelid = '"CourseLesson"'::regclass AND attname = 'chapterId'`;
      expect(column?.notNull).toBe(true);
      await expect(insertRawCourseLesson(db, { ...c, position: 2, chapterTitle: "第二章", title: "c" })).rejects.toThrow(/23502/u);
    } finally {
      // Back to this file's state: no CHECK, column nullable (afterAll restores NOT NULL).
      await db.$executeRawUnsafe(`ALTER TABLE "CourseLesson" DROP CONSTRAINT IF EXISTS "CourseLesson_chapterId_not_null_check"`);
      await db.$executeRawUnsafe(`ALTER TABLE "CourseLesson" ALTER COLUMN "chapterId" DROP NOT NULL`);
    }
  });
});
