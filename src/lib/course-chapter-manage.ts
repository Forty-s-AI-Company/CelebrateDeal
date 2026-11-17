import { Prisma, type PrismaClient } from "@prisma/client";
import { z } from "zod";
import { CurriculumConflict, findOrCreateChapter } from "./course-curriculum";
import { lessonChapterTitle, managerChapterGroups } from "./course-learning";

/** The chapter still holds lessons (by chapterId or by title), so it cannot be deleted. */
export class ChapterNotEmpty extends Error {}

/** Thrown inside a transaction to roll it back (so the revision is not bumped) when the
 * request turns out to change nothing. */
class NoChange extends Error {}

const ids = {
  productId: z.string().min(1).max(160),
  revision: z.number().int().nonnegative(),
};

export const chapterMoveInput = z.object({ ...ids, chapterId: z.string().min(1).max(160), direction: z.enum(["up", "down"]) }).strict();
export const chapterDeleteInput = z.object({ ...ids, chapterId: z.string().min(1).max(160) }).strict();
export const lessonMoveInput = z.object({ ...ids, lessonId: z.string().min(1).max(160), targetChapterId: z.string().min(1).max(160) }).strict();

type Scope = { vendorId: string; productId: string };

/** The same product revision CAS the other curriculum edits use: it serializes this
 * with every curriculum or product edit and rejects a stale form. */
async function claimCourse(tx: Prisma.TransactionClient, vendorId: string, productId: string, revision: number) {
  const claimed = await tx.product.updateMany({
    where: { id: productId, vendorId, fulfillmentType: "course", revision },
    data: { revision: { increment: 1 } },
  });
  if (claimed.count !== 1) throw new CurriculumConflict("Course changed or is unavailable. Reload before saving.");
}

/** Positions are unique per course. Rows are first lifted above every current value
 * (one statement, no collision), then written to 0..n-1 in one statement; the final
 * values are all below the lifted ones, so no intermediate state collides. `ordered`
 * must be every row of the course; a miscount aborts the transaction. */
async function rewritePositions(
  tx: Prisma.TransactionClient,
  table: "CourseChapter" | "CourseLesson",
  scope: Scope,
  current: ReadonlyArray<{ id: string; position: number }>,
  ordered: readonly string[],
) {
  if (ordered.length === current.length && ordered.every((id, index) => current.find((row) => row.id === id)?.position === index)) return;
  const offset = current.reduce((max, row) => Math.max(max, row.position), -1) + 1;
  const lift = { where: scope, data: { position: { increment: offset } } };
  if (table === "CourseChapter") await tx.courseChapter.updateMany(lift);
  else await tx.courseLesson.updateMany(lift);
  const positions = ordered.map((_, index) => index);
  const tableSql = table === "CourseChapter" ? Prisma.sql`"CourseChapter"` : Prisma.sql`"CourseLesson"`;
  const written = await tx.$executeRaw`
    UPDATE ${tableSql} AS target SET "position" = rows.position
    FROM unnest(${[...ordered]}::text[], ${positions}::int[]) AS rows(id, position)
    WHERE target."vendorId" = ${scope.vendorId} AND target."productId" = ${scope.productId} AND target."id" = rows.id`;
  if (written !== ordered.length) throw new CurriculumConflict("Course changed or is unavailable. Reload before saving.");
}

/** Lesson positions follow chapter order: every chapter's lessons stay together, in
 * their current order, chapters in `CourseChapter.position` order, lessons whose
 * title names no chapter row last. The learner player orders chapters by their first
 * visible lesson, so this is what makes chapter order reach learners. `lastLessonId`
 * is placed at the end of its chapter. Progress is keyed by lesson id and unaffected. */
async function resequenceLessons(tx: Prisma.TransactionClient, scope: Scope, lastLessonId?: string) {
  const chapters = await tx.courseChapter.findMany({ where: scope, orderBy: [{ position: "asc" }, { id: "asc" }], select: { id: true, title: true } });
  const lessons = await tx.courseLesson.findMany({ where: scope, select: { id: true, position: true, chapterTitle: true } });
  const groups = managerChapterGroups(chapters, lessons);
  const ordered = [...groups.chapters, ...groups.unlinked].flatMap((group) => [
    ...group.lessons.filter((lesson) => lesson.id !== lastLessonId),
    ...group.lessons.filter((lesson) => lesson.id === lastLessonId),
  ]).map((lesson) => lesson.id);
  if (ordered.length !== lessons.length) throw new CurriculumConflict("Course changed or is unavailable. Reload before saving.");
  await rewritePositions(tx, "CourseLesson", scope, lessons, ordered);
}

/** Runs `work` in a Serializable transaction. A `NoChange` rolls the transaction back,
 * so the revision is not consumed, and the result is false. */
