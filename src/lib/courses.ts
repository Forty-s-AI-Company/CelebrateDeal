import { Prisma } from "@prisma/client";
import { getDb } from "@/lib/db";
import { enqueueRegistrationConfirmation } from "@/lib/notifications";
import { safeCommerceUrlOrNull } from "@/lib/safe-commerce-url";
import { getVendorEntitlementDecision } from "@/lib/entitlements";

export type CourseDomainErrorCode =
  | "not_found"
  | "ownership_mismatch"
  | "invalid_state"
  | "publication_incomplete"
  | "session_unavailable"
  | "capacity_reached"
  | "blocked";

export class CourseDomainError extends Error {
  constructor(public readonly code: CourseDomainErrorCode, message: string) {
    super(message);
    this.name = "CourseDomainError";
  }
}

const COURSE_STATUSES = ["draft", "published", "archived"] as const;
const LESSON_STATUSES = ["draft", "published"] as const;
const SESSION_STATUSES = ["scheduled", "live", "ended", "canceled"] as const;

function oneOf<T extends readonly string[]>(value: string, allowed: T, error: string): T[number] {
  if (!allowed.includes(value as T[number])) throw new CourseDomainError("invalid_state", error);
  return value as T[number];
}

function optionalSafeImageUrl(value: string | null | undefined) {
  if (!value) return null;
  const url = safeCommerceUrlOrNull(value);
  if (!url) throw new CourseDomainError("invalid_state", "Course cover URL is not safe");
  return url;
}

export async function upsertCourse(input: {
  vendorId: string;
  id?: string | null;
  title: string;
  slug: string;
  description?: string | null;
  coverImageUrl?: string | null;
  registrationFormId?: string | null;
  defaultProductId?: string | null;
  status: string;
}) {
  const db = getDb();
  const status = oneOf(input.status, COURSE_STATUSES, "Unsupported course status");
  const coverImageUrl = optionalSafeImageUrl(input.coverImageUrl);
  return db.$transaction(async (tx) => {
    const [course, registrationForm, product] = await Promise.all([
      input.id
        ? tx.course.findFirst({
            where: { id: input.id, vendorId: input.vendorId },
            include: { _count: { select: { lessons: { where: { status: "published" } }, sessions: { where: { status: { not: "canceled" } } } } } },
          })
        : null,
      input.registrationFormId
        ? tx.registrationForm.findFirst({ where: { id: input.registrationFormId, vendorId: input.vendorId, isActive: true }, select: { id: true } })
        : null,
      input.defaultProductId
        ? tx.product.findFirst({ where: { id: input.defaultProductId, vendorId: input.vendorId, isActive: true }, select: { id: true } })
        : null,
    ]);
    if (input.id && !course) throw new CourseDomainError("not_found", "Course is not available");
    if (input.registrationFormId && !registrationForm || input.defaultProductId && !product) {
      throw new CourseDomainError("ownership_mismatch", "Course relations must belong to the current vendor");
    }
    if (status === "published") {
      if (!input.registrationFormId) throw new CourseDomainError("publication_incomplete", "Published course requires a registration form");
      if (!course || course._count.lessons + course._count.sessions === 0) {
        throw new CourseDomainError("publication_incomplete", "Published course requires a published lesson or active session");
      }
    }

    const data = {
      title: input.title,
      slug: input.slug,
      description: input.description ?? null,
      coverImageUrl,
      registrationFormId: input.registrationFormId ?? null,
      defaultProductId: input.defaultProductId ?? null,
      status,
      publishedAt: status === "published" ? course?.publishedAt ?? new Date() : null,
    };
    return course
      ? tx.course.update({ where: { id: course.id, vendorId: input.vendorId }, data })
      : tx.course.create({ data: { ...data, vendorId: input.vendorId } });
  });
}

