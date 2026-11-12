import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { Prisma } from "@prisma/client";
import { ZodError } from "zod";
import { automationCustomerKeyHash } from "@/lib/automation-workflow";
import { protectCommerceOrderPii } from "@/lib/commerce-order-pii";
import { grantCommerceEntitlement } from "@/lib/commerce-order-fulfillment";
import { ChapterTitleTaken, CurriculumConflict, renameCourseChapter, saveCourseLesson } from "@/lib/course-curriculum";
import { courseChapters } from "@/lib/course-learning";
import { getDb } from "@/lib/db";
import { getStudentCourse, saveStudentLessonProgress, studentCertificateDetails } from "@/lib/student-course-learning";

const db = getDb();
const vendors: string[] = [];

/** A vendor, a course and one learner with a granted entitlement. */
async function course() {
  const suffix = randomUUID();
  const vendor = await db.vendor.create({ data: { name: "Synthetic chapter academy", slug: `chapter-${suffix}`, email: `${suffix}@example.test`, passwordHash: "synthetic-only" } });
  vendors.push(vendor.id);
  const product = await db.product.create({ data: { vendorId: vendor.id, name: "Synthetic course", slug: `course-${suffix}`, priceCents: 10000, commerceDomain: "course", fulfillmentType: "course", isActive: true } });
  const orderId = randomUUID();
  const email = "synthetic-learner@example.test";
  const pii = protectCommerceOrderPii({ buyer: { name: "Synthetic student", email }, shipping: null }, { vendorId: vendor.id, orderId });
  const scope = { vendorId: vendor.id, customerKeyHash: automationCustomerKeyHash(vendor.id, email) };
  await db.commerceOrder.create({ data: {
    id: orderId, vendorId: vendor.id, automationCustomerKeyHash: scope.customerKeyHash, orderNumber: orderId,
    checkoutIdempotencyKey: randomUUID(), checkoutIdentityHash: pii.checkoutIdentityHash,
    status: "paid", subtotalAmountCents: 10000, totalAmountCents: 10000, paidAmountCents: 10000,
    buyerEncryptedEnvelope: pii.buyerEncrypted, buyerMaskedName: pii.buyerNameMasked, buyerMaskedEmail: pii.buyerEmailMasked,
  } });
  const item = await db.commerceOrderItem.create({ data: { vendorId: vendor.id, orderId, productId: product.id, lineIndex: 0, productName: product.name, productSlug: product.slug, commerceDomain: "course", fulfillmentType: "course", unitPriceCents: 10000, quantity: 1, lineTotalCents: 10000, nonSensitiveSnapshot: {} } });
  const entitlement = await db.commerceEntitlement.create({ data: { vendorId: vendor.id, orderItemId: item.id } });
  await db.$transaction((tx) => grantCommerceEntitlement(tx, { vendorId: vendor.id, entitlementId: entitlement.id, expectedRevision: entitlement.revision, actor: { id: "synthetic-chapter-fixture" } }));
  return { vendor, product, scope };
}

const revision = async (productId: string) => (await db.product.findUniqueOrThrow({ where: { id: productId } })).revision;

async function addLesson(f: Awaited<ReturnType<typeof course>>, chapterTitle: string, title: string, extra: Record<string, unknown> = {}) {
  return saveCourseLesson(db, f.vendor.id, { productId: f.product.id, revision: await revision(f.product.id), chapterTitle, title, videoUrl: "https://media.example.test/course.mp4", durationSeconds: 100, published: true, ...extra });
}

const chapters = (vendorId: string, productId: string) => db.courseChapter.findMany({ where: { vendorId, productId }, orderBy: { position: "asc" }, select: { id: true, title: true, position: true } });
const learnerTree = async (f: Awaited<ReturnType<typeof course>>) => courseChapters((await getStudentCourse(db, f.scope, f.product.id))!.lessons).map((group) => [group.id, group.title, group.lessons.map((lesson) => lesson.id)]);

afterEach(async () => {
  await db.vendor.deleteMany({ where: { id: { in: vendors.splice(0) } } });
});

