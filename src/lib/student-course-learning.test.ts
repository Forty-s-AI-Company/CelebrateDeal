import { describe, expect, it, vi } from "vitest";
import { Prisma } from "@prisma/client";
import { getStudentCourse, saveStudentLessonProgress } from "@/lib/student-course-learning";

function storeFixture() {
  const lesson = { id: "lesson-1", chapterTitle: "第一章", title: "開場", videoUrl: "https://media.example.test/intro.mp4", durationSeconds: 100, position: 1 };
  const store = {
    commerceOrderItem: { findFirst: vi.fn(async () => ({ order: { id: "order-1", buyerEncryptedEnvelope: "encrypted", shippingEncryptedEnvelope: null } })) },
    product: { findFirst: vi.fn(async () => ({ id: "course-1", name: "成交實戰", vendor: { name: "五和學院" } })) },
    courseLesson: { findMany: vi.fn(async () => [lesson, { ...lesson, id: "lesson-2", position: 2, videoUrl: "javascript:alert(1)" }]), findFirst: vi.fn(async () => lesson) },
    courseLessonProgress: { findMany: vi.fn(async () => [{ lessonId: "lesson-1", watchedSeconds: 95, completedAt: new Date("2026-09-09T00:00:00Z") }]), upsert: vi.fn(async ({ create }) => create), updateMany: vi.fn(async (args: unknown) => { void args; return { count: 1 }; }) },
  };
  return { ...store, $transaction: async <T>(work: (tx: Pick<typeof store, "courseLessonProgress">) => Promise<T>) => work(store) };
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

describe("concurrent lesson saves", () => {
  it("retains completion when an older checkpoint finishes last", async () => {
    const db = storeFixture();
    let state = { lessonId: "lesson-1", watchedSeconds: 60, completedAt: null as Date | null };
    let release!: () => void;
    const delayed = new Promise<void>((resolve) => { release = resolve; });
    let started!: () => void;
    const waiting = new Promise<void>((resolve) => { started = resolve; });
    db.courseLessonProgress.findMany.mockImplementation(async () => [{ ...state }] as never);
    db.courseLessonProgress.upsert.mockImplementation(async ({ create, update }) => {
      if (create.watchedSeconds === 75) { started(); await delayed; }
      state = { ...state, ...update };
      return { ...state };
    });
    db.courseLessonProgress.updateMany.mockImplementation(async (args: unknown) => {
      const { where, data } = args as { where: { watchedSeconds?: { lt: number }; completedAt?: null }; data: { watchedSeconds?: number; completedAt?: Date } };
      if (where.watchedSeconds && state.watchedSeconds >= where.watchedSeconds.lt) return { count: 0 };
      if (where.completedAt === null && state.completedAt !== null) return { count: 0 };
      state = { ...state, ...data };
      return { count: 1 };
    });
    const save = (watchedSeconds: number) => saveStudentLessonProgress(db, scope, { courseId: "course-1", lessonId: "lesson-1", watchedSeconds, markedComplete: false });
    const older = save(75);
    await waiting;
    const completed = await save(90);
    expect(completed?.completedAt).toBeInstanceOf(Date);
    release();
    await older;
    expect(state.watchedSeconds).toBe(90);
    expect(state.completedAt).toEqual(completed?.completedAt);
  });

  it("merges a first-save unique collision while propagating other database errors", async () => {
    const db = storeFixture();
    const transactions = vi.spyOn(db, "$transaction");
    db.courseLessonProgress.upsert.mockRejectedValueOnce(new Prisma.PrismaClientKnownRequestError("synthetic collision", { code: "P2002", clientVersion: "test" }));
    const input = { courseId: "course-1", lessonId: "lesson-1", watchedSeconds: 90, markedComplete: false };
    await expect(saveStudentLessonProgress(db, scope, input)).resolves.toMatchObject({ watchedSeconds: 95 });
    expect(transactions).toHaveBeenCalledTimes(2);
    expect(db.courseLessonProgress.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ completedAt: null }) }));
    db.courseLessonProgress.upsert.mockRejectedValueOnce(new Error("synthetic unavailable"));
    await expect(saveStudentLessonProgress(db, scope, input)).rejects.toThrow("synthetic unavailable");
  });

  it("rolls back the seconds update when completion fails inside the same transaction", async () => {
    const db = storeFixture();
    const committed = { lessonId: "lesson-1", watchedSeconds: 60, completedAt: null as Date | null };
    db.courseLessonProgress.findMany.mockResolvedValue([committed] as never);
    let attemptedSeconds = 0;
    db.$transaction = async (work) => {
      const staged = { ...committed };
      const tx = { courseLessonProgress: {
        ...db.courseLessonProgress,
        upsert: vi.fn(async () => staged),
        findMany: vi.fn(async () => [staged]),
        updateMany: vi.fn(async (args: unknown) => {
          const { data } = args as { data: { watchedSeconds?: number; completedAt?: Date } };
          if (data.completedAt) throw new Error("synthetic completion failure");
          attemptedSeconds = data.watchedSeconds!;
          staged.watchedSeconds = attemptedSeconds;
          return { count: 1 };
        }),
      } };
      // Like Prisma, only commit after every awaited transaction operation succeeds.
      const result = await work(tx as never);
      Object.assign(committed, staged);
      return result;
    };
    await expect(saveStudentLessonProgress(db, scope, { courseId: "course-1", lessonId: "lesson-1", watchedSeconds: 95, markedComplete: false })).rejects.toThrow("synthetic completion failure");
    expect(attemptedSeconds).toBe(95);
    expect(committed).toEqual({ lessonId: "lesson-1", watchedSeconds: 60, completedAt: null });
    expect(db.courseLessonProgress.upsert).not.toHaveBeenCalled();
    expect(db.courseLessonProgress.updateMany).not.toHaveBeenCalled();
  });
});