async function transact<T>(db: PrismaClient, work: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T | false> {
  try {
    return await db.$transaction(work, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  } catch (failure) {
    if (failure instanceof NoChange) return false;
    throw failure;
  }
}

/** Moves one chapter a step up or down. Manager authorization is required at the
 * caller. Chapter and lesson positions are rewritten in the same transaction.
 * Returns false (nothing written, revision untouched) when the chapter is already at that end. */
export async function moveCourseChapter(db: PrismaClient, vendorId: string, raw: unknown) {
  if (!vendorId) throw new Error("Vendor identity is required.");
  const input = chapterMoveInput.parse(raw);
  return transact(db, async (tx) => {
    await claimCourse(tx, vendorId, input.productId, input.revision);
    const scope = { vendorId, productId: input.productId };
    const chapters = await tx.courseChapter.findMany({ where: scope, orderBy: [{ position: "asc" }, { id: "asc" }], select: { id: true, position: true } });
    const index = chapters.findIndex((chapter) => chapter.id === input.chapterId);
    if (index < 0) throw new CurriculumConflict("Chapter is unavailable.");
    const neighbour = input.direction === "up" ? index - 1 : index + 1;
    if (neighbour < 0 || neighbour >= chapters.length) throw new NoChange();
    const order = chapters.map((chapter) => chapter.id);
    [order[index], order[neighbour]] = [order[neighbour]!, order[index]!];
    await rewritePositions(tx, "CourseChapter", scope, chapters, order);
    await resequenceLessons(tx, scope);
    return true;
  });
}

/** Deletes an empty chapter only. A chapter counts as holding a lesson when the lesson
 * is linked to it or its title names it (the membership rule of `lessonChapterTitle`);
 * the composite foreign key (RESTRICT) backs this up. Never touches lessons or progress. */
export async function deleteCourseChapter(db: PrismaClient, vendorId: string, raw: unknown) {
  if (!vendorId) throw new Error("Vendor identity is required.");
  const input = chapterDeleteInput.parse(raw);
  return transact(db, async (tx) => {
    await claimCourse(tx, vendorId, input.productId, input.revision);
    const scope = { vendorId, productId: input.productId };
    const chapter = await tx.courseChapter.findFirst({ where: { ...scope, id: input.chapterId }, select: { id: true, title: true } });
    if (!chapter) throw new CurriculumConflict("Chapter is unavailable.");
    // A lesson linked to this chapter whose title names another chapter is a stale link
    // (pre-F-5 code changed the title only). It does not belong here: relink it to the
    // chapter its title names, the same way repairCourseChapterLinks does, then re-check.
    const linked = await tx.courseLesson.findMany({ where: { ...scope, chapterId: chapter.id }, select: { id: true, chapterTitle: true } });
    const stale = new Map<string, string[]>();
    for (const lesson of linked) {
      const title = lessonChapterTitle(lesson);
      if (title !== chapter.title) stale.set(title, [...(stale.get(title) ?? []), lesson.id]);
    }
    for (const [title, lessonIds] of stale) {
      const owner = await findOrCreateChapter(tx, vendorId, input.productId, title);
      await tx.courseLesson.updateMany({ where: { ...scope, id: { in: lessonIds }, chapterId: chapter.id }, data: { chapterId: owner } });
    }
    const lessons = await tx.courseLesson.findMany({ where: scope, select: { chapterId: true, chapterTitle: true } });
    if (lessons.some((lesson) => lesson.chapterId === chapter.id || lessonChapterTitle(lesson) === chapter.title)) throw new ChapterNotEmpty("Move the lessons out of this chapter first.");
    const deleted = await tx.courseChapter.deleteMany({ where: { ...scope, id: chapter.id } });
    if (deleted.count !== 1) throw new CurriculumConflict("Chapter is unavailable.");
    return chapter.id;
  });
}

/** Moves a lesson to the end of another chapter of the same course. Lesson and chapter
 * are both looked up with the vendor and the course, so neither can come from another
 * course or tenant. Returns false when the lesson already belongs to that chapter: nothing is written
 * (and the revision untouched), except that a missing or stale link is repaired. */
export async function moveCourseLesson(db: PrismaClient, vendorId: string, raw: unknown) {
  if (!vendorId) throw new Error("Vendor identity is required.");
  const input = lessonMoveInput.parse(raw);
  return transact(db, async (tx) => {
    await claimCourse(tx, vendorId, input.productId, input.revision);
    const scope = { vendorId, productId: input.productId };
    const target = await tx.courseChapter.findFirst({ where: { ...scope, id: input.targetChapterId }, select: { id: true, title: true } });
    const lesson = await tx.courseLesson.findFirst({ where: { ...scope, id: input.lessonId }, select: { id: true, chapterId: true, chapterTitle: true } });
    if (!target || !lesson) throw new CurriculumConflict("Chapter or lesson is unavailable.");
    if (lessonChapterTitle(lesson) === target.title) {
      if (lesson.chapterId === target.id) throw new NoChange();
      await tx.courseLesson.updateMany({ where: { ...scope, id: lesson.id }, data: { chapterId: target.id, chapterTitle: target.title } });
      return false;
    }
    const moved = await tx.courseLesson.updateMany({ where: { ...scope, id: lesson.id }, data: { chapterId: target.id, chapterTitle: target.title } });
    if (moved.count !== 1) throw new CurriculumConflict("Lesson is unavailable.");
    await resequenceLessons(tx, scope, lesson.id);
    return true;
  });
}
