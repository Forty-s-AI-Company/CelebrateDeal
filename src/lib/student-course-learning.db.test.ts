import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { getDb } from "@/lib/db";
import { automationCustomerKeyHash } from "@/lib/automation-workflow";
import { protectCommerceOrderPii } from "@/lib/commerce-order-pii";
import { grantCommerceEntitlement } from "@/lib/commerce-order-fulfillment";
import { reconcileCommerceOrderRefund } from "@/lib/commerce-orders";
import { CurriculumConflict, saveCourseLesson } from "@/lib/course-curriculum";
import { getStudentCourse, saveStudentLessonProgress, studentCertificateDetails } from "@/lib/student-course-learning";

const db = getDb();
const vendors: string[] = [];
async function fixture() {
  const suffix = randomUUID();
  const vendor = await db.vendor.create({ data: { name: "Synthetic academy", slug: `course-${suffix}`, email: `${suffix}@example.test`, passwordHash: "synthetic-only" } });
  vendors.push(vendor.id);
  const product = await db.product.create({ data: { vendorId: vendor.id, name: "Synthetic course", slug: `course-${suffix}`, priceCents: 10000, commerceDomain: "course", fulfillmentType: "course", isActive: true } });
  const orderId = randomUUID();
  const email = "synthetic-learner@example.test";
  const pii = protectCommerceOrderPii({ buyer: { name: "Synthetic student", email }, shipping: null }, { vendorId: vendor.id, orderId });
  const scope = { vendorId: vendor.id, customerKeyHash: automationCustomerKeyHash(vendor.id, email) };
  const order = await db.commerceOrder.create({ data: {
    id: orderId, vendorId: vendor.id, automationCustomerKeyHash: scope.customerKeyHash, orderNumber: orderId,
    checkoutIdempotencyKey: randomUUID(), checkoutIdentityHash: pii.checkoutIdentityHash,
    status: "paid", subtotalAmountCents: 10000, totalAmountCents: 10000, paidAmountCents: 10000,
    buyerEncryptedEnvelope: pii.buyerEncrypted, buyerMaskedName: pii.buyerNameMasked, buyerMaskedEmail: pii.buyerEmailMasked,
  } });
  const item = await db.commerceOrderItem.create({ data: { vendorId: vendor.id, orderId, productId: product.id, lineIndex: 0, productName: product.name, productSlug: product.slug, commerceDomain: "course", fulfillmentType: "course", unitPriceCents: 10000, quantity: 1, lineTotalCents: 10000, nonSensitiveSnapshot: {} } });
  const entitlement = await db.commerceEntitlement.create({ data: { vendorId: vendor.id, orderItemId: item.id } });
  await db.$transaction((tx) => grantCommerceEntitlement(tx, { vendorId: vendor.id, entitlementId: entitlement.id, expectedRevision: entitlement.revision, actor: { id: "synthetic-course-fixture" } }));
  const draft = { productId: product.id, revision: product.revision, chapterTitle: "第一章", title: "第一單元", videoUrl: "https://media.example.test/course.mp4", durationSeconds: 100, published: true };
  const lessonId = await saveCourseLesson(db, vendor.id, draft);
  return { vendor, product, order, item, scope, lessonId, draft };
}
afterEach(async () => {
  await db.vendor.deleteMany({ where: { id: { in: vendors.splice(0) } } });
});

