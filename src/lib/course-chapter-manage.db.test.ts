import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { automationCustomerKeyHash } from "@/lib/automation-workflow";
import { protectCommerceOrderPii } from "@/lib/commerce-order-pii";
import { grantCommerceEntitlement } from "@/lib/commerce-order-fulfillment";
import { ChapterNotEmpty, deleteCourseChapter, moveCourseChapter, moveCourseLesson } from "@/lib/course-chapter-manage";
import { CurriculumConflict, saveCourseLesson } from "@/lib/course-curriculum";
import { courseChapters } from "@/lib/course-learning";
import { PrismaClient } from "@prisma/client";
import { getDb } from "@/lib/db";
import { isTransientTransactionConflict } from "@/lib/serializable-retry";
import { getStudentCourse, saveStudentLessonProgress } from "@/lib/student-course-learning";

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

type Course = Awaited<ReturnType<typeof course>>;

const revision = async (productId: string) => (await db.product.findUniqueOrThrow({ where: { id: productId } })).revision;

async function addLesson(f: Course, chapterTitle: string, title: string, published = true) {
  return saveCourseLesson(db, f.vendor.id, { productId: f.product.id, revision: await revision(f.product.id), chapterTitle, title, videoUrl: "https://media.example.test/course.mp4", durationSeconds: 100, published });
}

const chapterRows = (f: Course) => db.courseChapter.findMany({ where: { vendorId: f.vendor.id, productId: f.product.id }, orderBy: { position: "asc" }, select: { id: true, title: true, position: true } });
const lessonRows = (f: Course) => db.courseLesson.findMany({ where: { vendorId: f.vendor.id, productId: f.product.id }, orderBy: { position: "asc" }, select: { id: true, position: true, chapterId: true, chapterTitle: true } });
const learnerTree = async (f: Course) => courseChapters((await getStudentCourse(db, f.scope, f.product.id))!.lessons).map((group) => [group.title, group.lessons.map((lesson) => lesson.id)]);
const manage = async (f: Course) => ({ productId: f.product.id, revision: await revision(f.product.id) });
const progress = (f: Course) => db.courseLessonProgress.findMany({ where: { vendorId: f.vendor.id }, orderBy: { lessonId: "asc" }, select: { lessonId: true, watchedSeconds: true, completedAt: true } });

/** Three chapters (A: a1 a2, B: b1, C: c1) with learner progress on every lesson. */
async function fixture() {
  const f = await course();
  const a1 = await addLesson(f, "A", "a1");
  const a2 = await addLesson(f, "A", "a2");
  const b1 = await addLesson(f, "B", "b1");
  const c1 = await addLesson(f, "C", "c1");
  for (const lessonId of [a1, a2, b1, c1]) await saveStudentLessonProgress(db, f.scope, { courseId: f.product.id, lessonId, watchedSeconds: 95, markedComplete: false });
  const [A, B, C] = await chapterRows(f);
  return { f, a1, a2, b1, c1, A: A!, B: B!, C: C! };
}

afterEach(async () => {
  await db.vendor.deleteMany({ where: { id: { in: vendors.splice(0) } } });
});

