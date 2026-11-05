import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Only the request/transport edges are replaced. The order, PII, key hash,
// portal action, token, dashboard and course access code paths are real and
// run against the disposable PostgreSQL database.
const edges = vi.hoisted(() => ({ dispatch: vi.fn() }));
vi.mock("next/headers", () => ({ headers: async () => new Headers(), cookies: async () => ({ get: () => undefined, getAll: () => [], set: vi.fn(), delete: vi.fn() }) }));
vi.mock("next/navigation", () => ({ redirect: (url: string) => { throw new Error(`redirect:${url}`); } }));
vi.mock("@/lib/csrf", () => ({ assertServerActionSecurity: async () => undefined }));
vi.mock("@/lib/rate-limit", () => ({ checkRateLimit: async () => null }));
vi.mock("@/lib/account-rate-limit", () => ({ checkAccountRateLimit: async () => null }));
vi.mock("@/lib/app-url", async (original) => ({ ...(await original<typeof import("@/lib/app-url")>()), getCanonicalAppUrl: () => "https://app.example.test" }));
vi.mock("@/lib/email-delivery-immediate", () => ({ scheduleImmediateEmailDispatch: edges.dispatch }));

import { requestMagicLinkAction } from "@/app/actions/student-portal-actions";
import { automationCustomerKeyHash } from "@/lib/automation-workflow";
import { createCommerceOrderForCheckout, reconcileCommerceOrderPaymentTransition } from "@/lib/commerce-orders";
import { saveCourseLesson } from "@/lib/course-curriculum";
import { getDb } from "@/lib/db";
import { revealEmailDeliveryPayload } from "@/lib/email-delivery-pii";
import { applyPaymentInventoryTransition, createReservedPaymentTransaction } from "@/lib/inventory-reservations";
import { protectProductDeliveryConfig, validateProductDeliveryDraft } from "@/lib/product-delivery";
import { getStudentPortalDashboard } from "@/lib/student-portal";
import { consumeStudentPortalAccessToken } from "@/lib/student-portal-auth";
import { getStudentCourse } from "@/lib/student-course-learning";

const db = getDb();
const vendorIds: string[] = [];
const checkoutEmail = "  Learner.Journey@Example.TEST ";
const signInEmail = " learner.JOURNEY@example.test";

async function courseVendor() {
  const suffix = randomUUID();
  const vendor = await db.vendor.create({ data: { name: "Synthetic journey academy", slug: `journey-${suffix}`, email: `${suffix}@example.test`, passwordHash: "synthetic-only" } });
  vendorIds.push(vendor.id);
  const product = await db.product.create({ data: {
    vendorId: vendor.id, name: "Synthetic journey course", slug: `journey-course-${suffix}`, priceCents: 2_400, currency: "TWD", inventory: 10,
    isActive: true, commerceDomain: "course", fulfillmentType: "course",
  } });
  const delivery = validateProductDeliveryDraft({
    fulfillmentType: "course", isActive: true, title: "合成課程入口",
    destinationUrl: "https://delivery.example.com/course/journey", instructions: "付款後從學員中心進入。", hostConfirmed: true,
  })!;
  const allowlist = await db.vendorDeliveryUrlAllowlist.create({ data: {
    vendorId: vendor.id, hostname: delivery.destinationHostname!, pathPrefix: delivery.destinationPathPrefix!, allowQuery: false, status: "active",
  } });
  const configId = randomUUID();
  await db.productDeliveryConfig.create({ data: {
    id: configId, vendorId: vendor.id, productId: product.id, allowlistId: allowlist.id, revision: 1, status: "active",
    fulfillmentType: "course", deliveryKind: delivery.deliveryKind, title: delivery.title,
    ...protectProductDeliveryConfig(delivery, { vendorId: vendor.id, productId: product.id, configId, revision: 1 }),
    activatedAt: new Date("2026-11-01T08:00:00.000Z"),
  } });
  const lessonId = await saveCourseLesson(db, vendor.id, {
    productId: product.id, revision: product.revision, chapterTitle: "第一章", title: "第一單元",
    videoUrl: "https://media.example.test/journey.mp4", durationSeconds: 120, published: true,
  });
  return { vendor, product, lessonId };
}

/** The checkout route's order writer, followed by the provider-paid transition. */
async function checkoutAndPay(vendorId: string, productId: string, priceCents: number, email: string) {
  const orderNumber = `JOURNEY-${randomUUID()}`;
  const checkoutIdempotencyKey = randomUUID();
  const payment = await createReservedPaymentTransaction({
    vendorId, productId, checkoutIdempotencyKey,
    transactionData: { vendorId, checkoutIdempotencyKey, providerName: "demo", orderNumber, grossAmountCents: priceCents, netAmountCents: priceCents, currency: "TWD", status: "pending", metadata: { productId } },
    createCommerceOrder: async (tx, created) => {
      await createCommerceOrderForCheckout(tx, {
        vendorId, productId, orderNumber, checkoutIdempotencyKey, paymentTransactionId: created.id,
        totalAmountCents: priceCents, currency: "TWD", buyer: { name: "合成學員", email }, shipping: null,
      });
    },
  });
  const paidAt = new Date();
  await db.$transaction(async (tx) => {
    const transaction = await tx.paymentTransaction.update({ where: { id: payment.id }, data: { status: "paid", occurredAt: paidAt } });
    await applyPaymentInventoryTransition(tx, { transaction, eventType: "paid", trustedCheckoutMetadata: { productId }, now: paidAt });
    await reconcileCommerceOrderPaymentTransition(tx, { vendorId, paymentTransactionId: transaction.id, eventIdentity: `journey-${randomUUID()}`, transition: "paid", occurredAt: paidAt });
  });
  return db.commerceOrder.findFirstOrThrow({ where: { vendorId, primaryPaymentTransactionId: payment.id } });
}

