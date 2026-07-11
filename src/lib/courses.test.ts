import { afterEach, describe, expect, it } from "vitest";
import { getDb } from "@/lib/db";
import {
  CourseDomainError,
  enrollInCourse,
  getPublicCourse,
  upsertCourse,
  upsertCourseLesson,
  upsertCourseSession,
} from "@/lib/courses";

const vendorIds: string[] = [];
const planIds: string[] = [];

async function createFixture(label: string) {
  const suffix = `${label}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const plan = await getDb().billingPlan.create({
    data: { name: `Course plan ${label}`, code: `course-plan-${suffix}`, includedEvents: 10, includedAffiliates: 10, includedStorageMinutes: 1000, includedCredits: 1000 },
  });
  planIds.push(plan.id);
  const vendor = await getDb().vendor.create({
    data: {
      name: `Course ${label}`,
      slug: `course-vendor-${suffix}`,
      email: `course-${suffix}@example.test`,
      passwordHash: "test",
      forms: { create: { name: "Course form", slug: `course-form-${suffix}`, headline: "Join", fields: [] } },
      videos: { create: { title: "Course video", videoUrl: "https://example.test/course.mp4" } },
      templates: {
        create: {
          name: "Course confirmation",
          channel: "email",
          trigger: "registration_confirmed",
          subject: "{{live_title}} 報名成功",
          body: "{{name}} 已完成 {{live_title}} 報名。",
        },
      },
      subscriptions: { create: { planId: plan.id, status: "active" } },
      usageLimit: { create: { billingPlanId: plan.id, streamMinutesLimit: 1000, storageMinutesLimit: 1000, creditsLimit: 1000, notificationEmailsLimit: 100, resetAt: new Date(Date.now() + 86_400_000) } },
    },
    include: { forms: true, videos: true },
  });
  vendorIds.push(vendor.id);
  return { vendor, form: vendor.forms[0], video: vendor.videos[0], suffix };
}

async function createPublishedCourse(label: string) {
  const fixture = await createFixture(label);
  const course = await upsertCourse({
    vendorId: fixture.vendor.id,
    title: `Published ${label}`,
    slug: `published-${fixture.suffix}`,
    registrationFormId: fixture.form.id,
    status: "draft",
  });
  await upsertCourseLesson({
    vendorId: fixture.vendor.id,
    courseId: course.id,
    videoId: fixture.video.id,
    title: "Lesson 1",
    sortOrder: 1,
    status: "published",
    isPreview: true,
  });
  const published = await upsertCourse({
    vendorId: fixture.vendor.id,
    id: course.id,
    title: course.title,
    slug: course.slug,
    registrationFormId: fixture.form.id,
    status: "published",
  });
  return { ...fixture, course: published };
}

afterEach(async () => {
  const vendors = vendorIds.splice(0);
  await getDb().auditLog.deleteMany({ where: { vendorId: { in: vendors } } });
  await getDb().vendor.deleteMany({ where: { id: { in: vendors } } });
  await getDb().billingPlan.deleteMany({ where: { id: { in: planIds.splice(0) } } });
});

describe("course vertical slice", () => {
  it("rejects foreign form and lesson video relations", async () => {
    const current = await createFixture("current");
    const foreign = await createFixture("foreign");
    await expect(upsertCourse({
      vendorId: current.vendor.id,
      title: "Wrong relation",
      slug: `wrong-${current.suffix}`,
      registrationFormId: foreign.form.id,
      status: "draft",
    })).rejects.toMatchObject({ code: "ownership_mismatch" });

    const course = await upsertCourse({
      vendorId: current.vendor.id,
      title: "Current course",
      slug: `current-${current.suffix}`,
      registrationFormId: current.form.id,
      status: "draft",
    });
    await expect(upsertCourseLesson({
      vendorId: current.vendor.id,
      courseId: course.id,
      videoId: foreign.video.id,
      title: "Foreign video",
      sortOrder: 1,
      status: "published",
      isPreview: false,
    })).rejects.toMatchObject({ code: "ownership_mismatch" });
  });

  it("requires registration and content before publication", async () => {
    const fixture = await createFixture("publication");
    const course = await upsertCourse({
      vendorId: fixture.vendor.id,
      title: "Draft",
      slug: `draft-${fixture.suffix}`,
      registrationFormId: fixture.form.id,
      status: "draft",
    });
    await expect(upsertCourse({
      vendorId: fixture.vendor.id,
      id: course.id,
      title: course.title,
      slug: course.slug,
      registrationFormId: fixture.form.id,
      status: "published",
    })).rejects.toBeInstanceOf(CourseDomainError);
    await expect(getPublicCourse(course.slug)).resolves.toBeNull();
  });

  it("rejects publishing a lesson while its video is still processing", async () => {
    const fixture = await createFixture("processing-video");
    const course = await upsertCourse({
      vendorId: fixture.vendor.id,
      title: "Processing lesson",
      slug: `processing-${fixture.suffix}`,
      registrationFormId: fixture.form.id,
      status: "draft",
    });
    await getDb().video.update({ where: { id: fixture.video.id }, data: { status: "processing" } });
    await expect(upsertCourseLesson({
      vendorId: fixture.vendor.id,
      courseId: course.id,
      videoId: fixture.video.id,
      title: "Not ready",
      sortOrder: 1,
      status: "published",
      isPreview: true,
    })).rejects.toMatchObject({ code: "publication_incomplete" });
  });

  it("creates one enrollment and notification without payment or commission", async () => {
    const fixture = await createPublishedCourse("enrollment");
    const first = await enrollInCourse({ courseId: fixture.course.id, name: "Student", email: "STUDENT@example.test" });
    const second = await enrollInCourse({ courseId: fixture.course.id, name: "Student", email: "student@example.test" });
    const [enrollments, notifications, transactions, commissions] = await Promise.all([
      getDb().enrollment.findMany({ where: { courseId: fixture.course.id } }),
      getDb().notificationOutbox.findMany({ where: { vendorId: fixture.vendor.id, sourceType: "form_submission" } }),
      getDb().paymentTransaction.count({ where: { vendorId: fixture.vendor.id } }),
      getDb().affiliateCommission.count({ where: { vendorId: fixture.vendor.id } }),
    ]);
    expect(first.idempotentReplay).toBe(false);
    expect(second.idempotentReplay).toBe(true);
    expect(enrollments).toHaveLength(1);
    expect(notifications).toHaveLength(1);
    expect(transactions).toBe(0);
    expect(commissions).toBe(0);
  });

  it("serializes session capacity across concurrent enrollments", async () => {
    const fixture = await createPublishedCourse("capacity");
    const session = await upsertCourseSession({
      vendorId: fixture.vendor.id,
      courseId: fixture.course.id,
      title: "Limited session",
      startsAt: new Date(Date.now() + 86_400_000),
      status: "scheduled",
      capacity: 1,
    });
    const results = await Promise.allSettled([
      enrollInCourse({ courseId: fixture.course.id, sessionId: session.id, name: "One", email: "one@example.test" }),
      enrollInCourse({ courseId: fixture.course.id, sessionId: session.id, name: "Two", email: "two@example.test" }),
    ]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((result) => result.status === "rejected")).toHaveLength(1);
    await expect(getDb().enrollment.count({ where: { sessionId: session.id, status: "confirmed" } })).resolves.toBe(1);
  });
});