describe("course chapter management (Q-15)", () => {
  it("moves a chapter down and up, keeping lessons grouped and the learner order in step", async () => {
    const { f, a1, a2, b1, c1, A, C } = await fixture();
    const before = await progress(f);
    expect(before).toHaveLength(4);
    expect(await moveCourseChapter(db, f.vendor.id, { ...await manage(f), chapterId: A.id, direction: "down" })).toBe(true);
    expect((await chapterRows(f)).map((row) => [row.title, row.position])).toEqual([["B", 0], ["A", 1], ["C", 2]]);
    expect((await lessonRows(f)).map((row) => [row.id, row.position])).toEqual([[b1, 0], [a1, 1], [a2, 2], [c1, 3]]);
    expect(await learnerTree(f)).toEqual([["B", [b1]], ["A", [a1, a2]], ["C", [c1]]]);
    expect(await moveCourseChapter(db, f.vendor.id, { ...await manage(f), chapterId: C.id, direction: "up" })).toBe(true);
    expect((await chapterRows(f)).map((row) => row.title)).toEqual(["B", "C", "A"]);
    expect((await learnerTree(f)).map(([title]) => title)).toEqual(["B", "C", "A"]);
    expect(await progress(f)).toEqual(before);
  });

  it("does nothing at either end of the order", async () => {
    const { f, A, C } = await fixture();
    const lessons = await lessonRows(f);
    expect(await moveCourseChapter(db, f.vendor.id, { ...await manage(f), chapterId: A.id, direction: "up" })).toBe(false);
    expect(await moveCourseChapter(db, f.vendor.id, { ...await manage(f), chapterId: C.id, direction: "down" })).toBe(false);
    expect((await chapterRows(f)).map((row) => row.title)).toEqual(["A", "B", "C"]);
    expect(await lessonRows(f)).toEqual(lessons);
  });

  it("normalizes gaps and interleaved lessons without a unique-position collision", async () => {
    const { f, a1, a2, b1, c1, A, C } = await fixture();
    // A lesson of A saved last lands after C's lesson in the flat list.
    const late = await addLesson(f, "A", "a3");
    await db.courseChapter.update({ where: { id: C.id }, data: { position: 40 } });
    await moveCourseChapter(db, f.vendor.id, { ...await manage(f), chapterId: A.id, direction: "down" });
    expect((await chapterRows(f)).map((row) => [row.title, row.position])).toEqual([["B", 0], ["A", 1], ["C", 2]]);
    expect((await lessonRows(f)).map((row) => [row.id, row.position])).toEqual([[b1, 0], [a1, 1], [a2, 2], [late, 3], [c1, 4]]);
  });

  it("deletes an empty chapter only, never a lesson or progress", async () => {
    const { f, a1, a2, b1, c1, A, B } = await fixture();
    const before = await progress(f);
    await expect(deleteCourseChapter(db, f.vendor.id, { ...await manage(f), chapterId: A.id })).rejects.toBeInstanceOf(ChapterNotEmpty);
    expect(await chapterRows(f)).toHaveLength(3);
    await moveCourseLesson(db, f.vendor.id, { ...await manage(f), lessonId: b1, targetChapterId: A.id });
    expect(await deleteCourseChapter(db, f.vendor.id, { ...await manage(f), chapterId: B.id })).toBe(B.id);
    expect((await chapterRows(f)).map((row) => row.title)).toEqual(["A", "C"]);
    expect((await lessonRows(f)).map((row) => row.id)).toEqual([a1, a2, b1, c1]);
    expect(await progress(f)).toEqual(before);
  });

  it("treats a lesson that names the chapter by title as still inside it", async () => {
    const { f, a1, A, B, C } = await fixture();
    // A pre-F-5 style stale link: chapterId points to B, the title still names A.
    // (Since Q-14 chapterId is NOT NULL, so a lesson cannot lose its link altogether.)
    await db.courseLesson.update({ where: { id: a1 }, data: { chapterId: B.id } });
    await db.courseLesson.updateMany({ where: { vendorId: f.vendor.id, productId: f.product.id, chapterId: A.id }, data: { chapterId: C.id, chapterTitle: "C" } });
    expect(await db.courseLesson.count({ where: { chapterId: A.id } })).toBe(0);
    await expect(deleteCourseChapter(db, f.vendor.id, { ...await manage(f), chapterId: A.id })).rejects.toBeInstanceOf(ChapterNotEmpty);
    expect(await db.courseChapter.count({ where: { id: A.id } })).toBe(1);
  });

  it("moves a lesson to the end of another chapter and renumbers every lesson", async () => {
    const { f, a1, a2, b1, c1, A, B, C } = await fixture();
    const before = await progress(f);
    expect(await moveCourseLesson(db, f.vendor.id, { ...await manage(f), lessonId: a1, targetChapterId: C.id })).toBe(true);
    expect((await lessonRows(f)).map((row) => [row.id, row.position, row.chapterId, row.chapterTitle])).toEqual([
      [a2, 0, A.id, "A"], [b1, 1, B.id, "B"], [c1, 2, C.id, "C"], [a1, 3, C.id, "C"],
    ]);
    expect(await learnerTree(f)).toEqual([["A", [a2]], ["B", [b1]], ["C", [c1, a1]]]);
    expect(await progress(f)).toEqual(before);
    expect(await moveCourseLesson(db, f.vendor.id, { ...await manage(f), lessonId: a1, targetChapterId: C.id })).toBe(false);
  });

  it("rejects another course's or another vendor's chapter and lesson ids and changes nothing", async () => {
    const { f, a1, A } = await fixture();
    const other = await fixture();
    const secondCourse = await db.product.create({ data: { vendorId: f.vendor.id, name: "Second course", slug: `second-${randomUUID()}`, priceCents: 100, commerceDomain: "course", fulfillmentType: "course", isActive: true } });
    const foreign = await db.courseChapter.create({ data: { vendorId: f.vendor.id, productId: secondCourse.id, title: "Elsewhere", position: 0 } });
    const snapshot = async () => [await chapterRows(f), await lessonRows(f), await progress(f), await chapterRows(other.f), await lessonRows(other.f)];
    const before = await snapshot();
    const mine = await manage(f);
    const refused = (promise: Promise<unknown>) => expect(promise).rejects.toBeInstanceOf(CurriculumConflict);
    await refused(moveCourseLesson(db, f.vendor.id, { ...mine, lessonId: a1, targetChapterId: other.A.id }));
    await refused(moveCourseLesson(db, f.vendor.id, { ...mine, lessonId: a1, targetChapterId: foreign.id }));
    await refused(moveCourseLesson(db, f.vendor.id, { ...mine, lessonId: other.a1, targetChapterId: A.id }));
    await refused(moveCourseChapter(db, f.vendor.id, { ...mine, chapterId: other.A.id, direction: "down" }));
    await refused(moveCourseChapter(db, f.vendor.id, { ...mine, chapterId: foreign.id, direction: "down" }));
    await refused(deleteCourseChapter(db, f.vendor.id, { ...mine, chapterId: other.C.id }));
    await refused(deleteCourseChapter(db, f.vendor.id, { ...mine, chapterId: foreign.id }));
    // The other vendor's course is refused by the revision claim itself.
    await refused(moveCourseChapter(db, f.vendor.id, { productId: other.f.product.id, revision: await revision(other.f.product.id), chapterId: other.A.id, direction: "down" }));
    expect(await snapshot()).toEqual(before);
    expect(await db.courseChapter.count({ where: { id: foreign.id } })).toBe(1);
  });

  it("rejects a stale revision, an unknown lesson and a bad direction", async () => {
    const { f, a1, A, B } = await fixture();
    const stale = await manage(f);
    await moveCourseChapter(db, f.vendor.id, { ...stale, chapterId: A.id, direction: "down" });
    await expect(moveCourseChapter(db, f.vendor.id, { ...stale, chapterId: A.id, direction: "up" })).rejects.toBeInstanceOf(CurriculumConflict);
    await expect(moveCourseLesson(db, f.vendor.id, { ...stale, lessonId: a1, targetChapterId: B.id })).rejects.toBeInstanceOf(CurriculumConflict);
    await expect(moveCourseLesson(db, f.vendor.id, { ...await manage(f), lessonId: "missing", targetChapterId: B.id })).rejects.toBeInstanceOf(CurriculumConflict);
    await expect(moveCourseChapter(db, f.vendor.id, { ...await manage(f), chapterId: A.id, direction: "sideways" })).rejects.toThrow();
    expect((await chapterRows(f)).map((row) => row.title)).toEqual(["B", "A", "C"]);
  });
});