function signInForm(vendorSlug: string, email: string) {
  const form = new FormData();
  form.set("vendorSlug", vendorSlug);
  form.set("email", email);
  return form;
}

beforeEach(() => {
  vi.stubEnv("CSRF_SECRET", "synthetic-checkout-portal-journey-key-0123456789");
  edges.dispatch.mockReset();
});

afterEach(async () => {
  await db.vendor.deleteMany({ where: { id: { in: vendorIds.splice(0) } } });
  vi.unstubAllEnvs();
});

describe("checkout buyer reaches the learner portal (PostgreSQL)", () => {
  it("lets a checkout-only buyer request a sign-in link, see the order and open the course", async () => {
    const { vendor, product, lessonId } = await courseVendor();
    const order = await checkoutAndPay(vendor.id, product.id, product.priceCents, checkoutEmail);
    const customerKeyHash = automationCustomerKeyHash(vendor.id, signInEmail);

    // The checkout wrote the tenant-bound key; no fixture seeded it.
    expect(order).toMatchObject({ status: "paid", automationCustomerKeyHash: customerKeyHash });
    expect(JSON.stringify(order).toLowerCase()).not.toContain("learner.journey@example.test");
    // The paid transition can now address the learner's payment notification.
    expect(await db.learnerNotificationSourceEvent.findMany({ where: { vendorId: vendor.id, event: "payment_success" }, select: { audienceCustomerKeyHash: true } }))
      .toEqual([{ audienceCustomerKeyHash: customerKeyHash }]);

    const result = await requestMagicLinkAction({ status: "idle", message: "" }, signInForm(vendor.slug, signInEmail));
    expect(result.status).toBe("sent");
    const deliveries = await db.emailDelivery.findMany({ where: { vendorId: vendor.id, trigger: "student_portal_magic_link" } });
    expect(deliveries).toHaveLength(1);
    expect(edges.dispatch).toHaveBeenCalledWith([deliveries[0]!.id]);
    const mail = revealEmailDeliveryPayload(deliveries[0]!.payloadEncryptedEnvelope, { vendorId: vendor.id, deliveryId: deliveries[0]!.id });
    expect(mail.recipientEmail).toBe("learner.journey@example.test");
    const link = new URL(mail.body.match(/https:\/\/app\.example\.test\/portal\/\S+/u)![0]);
    expect(link.pathname).toBe(`/portal/${vendor.slug}/access`);

    const session = await consumeStudentPortalAccessToken(db, { token: link.searchParams.get("token")!, expectedPurpose: "magic_link" });
    expect(session).toMatchObject({ vendorId: vendor.id, customerKeyHash });
    const scope = { vendorId: session!.vendorId, customerKeyHash: session!.customerKeyHash };

    const dashboard = await getStudentPortalDashboard(db, scope);
    expect(dashboard.orders.map((row) => row.id)).toEqual([order.id]);
    expect(dashboard.courses.map((course) => course.productId)).toEqual([product.id]);

    const course = await getStudentCourse(db, scope, product.id);
    expect(course?.lessons.map((lesson) => lesson.id)).toEqual([lessonId]);
  });

  it("keeps the same buyer's checkout order out of another tenant's portal", async () => {
    const owner = await courseVendor();
    const other = await courseVendor();
    const order = await checkoutAndPay(owner.vendor.id, owner.product.id, owner.product.priceCents, checkoutEmail);

    // Same e-mail, other vendor: no order there, so no link is queued.
    const result = await requestMagicLinkAction({ status: "idle", message: "" }, signInForm(other.vendor.slug, signInEmail));
    expect(result.status).toBe("sent");
    expect(await db.emailDelivery.count({ where: { vendorId: { in: [owner.vendor.id, other.vendor.id] } } })).toBe(0);
    expect(edges.dispatch).not.toHaveBeenCalled();

    const otherScope = { vendorId: other.vendor.id, customerKeyHash: automationCustomerKeyHash(other.vendor.id, signInEmail) };
    expect(otherScope.customerKeyHash).not.toBe(order.automationCustomerKeyHash);
    expect((await getStudentPortalDashboard(db, otherScope)).orders).toEqual([]);
    await expect(getStudentCourse(db, otherScope, owner.product.id)).resolves.toBeNull();
  });
});
