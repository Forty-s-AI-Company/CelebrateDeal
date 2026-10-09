import { Prisma, type PrismaClient } from "@prisma/client";
import { randomInt } from "node:crypto";
import { setTimeout as waitForRetry } from "node:timers/promises";
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
export async function authorizedCourseAccess(db: CourseLearningStore, scope: StudentPortalScope, courseId: string) {
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
    return tx.courseLessonProgress.findFirst({ where: identity, select: { lessonId: true, watchedSeconds: true, completedAt: true } });
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  const maxAttempts = 6;
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    try { return await persist(); }
    catch (error) {
      if (!(error instanceof Prisma.PrismaClientKnownRequestError) || !["P2002", "P2034"].includes(error.code) || attempt === maxAttempts - 1) throw error;
      // Let competing commits finish instead of immediately colliding again.
      // A bounded jittered delay stays outside the transaction; every retry
      // obtains a fresh snapshot and rechecks the same purchase entitlement.
      await waitForRetry(Math.min(25 * 2 ** attempt, 200) + randomInt(0, 25));
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