describe("course chapter management review follow-ups (Q-15)", () => {
  it("relinks stale links to their title's chapter before deleting, and rolls back when the chapter is still not empty", async () => {
    const { f, b1, B } = await fixture();
    const scope = { vendorId: f.vendor.id, productId: f.product.id };
    const X = await db.courseChapter.create({ data: { ...scope, title: "X", position: 9 } });
    const stale = await db.courseLesson.create({ data: { ...scope, chapterId: X.id, chapterTitle: "B", title: "stale-b", position: 20, publishedAt: new Date() } });
    const fresh = await db.courseLesson.create({ data: { ...scope, chapterId: X.id, chapterTitle: "Fresh", title: "stale-fresh", position: 21, publishedAt: new Date() } });
    // X still owns a lesson by title: refused, and nothing (not even the relink) is kept.
    const own = await db.courseLesson.create({ data: { ...scope, chapterId: X.id, chapterTitle: "X", title: "own", position: 22 } });
    const before = await revision(f.product.id);
    await expect(deleteCourseChapter(db, f.vendor.id, { ...await manage(f), chapterId: X.id })).rejects.toBeInstanceOf(ChapterNotEmpty);
    expect(await revision(f.product.id)).toBe(before);
    expect((await db.courseLesson.findMany({ where: { id: { in: [stale.id, fresh.id] } }, orderBy: { position: "asc" }, select: { chapterId: true } })).map((row) => row.chapterId)).toEqual([X.id, X.id]);
    expect(await db.courseChapter.count({ where: { ...scope, title: "Fresh" } })).toBe(0);
    // Once the legitimate member is gone only stale links remain: they are relinked and X is deleted.
    await db.courseLesson.delete({ where: { id: own.id } });
    expect(await deleteCourseChapter(db, f.vendor.id, { ...await manage(f), chapterId: X.id })).toBe(X.id);
    expect(await db.courseChapter.count({ where: { id: X.id } })).toBe(0);
    const freshChapter = await db.courseChapter.findFirstOrThrow({ where: { ...scope, title: "Fresh" } });
    expect((await db.courseLesson.findMany({ where: { id: { in: [stale.id, fresh.id] } }, orderBy: { position: "asc" }, select: { id: true, chapterId: true, chapterTitle: true } }))).toEqual([
      { id: stale.id, chapterId: B.id, chapterTitle: "B" },
      { id: fresh.id, chapterId: freshChapter.id, chapterTitle: "Fresh" },
    ]);
    expect(b1).toBeTruthy();
  });

  it("makes the learner follow the back-office order after the first management operation, unpublished lessons included", async () => {
    const f = await course();
    const a1 = await addLesson(f, "A", "a1", false);
    const b1 = await addLesson(f, "B", "b1");
    const a2 = await addLesson(f, "A", "a2");
    const c1 = await addLesson(f, "C", "c1");
    const [A, B, C] = await chapterRows(f);
    expect(A!.title).toBe("A");
    // Before: the learner orders chapters by the first visible lesson (B before A); the manager page shows A, B, C.
    expect(await learnerTree(f)).toEqual([["B", [b1]], ["A", [a2]], ["C", [c1]]]);
    // An unrelated lesson move: the learner order now matches the back-office order.
    await moveCourseLesson(db, f.vendor.id, { ...await manage(f), lessonId: c1, targetChapterId: B!.id });
    expect(await learnerTree(f)).toEqual([["A", [a2]], ["B", [b1, c1]]]);
    expect((await lessonRows(f)).map((row) => [row.id, row.position])).toEqual([[a1, 0], [a2, 1], [b1, 2], [c1, 3]]);
    expect(C!.title).toBe("C");
  });

  it("puts lessons that name no chapter row last and keeps unpublished lessons in their chapter", async () => {
    const { f, a1, a2, b1, c1, B, C } = await fixture();
    const scope = { vendorId: f.vendor.id, productId: f.product.id };
    const hidden = await addLesson(f, "B", "hidden-b", false);
    // Stale link (chapterId NOT NULL since Q-14): linked to C, its title names no chapter row.
    const orphan = await db.courseLesson.create({ data: { ...scope, chapterId: C.id, chapterTitle: "Orphan", title: "orphan", position: 100, publishedAt: new Date() } });
    expect(await moveCourseChapter(db, f.vendor.id, { ...await manage(f), chapterId: B.id, direction: "up" })).toBe(true);
    expect((await lessonRows(f)).map((row) => row.id)).toEqual([b1, hidden, a1, a2, c1, orphan.id]);
    expect((await lessonRows(f)).map((row) => row.position)).toEqual([0, 1, 2, 3, 4, 5]);
  });

  it("reports false without consuming the revision when nothing changes, and only repairs a link in the same chapter", async () => {
    const { f, a1, A, B, C } = await fixture();
    const start = await revision(f.product.id);
    expect(await moveCourseChapter(db, f.vendor.id, { ...await manage(f), chapterId: A.id, direction: "up" })).toBe(false);
    expect(await moveCourseChapter(db, f.vendor.id, { ...await manage(f), chapterId: C.id, direction: "down" })).toBe(false);
    expect(await moveCourseLesson(db, f.vendor.id, { ...await manage(f), lessonId: a1, targetChapterId: A.id })).toBe(false);
    expect(await revision(f.product.id)).toBe(start);
    // A lesson that names the chapter but whose link is stale (old code; chapterId is
    // NOT NULL since Q-14): the link is repaired, nothing moves.
    await db.courseLesson.update({ where: { id: a1 }, data: { chapterId: B.id } });
    const positions = (await lessonRows(f)).map((row) => [row.id, row.position]);
    expect(await moveCourseLesson(db, f.vendor.id, { ...await manage(f), lessonId: a1, targetChapterId: A.id })).toBe(false);
    expect((await db.courseLesson.findUniqueOrThrow({ where: { id: a1 } })).chapterId).toBe(A.id);
    expect((await lessonRows(f)).map((row) => [row.id, row.position])).toEqual(positions);
  });

  it("gives two managers working at once one success and one conflict", async () => {
    const { f, A } = await fixture();
    const url = new URL(process.env.DATABASE_URL ?? "");
    url.searchParams.set("connection_limit", "2");
    url.searchParams.set("pool_timeout", "20");
    const clients = [new PrismaClient({ datasourceUrl: url.toString() }), new PrismaClient({ datasourceUrl: url.toString() })];
    try {
      const input = { ...await manage(f), chapterId: A.id, direction: "down" };
      const results = await Promise.allSettled(clients.map((client) => moveCourseChapter(client, f.vendor.id, input)));
      expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
      const rejected = results.find((result) => result.status === "rejected") as PromiseRejectedResult;
      expect(rejected.reason instanceof CurriculumConflict || isTransientTransactionConflict(rejected.reason)).toBe(true);
      expect((await chapterRows(f)).map((row) => row.title)).toEqual(["B", "A", "C"]);
    } finally {
      await Promise.all(clients.map((client) => client.$disconnect()));
    }
  }, 60_000);
});
