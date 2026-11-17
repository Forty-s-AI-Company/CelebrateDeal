import { randomUUID } from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll } from "vitest";

/**
 * Q-14: "CourseLesson"."chapterId" is NOT NULL (20261117090200). The tests of
 * the migrations that repaired lessons written before that (F-5's backfill and
 * Q-14's repair) need such rows, so they lift the column constraint for their
 * own file and put it back afterwards. Vitest runs DB test files one at a time
 * (fileParallelism: false in vitest.config.ts), so no other file sees the
 * nullable column.
 *
 * The Prisma client treats chapterId and the chapter relation as required, so
 * a row without a chapter is written and read with SQL only.
 *
 * A real `prisma migrate deploy` of the three Q-14 migrations onto a database
 * stopped at 20261114120000 would need its own disposable PostgreSQL per run
 * (scripts/prisma-loopback-disposable-migration-runner.mjs starts a Docker
 * container), which the DB test jobs do not provide; that run is recorded in
 * docs/codex-goal/PRISMA_INVARIANTS.md instead.
 */
const MANUAL_RECOVERY = `Restore the test database by hand: DELETE FROM "CourseLesson" WHERE "chapterId" IS NULL; ALTER TABLE "CourseLesson" ALTER COLUMN "chapterId" SET NOT NULL; (or recreate it with prisma migrate deploy).`;

type RawDb = Pick<PrismaClient, "$executeRaw" | "$executeRawUnsafe" | "$queryRaw">;

/** Lessons this file inserted with SQL (one module instance per test file). */
const insertedIds = new Set<string>();

async function chapterIdIsNotNull(db: RawDb) {
  const [column] = await db.$queryRaw<Array<{ notNull: boolean }>>`SELECT attnotnull AS "notNull" FROM pg_attribute WHERE attrelid = '"CourseLesson"'::regclass AND attname = 'chapterId' AND NOT attisdropped`;
  if (!column) throw new Error('"CourseLesson"."chapterId" is missing: apply the migrations to the test database first.');
  return column.notNull;
}

export function allowUnlinkedCourseLessons(db: RawDb) {
  beforeAll(async () => {
    // The column must be in its migrated state; a nullable column here means an
    // earlier run did not restore it, and this file would hide that.
    if (!(await chapterIdIsNotNull(db))) {
      throw new Error(`"CourseLesson"."chapterId" is already nullable before this file ran (an earlier test run did not restore it). ${MANUAL_RECOVERY}`);
    }
    await db.$executeRawUnsafe(`ALTER TABLE "CourseLesson" ALTER COLUMN "chapterId" DROP NOT NULL`);
  });
  afterAll(async () => {
    // Remove what this file left without a chapter (fixtures normally delete
    // their vendors first), then put the constraint back.
    const ids = [...insertedIds];
    insertedIds.clear();
    if (ids.length) await db.$executeRaw`DELETE FROM "CourseLesson" WHERE "chapterId" IS NULL AND "id" = ANY(${ids})`;
    try {
      await db.$executeRawUnsafe(`ALTER TABLE "CourseLesson" ALTER COLUMN "chapterId" SET NOT NULL`);
    } catch (error) {
      const [left] = await db.$queryRaw<Array<{ count: bigint }>>`SELECT count(*) AS "count" FROM "CourseLesson" WHERE "chapterId" IS NULL`;
      throw new Error(`Could not restore NOT NULL on "CourseLesson"."chapterId" (${String(left?.count ?? "?")} lesson(s) without a chapter remain). ${MANUAL_RECOVERY}`, { cause: error });
    }
  });
}

export type RawCourseLessonInput = {
  id?: string;
  vendorId: string;
  productId: string;
  /** null: a lesson written before F-5 (no chapter link). */
  chapterId?: string | null;
  chapterTitle: string;
  title: string;
  position: number;
  durationSeconds?: number;
  publishedAt?: Date | null;
};

/** Inserts a lesson with SQL, as code older than F-5 wrote it. Returns its id. */
export async function insertRawCourseLesson(db: Pick<PrismaClient, "$executeRaw">, input: RawCourseLessonInput) {
  const id = input.id ?? `lsn_${randomUUID().replaceAll("-", "")}`;
  await db.$executeRaw`INSERT INTO "CourseLesson" ("id", "vendorId", "productId", "chapterId", "chapterTitle", "title", "durationSeconds", "position", "publishedAt", "updatedAt")
    VALUES (${id}, ${input.vendorId}, ${input.productId}, ${input.chapterId ?? null}, ${input.chapterTitle}, ${input.title}, ${input.durationSeconds ?? 60}, ${input.position}, ${input.publishedAt ?? null}::timestamp(3), CURRENT_TIMESTAMP)`;
  insertedIds.add(id);
  return id;
}
