import { createHash } from "node:crypto";
import { recordLearnerNotificationSourceEvent } from "./learner-notification-source-events";
import { Prisma, type PrismaClient } from "@prisma/client";
import { revealCommerceOrderPii } from "@/lib/commerce-order-pii";
import { courseCompletion, nextLessonProgress, type CourseLesson, type CourseLessonProgress } from "@/lib/course-learning";
import type { StudentPortalScope } from "@/lib/student-portal";

export type CourseLearningStore = Pick<Prisma.TransactionClient,
  "commerceOrderItem" | "product" | "courseLesson" | "courseLessonProgress">;
export type CourseLearningDatabase = CourseLearningStore & Pick<PrismaClient, "$transaction">;

export type StudentCourse = {
  course: { id: string; name: string; vendorName: string };
  lessons: Array<CourseLesson & { videoUrl: string | null }>;
  progress: CourseLessonProgress[];
  completion: ReturnType<typeof courseCompletion>;
};

function validScope(scope: StudentPortalScope) {
  if (!scope.vendorId || !scope.customerKeyHash) throw new Error("Tenant-qualified student identity is required.");
}

function safePublicVideoUrl(value: string | null) {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password ? url.toString() : null;
  } catch {
    return null;
  }
}

/** The access check is intentionally reused before every read, mutation, and certificate issue. */
async function authorizedCourseAccess(db: CourseLearningStore, scope: StudentPortalScope, courseId: string) {
  validScope(scope);
  if (!courseId || courseId.length > 160) return null;
  const orderItem = await db.commerceOrderItem.findFirst({
    where: {
      vendorId: scope.vendorId,
      productId: courseId,
      fulfillmentType: "course",
      entitlement: { is: { status: "granted", revokedAt: null, OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }] } },
      order: { is: { vendorId: scope.vendorId, automationCustomerKeyHash: scope.customerKeyHash, status: { in: ["paid", "partially_refunded"] } } },
    },
    select: { order: { select: { id: true, buyerEncryptedEnvelope: true, shippingEncryptedEnvelope: true } } },
  });
  if (!orderItem) return null;
  const course = await db.product.findFirst({
    where: { id: courseId, vendorId: scope.vendorId, fulfillmentType: "course" },
    select: { id: true, name: true, vendor: { select: { name: true } } },
  });
  return course ? { course, order: orderItem.order } : null;
}

export async function getStudentCourse(db: CourseLearningStore, scope: StudentPortalScope, courseId: string): Promise<StudentCourse | null> {
  const access = await authorizedCourseAccess(db, scope, courseId);
  if (!access) return null;
  const lessons = (await db.courseLesson.findMany({
    where: { vendorId: scope.vendorId, productId: courseId, publishedAt: { not: null } },
    orderBy: [{ position: "asc" }, { id: "asc" }],
    select: { id: true, chapterTitle: true, title: true, videoUrl: true, durationSeconds: true, position: true },
  })).map((lesson) => ({ ...lesson, videoUrl: safePublicVideoUrl(lesson.videoUrl) }));
  const progress = await db.courseLessonProgress.findMany({
    where: { vendorId: scope.vendorId, productId: courseId, customerKeyHash: scope.customerKeyHash },
    select: { lessonId: true, watchedSeconds: true, completedAt: true },
  });
  return {
    course: { id: access.course.id, name: access.course.name, vendorName: access.course.vendor.name },
    lessons,
    progress,
    completion: courseCompletion(lessons, progress),
  };
}

/** Recheck purchase rights in the same serializable transaction as progress.
 * Refund/revocation and concurrent checkpoints cannot commit stale access or
 * overwrite a newer completion. Only serialization/unique conflicts retry. */