export async function upsertCourseLesson(input: {
  vendorId: string;
  courseId: string;
  id?: string | null;
  videoId?: string | null;
  title: string;
  description?: string | null;
  sortOrder: number;
  status: string;
  isPreview: boolean;
}) {
  const status = oneOf(input.status, LESSON_STATUSES, "Unsupported lesson status");
  return getDb().$transaction(async (tx) => {
    const [course, lesson, video] = await Promise.all([
      tx.course.findFirst({ where: { id: input.courseId, vendorId: input.vendorId }, select: { id: true } }),
      input.id ? tx.courseLesson.findFirst({ where: { id: input.id, courseId: input.courseId, vendorId: input.vendorId }, select: { id: true } }) : null,
      input.videoId ? tx.video.findFirst({ where: { id: input.videoId, vendorId: input.vendorId }, select: { id: true, status: true } }) : null,
    ]);
    if (!course || input.id && !lesson) throw new CourseDomainError("not_found", "Course lesson is not available");
    if (input.videoId && !video) throw new CourseDomainError("ownership_mismatch", "Lesson video must belong to the current vendor");
    if (status === "published" && video && video.status !== "ready") {
      throw new CourseDomainError("publication_incomplete", "Published lesson video must be ready");
    }
    const data = {
      videoId: input.videoId ?? null,
      title: input.title,
      description: input.description ?? null,
      sortOrder: input.sortOrder,
      status,
      isPreview: input.isPreview,
    };
    return lesson
      ? tx.courseLesson.update({ where: { id: lesson.id, vendorId: input.vendorId }, data })
      : tx.courseLesson.create({ data: { ...data, vendorId: input.vendorId, courseId: input.courseId } });
  });
}

export async function upsertCourseSession(input: {
  vendorId: string;
  courseId: string;
  id?: string | null;
  liveId?: string | null;
  title: string;
  startsAt: Date;
  endsAt?: Date | null;
  status: string;
  capacity?: number | null;
}) {
  const status = oneOf(input.status, SESSION_STATUSES, "Unsupported course session status");
  if (input.endsAt && input.endsAt < input.startsAt) throw new CourseDomainError("invalid_state", "Session end must be after start");
  return getDb().$transaction(async (tx) => {
    const [course, session, live] = await Promise.all([
      tx.course.findFirst({ where: { id: input.courseId, vendorId: input.vendorId }, select: { id: true } }),
      input.id ? tx.courseSession.findFirst({ where: { id: input.id, courseId: input.courseId, vendorId: input.vendorId }, select: { id: true } }) : null,
      input.liveId ? tx.live.findFirst({ where: { id: input.liveId, vendorId: input.vendorId }, select: { id: true } }) : null,
    ]);
    if (!course || input.id && !session) throw new CourseDomainError("not_found", "Course session is not available");
    if (input.liveId && !live) throw new CourseDomainError("ownership_mismatch", "Session live must belong to the current vendor");
    const data = {
      liveId: input.liveId ?? null,
      title: input.title,
      startsAt: input.startsAt,
      endsAt: input.endsAt ?? null,
      status,
      capacity: input.capacity ?? null,
    };
    return session
      ? tx.courseSession.update({ where: { id: session.id, vendorId: input.vendorId }, data })
      : tx.courseSession.create({ data: { ...data, vendorId: input.vendorId, courseId: input.courseId } });
  });
}

export async function getPublicCourse(slug: string) {
  const course = await getDb().course.findFirst({
    where: { slug, status: "published" },
    include: {
      vendor: true,
      registrationForm: true,
      defaultProduct: true,
      lessons: { where: { status: "published" }, include: { video: true }, orderBy: { sortOrder: "asc" } },
      sessions: { where: { status: { in: ["scheduled", "live"] } }, include: { live: true }, orderBy: { startsAt: "asc" } },
    },
  });
  if (!course) return null;
  const entitlement = await getVendorEntitlementDecision(course.vendorId, "vendor_write");
  return entitlement.allowed ? course : null;
}

