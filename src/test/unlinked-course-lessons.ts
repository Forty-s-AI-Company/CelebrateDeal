import { randomUUID } from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll } from "vitest";

/**
 * Q-14: "CourseLesson"."chapterId" is NOT NULL (20261117090200). The tests of
 * the migrations that repaired lessons written before that (F-5's backfill and
 * Q-14's repair) need such rows, so they lift the column constraint for their
 * own file and put it back afterwards. Vitest runs DB test files one at a time
 * (fileParallelism: false in vitest.config.ts), so no other file sees the
 * nullable column, and `afterAll` restoring NOT NULL fails loudly if a file
 * leaves a lesson without a chapter behind.
 *
 * The Prisma client treats chapterId and the chapter relation as required, so
 * a row without a chapter is written and read with SQL only.
 */
export function allowUnlinkedCourseLessons(db: Pick<PrismaClient, "$executeRawUnsafe">) {
  beforeAll(async () => {
    await db.$executeRawUnsafe(`ALTER TABLE "CourseLesson" ALTER COLUMN "chapterId" DROP NOT NULL`);
  });
  afterAll(async () => {
    await db.$executeRawUnsafe(`ALTER TABLE "CourseLesson" ALTER COLUMN "chapterId" SET NOT NULL`);
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
  return id;
}
