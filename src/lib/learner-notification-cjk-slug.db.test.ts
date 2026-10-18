import { createHash, randomBytes, randomInt, randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
const monitoring = vi.hoisted(() => ({ capture: vi.fn() }));
vi.mock("./monitoring", async original => ({ ...await original<typeof import("./monitoring")>(), captureOperationalError: monitoring.capture }));
import { getDb } from "./db";
import { protectCommerceOrderPii } from "./commerce-order-pii";
import { grantCommerceEntitlement } from "./commerce-order-fulfillment";
import { reconcileCommerceOrderPaymentTransition } from "./commerce-orders";
import { saveCourseLesson } from "./course-curriculum";
import { mutateCourseCommunity } from "./course-community";
import { recordLearnerLiveStartedSources } from "./learner-live-notifications";
import { decryptSensitiveValue, encryptSensitiveValue } from "./sensitive-data";

// Regression for an 80-character CJK vendor slug: percent-encoding made each
// character 9 bytes, pushed the stored path past 512 and rolled back the real
// payment / live / publish / reply transaction. Links are now vendor-independent.
const cjkSlug = Array.from({ length: 80 }, () => String.fromCodePoint(0x4e00 + randomInt(0, 0x9fa5 - 0x4e00))).join("");
const vendorIds: string[] = [];
let vendor: { id: string; slug: string };
let course: { id: string; name: string };
const buyer = randomBytes(32).toString("base64url"), replier = randomBytes(32).toString("base64url");

async function paidOrder(customerKeyHash: string, productId: string, productName: string, status: "paid" | "pending_payment") {
  const db = getDb(), orderId = randomUUID();
  const pii = protectCommerceOrderPii({ buyer: { name: "Synthetic learner", email: `${orderId}@invalid.example` }, shipping: null }, { vendorId: vendor.id, orderId });
  const payment = status === "pending_payment" ? await db.paymentTransaction.create({ data: { vendorId: vendor.id, providerName: "synthetic_no_provider", status: "paid", grossAmountCents: 1000, netAmountCents: 1000 } }) : null;
  await db.commerceOrder.create({ data: { id: orderId, vendorId: vendor.id, automationCustomerKeyHash: customerKeyHash, orderNumber: orderId, checkoutIdempotencyKey: randomUUID(), checkoutIdentityHash: pii.checkoutIdentityHash,
    status, subtotalAmountCents: 1000, totalAmountCents: 1000, paidAmountCents: status === "paid" ? 1000 : 0, primaryPaymentTransactionId: payment?.id ?? null,
    buyerEncryptedEnvelope: pii.buyerEncrypted, buyerMaskedName: pii.buyerNameMasked, buyerMaskedEmail: pii.buyerEmailMasked } });
  const item = await db.commerceOrderItem.create({ data: { vendorId: vendor.id, orderId, productId, lineIndex: 0, productName, productSlug: randomUUID(), commerceDomain: "course", fulfillmentType: "course", unitPriceCents: 1000, quantity: 1, lineTotalCents: 1000, nonSensitiveSnapshot: {} } });
  // Checkout seals the access envelope on the pending entitlement; the paid transition only grants it.
  const entitlement = await db.commerceEntitlement.create({ data: { vendorId: vendor.id, orderItemId: item.id,
    ...(status === "pending_payment" ? { accessEncryptedEnvelope: encryptSensitiveValue("synthetic-access", `synthetic-cjk-access:${item.id}`), accessMaskedSummary: "synthetic" } : {}) } });
  if (status === "paid") await db.$transaction(tx => grantCommerceEntitlement(tx, { vendorId: vendor.id, entitlementId: entitlement.id, expectedRevision: entitlement.revision, actor: { id: "synthetic-cjk-fixture" } }));
  return { orderId, paymentId: payment?.id ?? null, entitlementId: entitlement.id };
}

async function sourcePath(productId: string, event: string, eventIdentity: string) {
  const source = await getDb().learnerNotificationSourceEvent.findUniqueOrThrow({ where: { vendorId_productId_event_eventIdentity: { vendorId: vendor.id, productId, event, eventIdentity } } });
  const message = JSON.parse(decryptSensitiveValue(source.payloadEncryptedEnvelope, `learner-notification-source-v1:${JSON.stringify([vendor.id, productId, event, eventIdentity])}`)) as { path: string };
  expect(message.path.startsWith(`/portal/notify.link/${vendor.id}/`)).toBe(true);
  expect(message.path.length).toBeLessThanOrEqual(512);
  expect(message.path).not.toContain("%");
  return message.path;
}

beforeAll(async () => {
  const suffix = randomUUID();
  vendor = await getDb().vendor.create({ data: { name: "Synthetic CJK notification owner", slug: cjkSlug, email: `cjk-${suffix}@invalid.example`, passwordHash: "synthetic-login-disabled" }, select: { id: true, slug: true } });
  vendorIds.push(vendor.id);
  expect(vendor.slug).toHaveLength(80);
  expect(`/portal/${encodeURIComponent(vendor.slug)}/notifications`.length).toBeGreaterThan(512);
  course = await getDb().product.create({ data: { vendorId: vendor.id, name: "合成課程", slug: `cjk-course-${suffix}`, priceCents: 1000, commerceDomain: "course", fulfillmentType: "course" }, select: { id: true, name: true } });
  await paidOrder(replier, course.id, course.name, "paid");
});
afterAll(async () => {
  // Disposable loopback test DB only; a restrictive FK leaves synthetic rows behind rather than failing the suite.
  try { await getDb().vendor.deleteMany({ where: { id: { in: vendorIds } } }); } catch { /* retained synthetic fixture */ }
});

describe("80-character CJK vendor slug never rolls back the domain transaction", () => {
  it("payment: the paid transition commits and records a vendor-independent source", async () => {
    const order = await paidOrder(buyer, course.id, course.name, "pending_payment");
    const result = await getDb().$transaction(tx => reconcileCommerceOrderPaymentTransition(tx, { vendorId: vendor.id, paymentTransactionId: order.paymentId!, eventIdentity: `cjk_paid_${randomUUID()}`, transition: "paid", occurredAt: new Date() }), { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    expect(result).toMatchObject({ changed: true, status: "paid" });
    expect((await getDb().commerceOrder.findUniqueOrThrow({ where: { id: order.orderId } })).status).toBe("paid");
    expect((await getDb().commerceEntitlement.findUniqueOrThrow({ where: { id: order.entitlementId } })).status).toBe("granted");
    const identity = createHash("sha256").update(JSON.stringify([order.orderId, course.id])).digest("hex");
    expect(await sourcePath(course.id, "payment_success", identity)).toBe(`/portal/notify.link/${vendor.id}/notifications`);
  });

  it("payment: a deterministic notification failure is skipped and reported, never rolling back the payment", async () => {
    // A product ID outside the notification identity grammar cannot be recorded.
    const odd = await getDb().product.create({ data: { id: `qa.odd.${randomUUID()}`, vendorId: vendor.id, name: "合成".repeat(1500), slug: `cjk-odd-${randomUUID()}`, priceCents: 1000, commerceDomain: "course", fulfillmentType: "course" }, select: { id: true, name: true } });
    const order = await paidOrder(buyer, odd.id, odd.name, "pending_payment");
    monitoring.capture.mockClear();
    const result = await getDb().$transaction(tx => reconcileCommerceOrderPaymentTransition(tx, { vendorId: vendor.id, paymentTransactionId: order.paymentId!, eventIdentity: `cjk_skip_${randomUUID()}`, transition: "paid", occurredAt: new Date() }), { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    expect(result).toMatchObject({ changed: true, status: "paid" });
    expect((await getDb().commerceOrder.findUniqueOrThrow({ where: { id: order.orderId } })).status).toBe("paid");
    expect(await getDb().learnerNotificationSourceEvent.count({ where: { vendorId: vendor.id, productId: odd.id } })).toBe(0);
    expect(monitoring.capture).toHaveBeenCalledWith(expect.objectContaining({ message: "Learner notification source skipped." }), expect.objectContaining({ status: "skipped_payment_success" }));
  });

  it("live start: the lifecycle transition commits and records a live link by ID", async () => {
    const live = await getDb().live.create({ data: { vendorId: vendor.id, title: "合成直播".repeat(700), slug: Array.from({ length: 60 }, () => "播").join("") + randomUUID().slice(0, 8), scheduledAt: new Date(), status: "scheduled" } });
    await getDb().liveProduct.create({ data: { vendorId: vendor.id, liveId: live.id, productId: course.id, isVisible: true } });
    const startedAt = new Date();
    await getDb().$transaction(async tx => {
      await tx.live.update({ where: { id: live.id }, data: { status: "live", startedAt } });
      await recordLearnerLiveStartedSources(tx, { vendorId: vendor.id, liveId: live.id, startedAt });
    });
    expect((await getDb().live.findUniqueOrThrow({ where: { id: live.id } })).status).toBe("live");
    const identity = createHash("sha256").update(JSON.stringify([live.id, startedAt.toISOString()])).digest("hex");
    expect(await sourcePath(course.id, "live_started", identity)).toBe(`/portal/notify.link/${vendor.id}/live/${live.id}`);
  });

  it("lesson publication commits and records a course link", async () => {
    const current = await getDb().product.findUniqueOrThrow({ where: { id: course.id } });
    const lessonId = await saveCourseLesson(getDb(), vendor.id, { productId: course.id, revision: current.revision, chapterTitle: "合成章節", title: "合成單元", videoUrl: "https://media.example.test/synthetic.mp4", durationSeconds: 60, published: true });
    const lesson = await getDb().courseLesson.findUniqueOrThrow({ where: { id: lessonId } });
    expect(lesson.publishedAt).not.toBeNull();
    const identity = createHash("sha256").update(JSON.stringify([lessonId, lesson.publishedAt!.toISOString()])).digest("hex");
    expect(await sourcePath(course.id, "lesson_published", identity)).toBe(`/portal/notify.link/${vendor.id}/learn/${course.id}`);
  });

  it("community reply commits and records a community link for the post author", async () => {
    await paidOrder(buyer, course.id, course.name, "paid");
    const post = await mutateCourseCommunity(getDb(), { vendorId: vendor.id, customerKeyHash: buyer }, course.id, { operation: "post", requestKey: randomUUID(), authorName: "合成作者", body: "合成提問" });
    expect(post).toEqual({ id: expect.any(String) });
    const reply = await mutateCourseCommunity(getDb(), { vendorId: vendor.id, customerKeyHash: replier }, course.id, { operation: "reply", postId: (post as { id: string }).id, requestKey: randomUUID(), authorName: "合成回覆者", body: "合成回覆" });
    expect(reply).toEqual({ id: expect.any(String) });
    expect(await getDb().courseCommunityReply.count({ where: { vendorId: vendor.id, productId: course.id, id: (reply as { id: string }).id } })).toBe(1);
    expect(await sourcePath(course.id, "discussion_reply", (reply as { id: string }).id)).toBe(`/portal/notify.link/${vendor.id}/learn/${course.id}/community/${(post as { id: string }).id}`);
  });
});