describe("native course PostgreSQL boundaries", () => {
  it("publishes a manager-created lesson and joins it only to the owning learner", async () => {
    const f = await fixture();
    const course = await getStudentCourse(db, f.scope, f.product.id);
    expect(course?.lessons.map((lesson) => lesson.id)).toEqual([f.lessonId]);
    await expect(getStudentCourse(db, { ...f.scope, customerKeyHash: "other-learner" }, f.product.id)).resolves.toBeNull();
    const other = await fixture();
    await expect(getStudentCourse(db, other.scope, f.product.id)).resolves.toBeNull();
    await expect(saveStudentLessonProgress(db, other.scope, { courseId: f.product.id, lessonId: f.lessonId, watchedSeconds: 90, markedComplete: false })).resolves.toBeNull();
  });

  it("rejects cross-tenant and same-tenant cross-course lesson foreign keys", async () => {
    const f = await fixture(); const other = await fixture();
    const second = await db.product.create({ data: { vendorId: f.vendor.id, name: "Another course", slug: randomUUID(), priceCents: 10000, commerceDomain: "course", fulfillmentType: "course" } });
    const base = { vendorId: f.vendor.id, productId: second.id, lessonId: f.lessonId, customerKeyHash: f.scope.customerKeyHash };
    await expect(db.courseLessonProgress.create({ data: base })).rejects.toMatchObject({ code: "P2003" });
    await expect(db.courseLessonProgress.create({ data: { ...base, vendorId: other.vendor.id, productId: other.product.id } })).rejects.toMatchObject({ code: "P2003" });
    expect(await db.courseLessonProgress.count()).toBe(0);
  });

  it("keeps simultaneous first checkpoints and older later saves monotonic", async () => {
    const f = await fixture();
    const save = (seconds: number) => saveStudentLessonProgress(db, f.scope, { courseId: f.product.id, lessonId: f.lessonId, watchedSeconds: seconds, markedComplete: false });
    await Promise.all([save(75), save(95)]);
    const complete = await save(60);
    expect(complete).toMatchObject({ watchedSeconds: 95, completedAt: expect.any(Date) });
    expect(await db.courseLessonProgress.count({ where: { vendorId: f.vendor.id } })).toBe(1);
    expect(await studentCertificateDetails(db, f.scope, f.product.id)).toMatchObject({ studentName: "Synthetic student", courseName: f.product.name });
  });

  it("revokes playback, writes and certificates after a real full refund reconciliation", async () => {
    const f = await fixture();
    const input = { courseId: f.product.id, lessonId: f.lessonId, watchedSeconds: 95, markedComplete: false };
    await saveStudentLessonProgress(db, f.scope, input);
    expect(await studentCertificateDetails(db, f.scope, f.product.id)).not.toBeNull();
    await db.$transaction((tx) => reconcileCommerceOrderRefund(tx, { vendorId: f.vendor.id, orderId: f.order.id, providerName: "synthetic", eventIdentity: randomUUID(), amountCents: 10000, occurredAt: new Date() }));
    await expect(getStudentCourse(db, f.scope, f.product.id)).resolves.toBeNull();
    await expect(saveStudentLessonProgress(db, f.scope, input)).resolves.toBeNull();
    await expect(studentCertificateDetails(db, f.scope, f.product.id)).resolves.toBeNull();
    expect(await db.courseLessonProgress.count({ where: { vendorId: f.vendor.id } })).toBe(1);
    expect((await db.commerceEntitlement.findFirstOrThrow({ where: { vendorId: f.vendor.id } })).status).toBe("revoked");
  });

  it("rejects stale and foreign curriculum edits without consuming the revision", async () => {
    const f = await fixture(); const other = await fixture();
    await expect(saveCourseLesson(db, f.vendor.id, f.draft)).rejects.toBeInstanceOf(CurriculumConflict);
    const current = await db.product.findUniqueOrThrow({ where: { id: f.product.id } });
    await expect(saveCourseLesson(db, f.vendor.id, { ...f.draft, revision: current.revision, lessonId: other.lessonId })).rejects.toBeInstanceOf(CurriculumConflict);
    expect((await db.product.findUniqueOrThrow({ where: { id: f.product.id } })).revision).toBe(current.revision);
    await expect(saveCourseLesson(db, other.vendor.id, { ...f.draft, revision: current.revision })).rejects.toBeInstanceOf(CurriculumConflict);
  });

  it("hides unpublished lessons and rejects their progress updates", async () => {
    const f = await fixture();
    const product = await db.product.findUniqueOrThrow({ where: { id: f.product.id } });
    await saveCourseLesson(db, f.vendor.id, { ...f.draft, revision: product.revision, lessonId: f.lessonId, published: false });
    expect((await getStudentCourse(db, f.scope, f.product.id))?.lessons).toEqual([]);
    await expect(saveStudentLessonProgress(db, f.scope, { courseId: f.product.id, lessonId: f.lessonId, watchedSeconds: 100, markedComplete: true })).resolves.toBeNull();
    await expect(studentCertificateDetails(db, f.scope, f.product.id)).resolves.toBeNull();
  });

  it("enforces progress bounds and denies public RLS policies", async () => {
    const f = await fixture();
    await expect(db.courseLessonProgress.create({ data: { vendorId: f.vendor.id, productId: f.product.id, lessonId: f.lessonId, customerKeyHash: f.scope.customerKeyHash, watchedSeconds: -1 } })).rejects.toThrow();
    const tables = await db.$queryRaw<Array<{ name: string; enabled: boolean; policies: bigint }>>`
      SELECT c.relname AS name, c.relrowsecurity AS enabled, (SELECT count(*) FROM pg_policy p WHERE p.polrelid = c.oid) AS policies
      FROM pg_class c WHERE c.oid IN ('"CourseLesson"'::regclass, '"CourseLessonProgress"'::regclass) ORDER BY c.relname
    `;
    expect(tables).toEqual([{ name: "CourseLesson", enabled: true, policies: BigInt(0) }, { name: "CourseLessonProgress", enabled: true, policies: BigInt(0) }]);
  });
});