export async function saveStudentLessonProgress(db: CourseLearningDatabase, scope: StudentPortalScope, input: {
  courseId: string; lessonId: string; watchedSeconds: number; markedComplete: boolean; now?: Date;
}) {
  validScope(scope);
  if (!input.lessonId || input.lessonId.length > 160) return null;
  const persist = () => db.$transaction(async (tx) => {
    const access = await authorizedCourseAccess(tx, scope, input.courseId);
    if (!access) return null;
    const lesson = await tx.courseLesson.findFirst({
      where: { id: input.lessonId, vendorId: scope.vendorId, productId: input.courseId, publishedAt: { not: null } },
      select: { id: true, chapterTitle: true, title: true, durationSeconds: true, position: true },
    });
    if (!lesson) return null;
    const identity = { vendorId: scope.vendorId, productId: input.courseId, lessonId: input.lessonId, customerKeyHash: scope.customerKeyHash };
    const existing = await tx.courseLessonProgress.findFirst({
      where: identity, select: { lessonId: true, watchedSeconds: true, completedAt: true },
    });
    const next = nextLessonProgress({ lesson, previous: existing, reportedWatchedSeconds: input.watchedSeconds, markedComplete: input.markedComplete, now: input.now });
    await tx.courseLessonProgress.upsert({
      where: { vendorId_lessonId_customerKeyHash: { vendorId: scope.vendorId, lessonId: input.lessonId, customerKeyHash: scope.customerKeyHash } },
      create: { ...identity, ...next }, update: {},
    });
    await tx.courseLessonProgress.updateMany({ where: { ...identity, watchedSeconds: { lt: next.watchedSeconds } }, data: { watchedSeconds: next.watchedSeconds } });
    if (next.completedAt) await tx.courseLessonProgress.updateMany({ where: { ...identity, completedAt: null }, data: { completedAt: next.completedAt } });

    if(next.completedAt){
      const course=await getStudentCourse(tx,scope,input.courseId);
      if(course?.completion.complete){
        const vendor=await tx.vendor.findUniqueOrThrow({where:{id:scope.vendorId},select:{slug:true}});
        const eventIdentity=createHash("sha256").update(JSON.stringify([input.courseId,scope.customerKeyHash,course.lessons.map(value=>value.id).sort()])).digest("hex");
        await recordLearnerNotificationSourceEvent(tx,{vendorId:scope.vendorId,productId:input.courseId,event:"course_completed",eventIdentity,audienceCustomerKeyHash:scope.customerKeyHash,occurredAt:input.now??new Date(),
          message:{title:"課程已完成",body:course.course.name,path:`/portal/${encodeURIComponent(vendor.slug)}/learn/${encodeURIComponent(input.courseId)}/certificate`}});
      }
    }
    return tx.courseLessonProgress.findFirst({ where: identity, select: { lessonId: true, watchedSeconds: true, completedAt: true } });
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try { return await persist(); }
    catch (error) {
      if (!(error instanceof Prisma.PrismaClientKnownRequestError) || !["P2002", "P2034"].includes(error.code) || attempt === 2) throw error;
    }
  }
  throw new Error("Progress transaction did not complete.");
}

/** Resolves the certificate name only after the same purchase entitlement check. */
export async function studentCertificateDetails(db: CourseLearningStore, scope: StudentPortalScope, courseId: string) {
  const access = await authorizedCourseAccess(db, scope, courseId);
  if (!access) return null;
  const course = await getStudentCourse(db, scope, courseId);
  if (!course?.completion.complete) return null;
  const lessonIds = new Set(course.lessons.map((lesson) => lesson.id));
  const completedAt = course.progress.filter((item) => lessonIds.has(item.lessonId)).reduce<Date | null>((latest, item) => !item.completedAt || (latest && latest > item.completedAt) ? latest : item.completedAt, null);
  if (!completedAt) return null;
  try {
    const pii = revealCommerceOrderPii({ buyerEncrypted: access.order.buyerEncryptedEnvelope, shippingEncrypted: access.order.shippingEncryptedEnvelope }, { vendorId: scope.vendorId, orderId: access.order.id });
    return { vendorName: course.course.vendorName, studentName: pii.buyer.name, courseName: course.course.name, completedAt };
  } catch {
    // Decryption failure must not downgrade authorization or issue a certificate.
    return null;
  }
}