describe("saveCourseLesson chapters (F-5)", () => {
  it("creates a chapter for a new title, reuses it for the same trimmed title and appends new chapters", async () => {
    const f = await course();
    const first = await addLesson(f, "第一章", "開場");
    const second = await addLesson(f, "  第一章 ", "框架");
    const third = await addLesson(f, "第二章", "演練");
    const rows = await chapters(f.vendor.id, f.product.id);
    expect(rows.map((row) => [row.title, row.position])).toEqual([["第一章", 0], ["第二章", 1]]);
    const lessons = await db.courseLesson.findMany({ where: { vendorId: f.vendor.id }, orderBy: { position: "asc" }, select: { id: true, chapterId: true, chapterTitle: true } });
    expect(lessons).toEqual([
      { id: first, chapterId: rows[0]!.id, chapterTitle: "第一章" },
      { id: second, chapterId: rows[0]!.id, chapterTitle: "第一章" },
      { id: third, chapterId: rows[1]!.id, chapterTitle: "第二章" },
    ]);
    expect(await learnerTree(f)).toEqual([[rows[0]!.id, "第一章", [first, second]], [rows[1]!.id, "第二章", [third]]]);
  });

  it("moves a lesson to another chapter and keeps the emptied chapter out of the learner view", async () => {
    const f = await course();
    const lesson = await addLesson(f, "第一章", "開場");
    await addLesson(f, "第二章", "演練");
    await addLesson(f, "第二章", "開場（新）", { lessonId: lesson });
    const rows = await chapters(f.vendor.id, f.product.id);
    expect(rows.map((row) => row.title)).toEqual(["第一章", "第二章"]);
    expect(await db.courseLesson.count({ where: { vendorId: f.vendor.id, chapterId: rows[0]!.id } })).toBe(0);
    expect((await learnerTree(f)).map(([, title]) => title)).toEqual(["第二章"]);
    // Moving it back reuses the kept chapter instead of creating another.
    await addLesson(f, "第一章", "開場", { lessonId: lesson });
    expect((await chapters(f.vendor.id, f.product.id)).map((row) => row.id)).toEqual(rows.map((row) => row.id));
    expect((await learnerTree(f)).map(([, title]) => title)).toEqual(["第一章", "第二章"]);
  });

  it("never accepts a chapter id from the caller", async () => {
    const f = await course();
    await expect(saveCourseLesson(db, f.vendor.id, { productId: f.product.id, revision: await revision(f.product.id), chapterTitle: "第一章", chapterId: "chp_foreign", title: "x", videoUrl: "", durationSeconds: 0, published: false })).rejects.toBeInstanceOf(ZodError);
  });

  it("rejects cross-tenant and cross-course chapter links in the database", async () => {
    const f = await course();
    const other = await course();
    const sameVendorCourse = await db.product.create({ data: { vendorId: f.vendor.id, name: "Second course", slug: randomUUID(), priceCents: 10000, commerceDomain: "course", fulfillmentType: "course" } });
    const lesson = await addLesson(f, "第一章", "開場");
    await addLesson(other, "第一章", "開場");
    const foreignChapter = (await chapters(other.vendor.id, other.product.id))[0]!;
    const siblingChapter = await db.courseChapter.create({ data: { vendorId: f.vendor.id, productId: sameVendorCourse.id, title: "第一章", position: 0 } });
    await expect(db.courseLesson.update({ where: { id: lesson }, data: { chapterId: foreignChapter.id } })).rejects.toMatchObject({ code: "P2003" });
    await expect(db.courseLesson.update({ where: { id: lesson }, data: { chapterId: siblingChapter.id } })).rejects.toMatchObject({ code: "P2003" });
    // A chapter row cannot claim another vendor's course either.
    await expect(db.courseChapter.create({ data: { vendorId: f.vendor.id, productId: other.product.id, title: "第九章", position: 9 } })).rejects.toMatchObject({ code: "P2003" });
    // A chapter that still has lessons cannot be deleted; the course can.
    const own = (await chapters(f.vendor.id, f.product.id))[0]!;
    await expect(db.courseChapter.delete({ where: { id: own.id } })).rejects.toMatchObject({ code: "P2003" });
    await db.courseLesson.create({ data: { vendorId: f.vendor.id, productId: sameVendorCourse.id, chapterId: siblingChapter.id, chapterTitle: "第一章", title: "x", position: 0 } });
    await db.product.delete({ where: { id: sameVendorCourse.id } });
    expect(await db.courseChapter.count({ where: { vendorId: f.vendor.id, productId: sameVendorCourse.id } })).toBe(0);
    expect(await db.courseLesson.count({ where: { vendorId: f.vendor.id, productId: sameVendorCourse.id } })).toBe(0);
  });

  it("creates one chapter when two new lessons with a new chapter title race", async () => {
    const f = await course();
    const current = await revision(f.product.id);
    const draft = (title: string) => saveCourseLesson(db, f.vendor.id, { productId: f.product.id, revision: current, chapterTitle: "新章節", title, videoUrl: "", durationSeconds: 0, published: false });
    const results = await Promise.allSettled([draft("甲"), draft("乙")]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    const rejected = results.find((result) => result.status === "rejected");
    expect(rejected?.reason instanceof CurriculumConflict || (rejected?.reason instanceof Prisma.PrismaClientKnownRequestError && ["P2002", "P2034"].includes(rejected.reason.code))).toBe(true);
    // The manager reloads and saves again: the lesson joins the existing chapter.
    await addLesson(f, "新章節", "乙");
    expect(await chapters(f.vendor.id, f.product.id)).toHaveLength(1);
    expect(await db.courseLesson.count({ where: { vendorId: f.vendor.id, chapterId: (await chapters(f.vendor.id, f.product.id))[0]!.id } })).toBe(2);
  });

  it("enforces the chapter title and position checks and keeps RLS without policies", async () => {
    const f = await course();
    const base = { vendorId: f.vendor.id, productId: f.product.id };
    await expect(db.courseChapter.create({ data: { ...base, title: " 未修剪", position: 0 } })).rejects.toThrow();
    await expect(db.courseChapter.create({ data: { ...base, title: "", position: 0 } })).rejects.toThrow();
    await expect(db.courseChapter.create({ data: { ...base, title: "x".repeat(121), position: 0 } })).rejects.toThrow();
    await expect(db.courseChapter.create({ data: { ...base, title: "合法", position: -1 } })).rejects.toThrow();
    await db.courseChapter.create({ data: { ...base, title: "x".repeat(120), position: 0 } });
    await expect(db.courseChapter.create({ data: { ...base, title: "x".repeat(120), position: 1 } })).rejects.toMatchObject({ code: "P2002" });
    await expect(db.courseChapter.create({ data: { ...base, title: "另一章", position: 0 } })).rejects.toMatchObject({ code: "P2002" });
    const [table] = await db.$queryRaw<Array<{ enabled: boolean; policies: bigint }>>`
      SELECT c.relrowsecurity AS enabled, (SELECT count(*) FROM pg_policy p WHERE p.polrelid = c.oid) AS policies
      FROM pg_class c WHERE c.oid = '"CourseChapter"'::regclass
    `;
    expect(table).toEqual({ enabled: true, policies: BigInt(0) });
  });
});

describe("renameCourseChapter (F-5)", () => {
  it("renames the chapter, rewrites every lesson's chapterTitle and keeps learner progress", async () => {
    const f = await course();
    const first = await addLesson(f, "第一章", "開場");
    const second = await addLesson(f, "第一章", "框架");
    const third = await addLesson(f, "第二章", "演練");
    for (const lessonId of [first, second, third]) await saveStudentLessonProgress(db, f.scope, { courseId: f.product.id, lessonId, watchedSeconds: 95, markedComplete: false });
    const progressBefore = await db.courseLessonProgress.findMany({ where: { vendorId: f.vendor.id }, orderBy: { lessonId: "asc" } });
    const completionBefore = (await getStudentCourse(db, f.scope, f.product.id))!.completion;
    const [chapter] = await chapters(f.vendor.id, f.product.id);
    const before = await revision(f.product.id);

    await renameCourseChapter(db, f.vendor.id, { productId: f.product.id, chapterId: chapter!.id, revision: before, title: "  開場與準備 " });

    expect(await revision(f.product.id)).toBe(before + 1);
    expect((await chapters(f.vendor.id, f.product.id)).map((row) => [row.id, row.title, row.position])).toEqual([[chapter!.id, "開場與準備", 0], [expect.any(String), "第二章", 1]]);
    expect((await db.courseLesson.findMany({ where: { vendorId: f.vendor.id }, orderBy: { position: "asc" }, select: { chapterTitle: true } })).map((lesson) => lesson.chapterTitle)).toEqual(["開場與準備", "開場與準備", "第二章"]);
    expect((await learnerTree(f)).map(([id, title, lessons]) => [id, title, lessons])).toEqual([[chapter!.id, "開場與準備", [first, second]], [expect.any(String), "第二章", [third]]]);
    expect(await db.courseLessonProgress.findMany({ where: { vendorId: f.vendor.id }, orderBy: { lessonId: "asc" } })).toEqual(progressBefore);
    expect((await getStudentCourse(db, f.scope, f.product.id))!.completion).toEqual(completionBefore);
    expect(completionBefore.complete).toBe(true);
    expect(await studentCertificateDetails(db, f.scope, f.product.id)).toMatchObject({ courseName: f.product.name });
  });

  it("rejects a title another chapter of the course uses, without changing anything", async () => {
    const f = await course();
    await addLesson(f, "第一章", "開場");
    await addLesson(f, "第二章", "演練");
    const [first] = await chapters(f.vendor.id, f.product.id);
    const before = await revision(f.product.id);
    await expect(renameCourseChapter(db, f.vendor.id, { productId: f.product.id, chapterId: first!.id, revision: before, title: " 第二章" })).rejects.toBeInstanceOf(ChapterTitleTaken);
    expect(await revision(f.product.id)).toBe(before);
    expect((await chapters(f.vendor.id, f.product.id)).map((row) => row.title)).toEqual(["第一章", "第二章"]);
    // The same title on another course or another vendor is fine.
    const other = await course();
    await addLesson(other, "第二章", "演練");
    await addLesson(other, "第一章", "開場");
    const otherFirst = (await chapters(other.vendor.id, other.product.id)).find((row) => row.title === "第一章")!;
    await expect(renameCourseChapter(db, other.vendor.id, { productId: other.product.id, chapterId: otherFirst.id, revision: await revision(other.product.id), title: "第三章" })).resolves.toBe(otherFirst.id);
  });

  it("rejects a stale revision", async () => {
    const f = await course();
    await addLesson(f, "第一章", "開場");
    const [chapter] = await chapters(f.vendor.id, f.product.id);
    const stale = (await revision(f.product.id)) - 1;
    await expect(renameCourseChapter(db, f.vendor.id, { productId: f.product.id, chapterId: chapter!.id, revision: stale, title: "改名" })).rejects.toBeInstanceOf(CurriculumConflict);
    expect((await chapters(f.vendor.id, f.product.id))[0]!.title).toBe("第一章");
  });

  it("cannot rename another vendor's or another course's chapter", async () => {
    const f = await course();
    const other = await course();
    await addLesson(f, "第一章", "開場");
    await addLesson(other, "第一章", "開場");
    const sameVendorCourse = await db.product.create({ data: { vendorId: f.vendor.id, name: "Second course", slug: randomUUID(), priceCents: 10000, commerceDomain: "course", fulfillmentType: "course" } });
    const sibling = await db.courseChapter.create({ data: { vendorId: f.vendor.id, productId: sameVendorCourse.id, title: "第一章", position: 0 } });
    const foreign = (await chapters(other.vendor.id, other.product.id))[0]!;
    const attempts = [
      // Own course, another vendor's chapter id.
      { vendorId: f.vendor.id, input: { productId: f.product.id, chapterId: foreign.id, revision: await revision(f.product.id), title: "竄改" } },
      // Own course, own chapter of a different course.
      { vendorId: f.vendor.id, input: { productId: f.product.id, chapterId: sibling.id, revision: await revision(f.product.id), title: "竄改" } },
      // Another vendor's course and chapter, with their current revision.
      { vendorId: f.vendor.id, input: { productId: other.product.id, chapterId: foreign.id, revision: await revision(other.product.id), title: "竄改" } },
    ];
    for (const attempt of attempts) await expect(renameCourseChapter(db, attempt.vendorId, attempt.input)).rejects.toBeInstanceOf(CurriculumConflict);
    expect((await db.courseChapter.findUniqueOrThrow({ where: { id: foreign.id } })).title).toBe("第一章");
    expect((await db.courseChapter.findUniqueOrThrow({ where: { id: sibling.id } })).title).toBe("第一章");
    expect(await db.courseLesson.count({ where: { chapterTitle: "竄改" } })).toBe(0);
  });
});
