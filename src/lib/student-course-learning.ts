import { Prisma } from "@prisma/client";
import { revealCommerceOrderPii } from "@/lib/commerce-order-pii";
import { courseCompletion, nextLessonProgress, type CourseLesson, type CourseLessonProgress } from "@/lib/course-learning";
import type { StudentPortalScope } from "@/lib/student-portal";

type CourseAccess = {
  course: { id: string; name: string; vendor: { name: string } };
  order: { id: string; buyerEncryptedEnvelope: string; shippingEncryptedEnvelope: string | null };
};

type CourseLearningStore = {
  commerceOrderItem: { findFirst(args: unknown): Promise<{ order: CourseAccess["order"] } | null> };
  product: { findFirst(args: unknown): Promise<CourseAccess["course"] | null> };
  courseLesson: { findMany(args: unknown): Promise<Array<CourseLesson & { videoUrl: string | null }>>; findFirst(args: unknown): Promise<CourseLesson | null> };
  courseLessonProgress: {
    findMany(args: unknown): Promise<CourseLessonProgress[]>;
    upsert(args: unknown): Promise<CourseLessonProgress>;
    updateMany(args: unknown): Promise<{ count: number }>;
  };
};

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
    where: { vendorId: scope.vendorId, productId: courseId },
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

export async function saveStudentLessonProgress(db: CourseLearningStore & {
  $transaction<T>(work: (tx: Pick<CourseLearningStore, "courseLessonProgress">) => Promise<T>): Promise<T>;
}, scope: StudentPortalScope, input: {
  courseId: string;
  lessonId: string;
  watchedSeconds: number;
  markedComplete: boolean;
  now?: Date;
}) {
  const access = await authorizedCourseAccess(db, scope, input.courseId);
  if (!access || !input.lessonId || input.lessonId.length > 160) return null;
  const lesson = await db.courseLesson.findFirst({
    where: { id: input.lessonId, vendorId: scope.vendorId, productId: input.courseId },
    select: { id: true, chapterTitle: true, title: true, durationSeconds: true, position: true },
  });
  if (!lesson) return null;
  const existing = (await db.courseLessonProgress.findMany({
    where: { vendorId: scope.vendorId, productId: input.courseId, lessonId: input.lessonId, customerKeyHash: scope.customerKeyHash },
    take: 1,
    select: { lessonId: true, watchedSeconds: true, completedAt: true },
  }))[0] ?? null;
  const next = nextLessonProgress({ lesson, previous: existing, reportedWatchedSeconds: input.watchedSeconds, markedComplete: input.markedComplete, now: input.now });
  const identity = { vendorId: scope.vendorId, productId: input.courseId, lessonId: input.lessonId, customerKeyHash: scope.customerKeyHash };
  const persist = () => db.$transaction(async (tx) => {
    await tx.courseLessonProgress.upsert({
      where: { vendorId_lessonId_customerKeyHash: { vendorId: scope.vendorId, lessonId: input.lessonId, customerKeyHash: scope.customerKeyHash } },
      create: { vendorId: scope.vendorId, productId: input.courseId, lessonId: input.lessonId, customerKeyHash: scope.customerKeyHash, ...next },
      // Concurrent stale saves must never replace a newer checkpoint.
      update: {},
      select: { lessonId: true, watchedSeconds: true, completedAt: true },
    });
    await tx.courseLessonProgress.updateMany({
      where: { ...identity, watchedSeconds: { lt: next.watchedSeconds } },
      data: { watchedSeconds: next.watchedSeconds },
    });
    if (next.completedAt) {
      await tx.courseLessonProgress.updateMany({
        where: { ...identity, completedAt: null },
        data: { completedAt: next.completedAt },
      });
    }
    return (await tx.courseLessonProgress.findMany({
      where: identity, take: 1,
      select: { lessonId: true, watchedSeconds: true, completedAt: true },
    }))[0] ?? null;
  });
  try {
    return await persist();
  } catch (error) {
    // A unique collision aborts PostgreSQL's transaction. Retry once in a fresh
    // transaction after rollback; never continue using the aborted connection.
    if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== "P2002") throw error;
    return persist();
  }
}

/** Resolves the certificate name only after the same purchase entitlement check. */
export async function studentCertificateDetails(db: CourseLearningStore, scope: StudentPortalScope, courseId: string) {
  const access = await authorizedCourseAccess(db, scope, courseId);
  if (!access) return null;
  const course = await getStudentCourse(db, scope, courseId);
  if (!course?.completion.complete) return null;
  const completedAt = course.progress.reduce<Date | null>((latest, item) => !item.completedAt || (latest && latest > item.completedAt) ? latest : item.completedAt, null);
  if (!completedAt) return null;
  try {
    const pii = revealCommerceOrderPii({ buyerEncrypted: access.order.buyerEncryptedEnvelope, shippingEncrypted: access.order.shippingEncryptedEnvelope }, { vendorId: scope.vendorId, orderId: access.order.id });
    return { vendorName: course.course.vendorName, studentName: pii.buyer.name, courseName: course.course.name, completedAt };
  } catch {
    // Decryption failure must not downgrade authorization or issue a certificate.
    return null;
  }
}
