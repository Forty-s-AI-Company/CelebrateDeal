import { createHash } from "node:crypto";
import { Prisma, type PrismaClient } from "@prisma/client";
import { recordLearnerNotificationSourceEvent } from "./learner-notification-source-events";
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

export class CurriculumConflict extends Error {}

/** Manager authorization is required at the caller. Every resource is tenant scoped;
 * the existing product revision also protects parallel curriculum/product edits. */
export async function saveCourseLesson(db: PrismaClient, vendorId: string, raw: unknown) {
  if (!vendorId) throw new Error("Vendor identity is required.");
  const input = curriculumInput.parse(raw);
  return db.$transaction(async (tx) => {
    const claimed = await tx.product.updateMany({
      where: { id: input.productId, vendorId, fulfillmentType: "course", revision: input.revision },
      data: { revision: { increment: 1 } },
    });
    if (claimed.count !== 1) throw new CurriculumConflict("Course changed or is unavailable. Reload before saving.");
    const data = { chapterTitle: input.chapterTitle, title: input.title, videoUrl: input.videoUrl || null, durationSeconds: input.durationSeconds, publishedAt: input.published ? new Date() : null };
    if (input.lessonId) {
      const previous=await tx.courseLesson.findFirst({where:{id:input.lessonId,vendorId,productId:input.productId},select:{publishedAt:true}});
      if(!previous)throw new CurriculumConflict("Lesson is unavailable.");
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

async function recordPublished(tx:Prisma.TransactionClient,vendorId:string,productId:string,lessonId:string,title:string,occurredAt:Date){
 const vendor=await tx.vendor.findUniqueOrThrow({where:{id:vendorId},select:{slug:true}});
 await recordLearnerNotificationSourceEvent(tx,{vendorId,productId,event:"lesson_published",eventIdentity:createHash("sha256").update(JSON.stringify([lessonId,occurredAt.toISOString()])).digest("hex"),audienceCustomerKeyHash:null,occurredAt,
  message:{title:"課程新增單元",body:title,path:`/portal/${encodeURIComponent(vendor.slug)}/learn/${encodeURIComponent(productId)}`}});
}
