import { describe, expect, it, vi } from "vitest";
import { getStudentCourse, saveStudentLessonProgress } from "@/lib/student-course-learning";

function storeFixture() {
  const lesson = { id: "lesson-1", chapterTitle: "第一章", title: "開場", videoUrl: "https://media.example.test/intro.mp4", durationSeconds: 100, position: 1 };
  return {
    commerceOrderItem: { findFirst: vi.fn(async () => ({ order: { id: "order-1", buyerEncryptedEnvelope: "encrypted", shippingEncryptedEnvelope: null } })) },
    product: { findFirst: vi.fn(async () => ({ id: "course-1", name: "成交實戰", vendor: { name: "五和學院" } })) },
    courseLesson: { findMany: vi.fn(async () => [lesson, { ...lesson, id: "lesson-2", position: 2, videoUrl: "javascript:alert(1)" }]), findFirst: vi.fn(async () => lesson) },
    courseLessonProgress: { findMany: vi.fn(async () => [{ lessonId: "lesson-1", watchedSeconds: 95, completedAt: new Date("2026-09-09T00:00:00Z") }]), upsert: vi.fn(async ({ create }) => create) },
  };
}

const scope = { vendorId: "vendor-1", customerKeyHash: "customer-key" };

describe("student course learning repository", () => {
  it("reads lessons only after tenant, learner and active entitlement filters, and rejects unsafe video URLs", async () => {
    const db = storeFixture();
    const course = await getStudentCourse(db, scope, "course-1");
    expect(db.commerceOrderItem.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ vendorId: "vendor-1", productId: "course-1", order: { is: expect.objectContaining({ automationCustomerKeyHash: "customer-key" }) } }) }));
    expect(course?.lessons).toMatchObject([{ videoUrl: "https://media.example.test/intro.mp4" }, { videoUrl: null }]);
    expect(course?.completion).toMatchObject({ percent: 50, complete: false });
  });

  it("does not create a progress record when entitlement/course access is absent", async () => {
    const db = storeFixture();
    db.commerceOrderItem.findFirst.mockResolvedValue(null as never);
    await expect(saveStudentLessonProgress(db, scope, { courseId: "course-1", lessonId: "lesson-1", watchedSeconds: 90, markedComplete: false })).resolves.toBeNull();
    expect(db.courseLessonProgress.upsert).not.toHaveBeenCalled();
  });

  it("persists an entitlement-bound 90% checkpoint under the tenant-qualified composite key", async () => {
    const db = storeFixture();
    const result = await saveStudentLessonProgress(db, scope, { courseId: "course-1", lessonId: "lesson-1", watchedSeconds: 90, markedComplete: false, now: new Date("2026-09-09T00:00:00Z") });
    expect(result).toMatchObject({ watchedSeconds: 95, completedAt: new Date("2026-09-09T00:00:00Z") });
    expect(db.courseLessonProgress.upsert).toHaveBeenCalledWith(expect.objectContaining({ where: { vendorId_lessonId_customerKeyHash: { vendorId: "vendor-1", lessonId: "lesson-1", customerKeyHash: "customer-key" } } }));
  });
});
