import { createHash } from "node:crypto";
import { Prisma, type PrismaClient } from "@prisma/client";
import { learnerNotificationLink, safeLearnerNotificationLink } from "./learner-notification-links";
import { boundLearnerNotificationText, recordLearnerNotificationSourceEvent } from "./learner-notification-source-events";
import { z } from "zod";

export const curriculumInput = z.object({
  productId: z.string().min(1).max(160),
  lessonId: z.string().min(1).max(160).optional(),
  revision: z.number().int().nonnegative(),
  chapterTitle: z.string().trim().min(1).max(120),
  title: z.string().trim().min(1).max(180),
  videoUrl: z.string().max(2048).refine((value) => {
    if (!value) return true;
    try { const url = new URL(value); return url.protocol === "https:" && !url.username && !url.password; }
    catch { return false; }
  }),
  durationSeconds: z.number().int().min(0).max(86400),
  published: z.boolean(),
}).strict().refine((value) => !value.published || Boolean(value.videoUrl), { message: "Published lessons require a video URL." });

export const chapterRenameInput = z.object({
  productId: z.string().min(1).max(160),
  chapterId: z.string().min(1).max(160),
  revision: z.number().int().nonnegative(),
  title: z.string().trim().min(1).max(120),
}).strict();

export class CurriculumConflict extends Error {}
/** Another chapter of the same course already uses the requested title. */
export class ChapterTitleTaken extends Error {}

/** F-5: the chapter with this exact (already trimmed) title in this course, created
 * at the end of the course's chapter order when it does not exist yet. Runs inside
 * the caller's Serializable transaction, after the product revision CAS. */
async function findOrCreateChapter(tx: Prisma.TransactionClient, vendorId: string, productId: string, title: string) {
  const existing = await tx.courseChapter.findFirst({ where: { vendorId, productId, title }, select: { id: true } });
  if (existing) return existing.id;
  const last = await tx.courseChapter.aggregate({ where: { vendorId, productId }, _max: { position: true } });
  const chapter = await tx.courseChapter.create({
    data: { vendorId, productId, title, position: (last._max.position ?? -1) + 1 },
    select: { id: true },
  });
  return chapter.id;
}

/** Manager authorization is required at the caller. Every resource is tenant scoped;
 * the existing product revision also protects parallel curriculum/product edits.
 * A lesson moved to another chapter leaves its old chapter in place even when it is
 * now empty; learners never see an empty chapter because they only see chapters
 * through their published lessons. */
export async function saveCourseLesson(db: PrismaClient, vendorId: string, raw: unknown) {
  if (!vendorId) throw new Error("Vendor identity is required.");
  const input = curriculumInput.parse(raw);
  return db.$transaction(async (tx) => {
    const claimed = await tx.product.updateMany({
      where: { id: input.productId, vendorId, fulfillmentType: "course", revision: input.revision },
      data: { revision: { increment: 1 } },
    });
    if (claimed.count !== 1) throw new CurriculumConflict("Course changed or is unavailable. Reload before saving.");
    const previous = input.lessonId
      ? await tx.courseLesson.findFirst({ where: { id: input.lessonId, vendorId, productId: input.productId }, select: { publishedAt: true } })
      : null;
    if (input.lessonId && !previous) throw new CurriculumConflict("Lesson is unavailable.");
    // The chapter is resolved only after the lesson is known to belong to this
    // vendor and course; every query is bound to both.
    const chapterId = await findOrCreateChapter(tx, vendorId, input.productId, input.chapterTitle);
    const data = { chapterId, chapterTitle: input.chapterTitle, title: input.title, videoUrl: input.videoUrl || null, durationSeconds: input.durationSeconds, publishedAt: input.published ? new Date() : null };
    if (input.lessonId && previous) {
      const changed = await tx.courseLesson.updateMany({ where: { id: input.lessonId, vendorId, productId: input.productId }, data });
      if (changed.count !== 1) throw new CurriculumConflict("Lesson is unavailable.");
      if(input.published && !previous.publishedAt)await recordPublished(tx,vendorId,input.productId,input.lessonId,input.title,data.publishedAt!);
      return input.lessonId;
    }
    const last = await tx.courseLesson.aggregate({ where: { vendorId, productId: input.productId }, _max: { position: true } });
    const lesson = await tx.courseLesson.create({ data: { ...data, vendorId, productId: input.productId, position: (last._max.position ?? -1) + 1 } });
    if(input.published)await recordPublished(tx,vendorId,input.productId,lesson.id,input.title,data.publishedAt!);
    return lesson.id;
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}

/** F-5: renames one chapter of a course and rewrites `chapterTitle` on all of its
 * lessons in the same transaction. Manager authorization is required at the caller.
 * The product revision CAS serializes this with every other curriculum edit; a title
 * another chapter of the course already uses is rejected, never merged. */
export async function renameCourseChapter(db: PrismaClient, vendorId: string, raw: unknown) {
  if (!vendorId) throw new Error("Vendor identity is required.");
  const input = chapterRenameInput.parse(raw);
  return db.$transaction(async (tx) => {
    const claimed = await tx.product.updateMany({
      where: { id: input.productId, vendorId, fulfillmentType: "course", revision: input.revision },
      data: { revision: { increment: 1 } },
    });
    if (claimed.count !== 1) throw new CurriculumConflict("Course changed or is unavailable. Reload before saving.");
    const scope = { vendorId, productId: input.productId };
    const chapter = await tx.courseChapter.findFirst({ where: { ...scope, id: input.chapterId }, select: { id: true, title: true } });
    if (!chapter) throw new CurriculumConflict("Chapter is unavailable.");
    if (chapter.title !== input.title) {
      const taken = await tx.courseChapter.findFirst({ where: { ...scope, title: input.title, id: { not: chapter.id } }, select: { id: true } });
      if (taken) throw new ChapterTitleTaken("Another chapter of this course already uses this title.");
      const renamed = await tx.courseChapter.updateMany({ where: { ...scope, id: chapter.id }, data: { title: input.title } });
      if (renamed.count !== 1) throw new CurriculumConflict("Chapter is unavailable.");
    }
    // Also run when the title is unchanged: it repairs lessons whose chapterTitle
    // still carries the untrimmed text from before the F-5 backfill.
    await tx.courseLesson.updateMany({ where: { ...scope, chapterId: chapter.id }, data: { chapterTitle: input.title } });
    return chapter.id;
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}

/** Vendor-independent link; a deterministic notification failure is skipped
 * and reported instead of rolling back the lesson publication. */
async function recordPublished(tx:Prisma.TransactionClient,vendorId:string,productId:string,lessonId:string,title:string,occurredAt:Date){
 await recordLearnerNotificationSourceEvent(tx,{vendorId,productId,event:"lesson_published",eventIdentity:createHash("sha256").update(JSON.stringify([lessonId,occurredAt.toISOString()])).digest("hex"),audienceCustomerKeyHash:null,occurredAt,
  message:{title:"課程新增單元",body:boundLearnerNotificationText(title,2000,"課程新增單元"),path:safeLearnerNotificationLink(()=>learnerNotificationLink.course(vendorId,productId))}});
}