export async function enrollInCourse(input: {
  courseId: string;
  sessionId?: string | null;
  name: string;
  email: string;
  phone?: string | null;
  affiliateId?: string | null;
  attributionClickId?: string | null;
  referralCode?: string | null;
  now?: Date;
}) {
  const now = input.now ?? new Date();
  const email = input.email.trim().toLowerCase();
  const db = getDb();
  return db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT 1::int AS "locked" FROM pg_advisory_xact_lock(hashtextextended(${`course-enrollment:${input.courseId}:${email}`}, 0))`;
    if (input.sessionId) {
      await tx.$queryRaw`SELECT 1::int AS "locked" FROM pg_advisory_xact_lock(hashtextextended(${`course-session-capacity:${input.sessionId}`}, 0))`;
    }
    const course = await tx.course.findFirst({
      where: { id: input.courseId, status: "published" },
      include: { registrationForm: true },
    });
    if (!course) throw new CourseDomainError("not_found", "Course is not available");
    const subscription = await tx.vendorSubscription.findFirst({
      where: { vendorId: course.vendorId, startedAt: { lte: now } },
      orderBy: [{ startedAt: "desc" }, { createdAt: "desc" }],
    });
    const subscriptionActive = subscription
      && ["active", "trialing"].includes(subscription.status)
      && (!subscription.endedAt || subscription.endedAt > now)
      && (subscription.status !== "trialing" || Boolean(subscription.endedAt));
    if (!subscriptionActive) throw new CourseDomainError("not_found", "Course is not available");
    if (!course.registrationForm?.isActive) throw new CourseDomainError("invalid_state", "Course registration is not active");

    const [session, affiliate, attributionClick, blocked] = await Promise.all([
      input.sessionId
        ? tx.courseSession.findFirst({
            where: { id: input.sessionId, courseId: course.id, vendorId: course.vendorId, status: { in: ["scheduled", "live"] } },
            include: { _count: { select: { enrollments: { where: { status: "confirmed" } } } } },
          })
        : null,
      input.affiliateId
        ? tx.affiliate.findFirst({ where: { id: input.affiliateId, vendorId: course.vendorId, isActive: true }, select: { id: true, code: true } })
        : null,
      input.attributionClickId
        ? tx.affiliateClick.findFirst({
            where: {
              id: input.attributionClickId,
              vendorId: course.vendorId,
              affiliateId: input.affiliateId ?? undefined,
            },
            select: { id: true },
          })
        : null,
      tx.blacklist.findFirst({
        where: {
          vendorId: course.vendorId,
          isActive: true,
          OR: [
            { identifierType: "email", identifier: email },
            ...(input.phone ? [{ identifierType: "phone", identifier: input.phone }] : []),
          ],
        },
        select: { id: true },
      }),
    ]);
    if (input.sessionId && !session) throw new CourseDomainError("session_unavailable", "Course session is not available");
    if (input.affiliateId && !affiliate) throw new CourseDomainError("ownership_mismatch", "Course attribution is invalid");
    if (input.attributionClickId && !attributionClick) throw new CourseDomainError("ownership_mismatch", "Course attribution click is invalid");
    if (blocked) throw new CourseDomainError("blocked", "Enrollment is blocked");
    if (session?.capacity && session._count.enrollments >= session.capacity) throw new CourseDomainError("capacity_reached", "Course session is full");

    const existing = await tx.enrollment.findUnique({ where: { courseId_email: { courseId: course.id, email } } });
    const enrollment = existing
      ? existing.status === "canceled"
        ? await tx.enrollment.update({
            where: { id: existing.id },
            data: {
              sessionId: session?.id ?? null,
              affiliateId: affiliate?.id ?? null,
              attributionClickId: input.attributionClickId ?? null,
              referralCode: affiliate?.code ?? null,
              name: input.name,
              phone: input.phone ?? null,
              status: "confirmed",
              canceledAt: null,
              enrolledAt: now,
            },
          })
        : existing
      : await tx.enrollment.create({
          data: {
            vendorId: course.vendorId,
            courseId: course.id,
            sessionId: session?.id ?? null,
            affiliateId: affiliate?.id ?? null,
            attributionClickId: input.attributionClickId ?? null,
            referralCode: affiliate?.code ?? null,
            name: input.name,
            email,
            phone: input.phone ?? null,
            status: "confirmed",
          },
        });

    if (!existing || existing.status === "canceled") {
      await tx.analyticsEvent.create({
        data: {
          vendorId: course.vendorId,
          visitorId: email,
          eventType: "course_enrollment",
          payload: { courseId: course.id, sessionId: session?.id ?? null, referralCode: affiliate?.code ?? null },
        },
      });
      if (input.attributionClickId) {
        await tx.affiliateClick.updateMany({
          where: { id: input.attributionClickId, vendorId: course.vendorId, leadAt: null },
          data: { leadAt: now },
        });
      }
      await enqueueRegistrationConfirmation(tx, {
        vendorId: course.vendorId,
        submissionId: enrollment.id,
        recipient: enrollment.email,
        name: enrollment.name,
        liveTitle: course.title,
      });
    }

    return { enrollment, idempotentReplay: Boolean(existing && existing.status !== "canceled") };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted });
}
