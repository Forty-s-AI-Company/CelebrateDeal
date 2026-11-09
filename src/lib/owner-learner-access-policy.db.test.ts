import { createHash, randomBytes, randomUUID } from "node:crypto";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

// Owner policies decided 2026-11-10 (refund, suspension, blacklist), on real
// PostgreSQL. Only the request boundary (headers, navigation, CSRF, the IP
// limiter, mail transport and the post-response hook) is synthetic; payment
// callbacks, refunds, grants, portal capabilities and the blacklist run for real.
const mail = vi.hoisted(() => ({ send: vi.fn() }));
const cookieJar = vi.hoisted(() => ({ token: "" }));

vi.mock("next/headers", () => ({
  headers: vi.fn(async () => new Headers({ "user-agent": "synthetic-agent" })),
  // Only the back-office session cookie is ever present (for the merchant blacklist action).
  cookies: vi.fn(async () => ({
    get: (name: string) => (name.endsWith("celebrate_session") && cookieJar.token ? { value: cookieJar.token } : undefined),
    getAll: () => [],
    set: vi.fn(),
    delete: vi.fn(),
  })),
}));
vi.mock("next/navigation", () => ({
  redirect: (url: string): never => {
    throw new Error(`redirect:${url}`);
  },
  notFound: (): never => {
    throw new Error("not_found");
  },
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/csrf", () => ({ assertServerActionSecurity: vi.fn(async () => undefined) }));
vi.mock("@/lib/rate-limit", async (original) => ({
  ...await original<typeof import("@/lib/rate-limit")>(),
  checkRateLimit: vi.fn(async () => null),
}));
vi.mock("@/lib/email-delivery-immediate", async (original) => ({
  ...await original<typeof import("@/lib/email-delivery-immediate")>(),
  scheduleImmediateEmailDispatch: vi.fn(),
}));
vi.mock("@/lib/email", async (original) => ({
  ...await original<typeof import("@/lib/email")>(),
  sendTransactionalEmail: mail.send,
}));

import { upsertBlacklistAction } from "@/app/actions/interaction-actions";
import { requestMagicLinkAction } from "@/app/actions/student-portal-actions";
import { issueBuyerSupportGrant, resolveBuyerOrderDetail, resolveBuyerOrderItemDelivery } from "@/lib/buyer-support-access";
import { CommerceOrderValidationError, createCommerceOrderForCheckout, reconcileCommerceOrderRefund } from "@/lib/commerce-orders";
import { getDb } from "@/lib/db";
import { dispatchEmailDelivery } from "@/lib/email-delivery";
import { createReservedPaymentTransaction } from "@/lib/inventory-reservations";
import { generatePaymentOrderNumber } from "@/lib/payment-order-number";
import { PaymentWebhookPayload, processPaymentWebhook, UnknownCheckoutTransactionError } from "@/lib/payment-webhooks";
import { protectProductDeliveryConfig, validateProductDeliveryDraft } from "@/lib/product-delivery";
import { getStudentPortalDashboard } from "@/lib/student-portal";
import { STUDENT_PORTAL_INITIAL_STATE } from "@/lib/student-portal-action-state";
import {
  consumeStudentPortalAccessToken,
  createStudentPortalAccessToken,
  isStudentPortalSessionActive,
  type StudentPortalSession,
} from "@/lib/student-portal-auth";
import { isVendorAvailableForPublic, suspendVendor } from "@/lib/vendor-suspension";

const db = getDb();
const vendorIds: string[] = [];
const userIds: string[] = [];
const DESTINATION = "https://delivery.example.com/buyer/content";

type Tenant = { vendorId: string; slug: string };
type Checkout = { transactionId: string; orderNumber: string };

beforeAll(() => {
  process.env.CSRF_SECRET ??= "ci-csrf-fixture-32-bytes-safe-key";
  process.env.NEXT_PUBLIC_APP_URL ??= "https://app.example.test";
});

afterEach(async () => {
  cookieJar.token = "";
  mail.send.mockReset();
  await db.auditLog.deleteMany({ where: { vendorId: { in: vendorIds } } });
  await db.vendor.deleteMany({ where: { id: { in: vendorIds.splice(0) } } });
  await db.user.deleteMany({ where: { id: { in: userIds.splice(0) } } });
});

async function tenant(label: string): Promise<Tenant> {
  const key = randomUUID();
  const vendor = await db.vendor.create({
    data: { name: `Policy ${label}`, slug: `policy-${label.toLowerCase()}-${key}`, email: `vendor-${key}@example.test`, passwordHash: "synthetic-only" },
  });
  vendorIds.push(vendor.id);
  return { vendorId: vendor.id, slug: vendor.slug };
}

const SERVICE_INSTRUCTIONS = "付款後依此說明預約一對一服務。";

async function digitalCheckout(vendorId: string, buyerEmail: string, fulfillmentType: "digital" | "service" = "digital"): Promise<Checkout> {
  const product = await db.product.create({
    data: { vendorId, name: `合成${fulfillmentType === "service" ? "服務" : "數位"}商品 ${randomUUID().slice(0, 8)}`, slug: `${fulfillmentType}-${randomUUID()}`, priceCents: 1_200, currency: "TWD", inventory: 5, isActive: true, commerceDomain: "merchant", fulfillmentType, fulfillmentTypeConfirmed: true },
  });
  const delivery = fulfillmentType === "service"
    ? validateProductDeliveryDraft({ fulfillmentType, isActive: true, title: "合成服務說明", instructions: SERVICE_INSTRUCTIONS, hostConfirmed: false })!
    : validateProductDeliveryDraft({
      fulfillmentType, isActive: true, title: "合成下載", destinationUrl: DESTINATION,
      instructions: "付款後從訂單頁取得內容。", hostConfirmed: true,
    })!;
  const allowlist = delivery.destinationHostname
    ? await db.vendorDeliveryUrlAllowlist.findFirst({ where: { vendorId, hostname: delivery.destinationHostname, pathPrefix: delivery.destinationPathPrefix! } })
      ?? await db.vendorDeliveryUrlAllowlist.create({
        data: { vendorId, hostname: delivery.destinationHostname, pathPrefix: delivery.destinationPathPrefix!, allowQuery: false, status: "active" },
      })
    : null;
  const configId = randomUUID();
  await db.productDeliveryConfig.create({
    data: {
      id: configId, vendorId, productId: product.id, allowlistId: allowlist?.id ?? null, revision: 1, status: "active", fulfillmentType,
      deliveryKind: delivery.deliveryKind, title: delivery.title,
      ...protectProductDeliveryConfig(delivery, { vendorId, productId: product.id, configId, revision: 1 }),
      activatedAt: new Date(),
    },
  });
  const orderNumber = generatePaymentOrderNumber();
  const checkoutIdempotencyKey = randomUUID();
  const transaction = await createReservedPaymentTransaction({
    vendorId,
    productId: product.id,
    checkoutIdempotencyKey,
    transactionData: {
      vendorId, checkoutIdempotencyKey, providerName: "payuni", orderNumber, providerTradeNo: `trade-${randomUUID()}`,
      grossAmountCents: 1_200, netAmountCents: 1_200, currency: "TWD", status: "pending", metadata: { productId: product.id },
    },
    createCommerceOrder: async (tx, payment) => {
      await createCommerceOrderForCheckout(tx, {
        vendorId, productId: product.id, orderNumber, checkoutIdempotencyKey, paymentTransactionId: payment.id,
        totalAmountCents: 1_200, currency: "TWD", buyer: { name: "合成買家", email: buyerEmail, phone: "0912345678" }, shipping: null,
      });
    },
  });
  return { transactionId: transaction.id, orderNumber };
}

function paid(vendorId: string, checkout: Checkout) {
  return PaymentWebhookPayload.parse({ provider: "payuni", eventId: `policy-paid-${randomUUID()}`, eventType: "paid", vendorId, orderNumber: checkout.orderNumber, grossAmountCents: 1_200, currency: "TWD" });
}

function refund(vendorId: string, checkout: Checkout, eventType: "refunded" | "partially_refunded", refundAmountCents: number) {
  return PaymentWebhookPayload.parse({ provider: "payuni", eventId: `policy-refund-${randomUUID()}`, eventType, vendorId, orderNumber: checkout.orderNumber, refundAmountCents, currency: "TWD" });
}

async function order(checkout: Checkout) {
  return db.commerceOrder.findFirstOrThrow({
    where: { primaryPaymentTransactionId: checkout.transactionId },
    include: { items: { include: { entitlement: true, deliverySnapshot: true } }, refunds: true },
  });
}

/** A browser holding the HttpOnly /support grant cookie of each given order. */
async function supportBrowser(vendorId: string, orderIds: string[]) {
  const cookies: Array<{ name: string; value: string }> = [];
  for (const orderId of orderIds) {
    const cookie = await issueBuyerSupportGrant(db, { request: new Request("https://app.example.test/checkout/result"), vendorId, orderId });
    cookies.push({ name: cookie.name, value: cookie.value });
  }
  return { getAll: () => cookies };
}

async function supportDelivery(browser: { getAll(): Array<{ name: string; value: string }> }, current: Awaited<ReturnType<typeof order>>) {
  const grant = await db.buyerSupportOrderGrant.findUniqueOrThrow({ where: { vendorId_orderId: { vendorId: current.vendorId, orderId: current.id } } });
  return resolveBuyerOrderItemDelivery(db, browser, { grantId: grant.id, itemId: current.items[0]!.id });
}

/** Mints a learner portal session exactly as the emailed magic link does. */
async function learnerSession(vendorId: string, email: string): Promise<StudentPortalSession> {
  const token = await createStudentPortalAccessToken(db, { vendorId, email, purpose: "magic_link" });
  const claim = await consumeStudentPortalAccessToken(db, { token, expectedPurpose: "magic_link" });
  if (!claim) throw new Error("synthetic magic link was not consumed");
  return { vendorId, customerKeyHash: claim.customerKeyHash, grant: claim.grant, issuedAt: new Date(), expiresAt: new Date(Date.now() + 3_600_000) };
}

async function dashboardAccess(session: StudentPortalSession) {
  const dashboard = await getStudentPortalDashboard(db, { vendorId: session.vendorId, customerKeyHash: session.customerKeyHash });
  return new Map(dashboard.courses.map((course) => [course.orderId, { accessStatus: course.accessStatus, destinationUrl: course.destinationUrl }]));
}

/** Signs the vendor's owner into the back office, as the merchant blacklist page requires. */
async function signInOwner(vendorId: string) {
  const key = randomUUID();
  const owner = await db.user.create({ data: { name: "Owner", email: `owner-${key}@example.test`, passwordHash: "synthetic-only" } });
  userIds.push(owner.id);
  await db.vendorMember.create({ data: { vendorId, userId: owner.id, role: "owner" } });
  const token = randomBytes(32).toString("base64url");
  await db.userSession.create({
    data: { userId: owner.id, vendorId, tokenHash: createHash("sha256").update(token).digest("hex"), expiresAt: new Date(Date.now() + 3_600_000) },
  });
  cookieJar.token = token;
}

function blacklistForm(identifier: string) {
  const data = new FormData();
  data.set("identifierType", "email");
  data.set("identifier", identifier);
  data.set("reason", "synthetic");
  return data;
}

async function platformAdmin() {
  const key = randomUUID();
  const admin = await db.user.create({ data: { name: "Platform admin", email: `admin-${key}@example.test`, passwordHash: "synthetic-only", platformRole: "platform_admin" } });
  userIds.push(admin.id);
  return admin;
}

describe("owner policy 2026-11-10: a full refund withdraws only that order's delivered content", () => {
  it("keeps access through a partial refund, removes it on the full refund, keeps the session and the other paid order", async () => {
    const a = await tenant("A");
    const email = "learner@example.test";
    const refunded = await digitalCheckout(a.vendorId, email);
    const kept = await digitalCheckout(a.vendorId, email);
    await processPaymentWebhook(paid(a.vendorId, refunded));
    await processPaymentWebhook(paid(a.vendorId, kept));
    const session = await learnerSession(a.vendorId, email);
    const browser = await supportBrowser(a.vendorId, [(await order(refunded)).id, (await order(kept)).id]);

    // A partial refund changes nothing for the buyer's access.
    const partial = refund(a.vendorId, refunded, "partially_refunded", 400);
    await processPaymentWebhook(partial);
    const afterPartial = await order(refunded);
    expect(afterPartial).toMatchObject({ status: "partially_refunded", refundedAmountCents: 400 });
    expect(afterPartial.items[0]?.entitlement).toMatchObject({ status: "granted", revokedAt: null });
    expect(afterPartial.items[0]?.deliverySnapshot).toMatchObject({ revokedAt: null });
    await expect(supportDelivery(browser, afterPartial)).resolves.toMatchObject({ destinationUrl: DESTINATION });
    expect((await dashboardAccess(session)).get(afterPartial.id)).toEqual({ accessStatus: "active", destinationUrl: DESTINATION });

    // The refund that completes the order total withdraws that order's content; a duplicate callback changes nothing more.
    const full = refund(a.vendorId, refunded, "refunded", 800);
    await processPaymentWebhook(full);
    const afterFull = await order(refunded);
    await processPaymentWebhook(full);
    // A late replay of the earlier partial event fails closed instead of reopening anything.
    const lateReplay = processPaymentWebhook(partial);
    await expect(lateReplay).rejects.toBeInstanceOf(Error);
    await expect(lateReplay).rejects.toThrow("退款 webhook 事件類型與既存退款紀錄不一致。");
    const afterReplay = await order(refunded);
    expect(afterFull).toMatchObject({ status: "refunded", refundedAmountCents: 1_200 });
    expect(afterFull.items[0]?.entitlement).toMatchObject({ status: "revoked", revokedAt: expect.any(Date), accessEncryptedEnvelope: null });
    expect(afterFull.items[0]?.deliverySnapshot?.revokedAt).toBeInstanceOf(Date);
    expect(afterReplay).toMatchObject({ status: "refunded", refundedAmountCents: 1_200 });
    expect(afterReplay.refunds).toHaveLength(2);
    expect(afterReplay.items[0]?.entitlement?.revision).toBe(afterFull.items[0]?.entitlement?.revision);
    expect(await db.refundRecord.count({ where: { paymentTransactionId: refunded.transactionId } })).toBe(2);
    await expect(supportDelivery(browser, afterReplay)).resolves.toBeNull();

    // The other paid order of the same learner is untouched, on /support and in the portal.
    const other = await order(kept);
    expect(other).toMatchObject({ status: "paid", refundedAmountCents: 0 });
    expect(other.items[0]?.entitlement).toMatchObject({ status: "granted", revokedAt: null });
    await expect(supportDelivery(browser, other)).resolves.toMatchObject({ destinationUrl: DESTINATION });
    const access = await dashboardAccess(session);
    expect(access.get(afterReplay.id)).toEqual({ accessStatus: "unavailable", destinationUrl: null });
    expect(access.get(other.id)).toEqual({ accessStatus: "active", destinationUrl: DESTINATION });

    // The learner stays signed in: the refund does not end the portal session.
    await expect(isStudentPortalSessionActive(db, session)).resolves.toBe(true);
  });

  it("refuses a refund bound to another tenant and leaves that tenant's same-email learner untouched", async () => {
    const a = await tenant("A");
    const b = await tenant("B");
    const email = "shared-learner@example.test";
    const checkoutA = await digitalCheckout(a.vendorId, email);
    const checkoutB = await digitalCheckout(b.vendorId, email);
    await processPaymentWebhook(paid(a.vendorId, checkoutA));
    await processPaymentWebhook(paid(b.vendorId, checkoutB));
    const sessionA = await learnerSession(a.vendorId, email);
    const sessionB = await learnerSession(b.vendorId, email);
    const orderA = await order(checkoutA);
    const orderB = await order(checkoutB);

    // Vendor B's scope cannot refund vendor A's order, by order id or by order number.
    await expect(db.$transaction((tx) => reconcileCommerceOrderRefund(tx, {
      vendorId: b.vendorId, orderId: orderA.id, providerName: "payuni", eventIdentity: `cross-${randomUUID()}`, amountCents: 1_200, occurredAt: new Date(),
    }))).rejects.toThrow(new CommerceOrderValidationError("Canonical commerce order was not found."));
    await expect(processPaymentWebhook(refund(b.vendorId, checkoutA, "refunded", 1_200))).rejects.toBeInstanceOf(UnknownCheckoutTransactionError);
    expect(await order(checkoutA)).toMatchObject({ status: "paid", refundedAmountCents: 0 });
    expect((await order(checkoutA)).items[0]?.entitlement).toMatchObject({ status: "granted" });

    // A's own full refund withdraws only A's order.
    await processPaymentWebhook(refund(a.vendorId, checkoutA, "refunded", 1_200));
    expect((await order(checkoutA)).items[0]?.entitlement).toMatchObject({ status: "revoked" });
    expect(await order(checkoutB)).toMatchObject({ status: "paid", refundedAmountCents: 0 });
    expect((await order(checkoutB)).items[0]?.entitlement).toMatchObject({ status: "granted", revokedAt: null });
    expect((await dashboardAccess(sessionB)).get(orderB.id)).toEqual({ accessStatus: "active", destinationUrl: DESTINATION });
    expect((await dashboardAccess(sessionA)).get(orderA.id)).toEqual({ accessStatus: "unavailable", destinationUrl: null });
    await expect(isStudentPortalSessionActive(db, sessionA)).resolves.toBe(true);
    await expect(isStudentPortalSessionActive(db, sessionB)).resolves.toBe(true);
  });
});

describe("owner policy 2026-11-10: /support keeps paid buyers' delivery while the vendor is suspended", () => {
  it("serves content granted before the suspension, holds content paid during it, and still honours a full refund", async () => {
    const a = await tenant("A");
    const b = await tenant("B");
    const admin = await platformAdmin();
    const before = await digitalCheckout(a.vendorId, "buyer-before@example.test");
    const refundedLater = await digitalCheckout(a.vendorId, "buyer-refunded@example.test");
    const during = await digitalCheckout(a.vendorId, "buyer-during@example.test");
    const otherTenant = await digitalCheckout(b.vendorId, "buyer-before@example.test");
    await processPaymentWebhook(paid(a.vendorId, before));
    await processPaymentWebhook(paid(a.vendorId, refundedLater));
    await processPaymentWebhook(paid(b.vendorId, otherTenant));
    const browser = await supportBrowser(a.vendorId, [(await order(before)).id, (await order(refundedLater)).id, (await order(during)).id]);

    await expect(suspendVendor(db, { vendorId: a.vendorId, reason: "合成：凍結", actorUserId: admin.id })).resolves.toMatchObject({ status: "suspended" });
    await processPaymentWebhook(paid(a.vendorId, during));

    // The suspended vendor still sells nothing: public entry points stay closed.
    await expect(isVendorAvailableForPublic(db, a.vendorId)).resolves.toBe(false);
    await expect(isVendorAvailableForPublic(db, b.vendorId)).resolves.toBe(true);

    // A buyer who paid before the suspension keeps the order page and the delivery link.
    const beforeOrder = await order(before);
    const beforeGrant = await db.buyerSupportOrderGrant.findUniqueOrThrow({ where: { vendorId_orderId: { vendorId: a.vendorId, orderId: beforeOrder.id } } });
    await expect(resolveBuyerOrderDetail(db, browser, beforeGrant.id)).resolves.toMatchObject({ id: beforeOrder.id, status: "paid" });
    await expect(supportDelivery(browser, beforeOrder)).resolves.toMatchObject({ destinationUrl: DESTINATION, title: "合成下載" });

    // A payment booked during the suspension stays held (pending) until the suspension is lifted.
    const duringOrder = await order(during);
    expect(duringOrder).toMatchObject({ status: "paid" });
    expect(duringOrder.items[0]?.entitlement).toMatchObject({ status: "pending" });
    await expect(supportDelivery(browser, duringOrder)).resolves.toBeNull();

    // A full refund still withdraws that order's content during the suspension.
    await processPaymentWebhook(refund(a.vendorId, refundedLater, "refunded", 1_200));
    await expect(supportDelivery(browser, await order(refundedLater))).resolves.toBeNull();
    await expect(supportDelivery(browser, await order(before))).resolves.toMatchObject({ destinationUrl: DESTINATION });

    // The grant cookie of one tenant's order never opens another tenant's order.
    const otherOrder = await order(otherTenant);
    await expect(resolveBuyerOrderItemDelivery(db, browser, { grantId: beforeGrant.id, itemId: otherOrder.items[0]!.id })).resolves.toBeNull();
  });

  it("deliberately keeps service instructions for a buyer who paid during the suspension", async () => {
    const a = await tenant("A");
    const admin = await platformAdmin();
    const service = await digitalCheckout(a.vendorId, "service-buyer@example.test", "service");
    const browser = await supportBrowser(a.vendorId, [(await order(service)).id]);
    await suspendVendor(db, { vendorId: a.vendorId, reason: "合成：凍結", actorUserId: admin.id });

    await processPaymentWebhook(paid(a.vendorId, service));

    // Only digital/course entitlements are held; a service has none, and its
    // delivery instructions stay available because the buyer has paid.
    const serviceOrder = await order(service);
    expect(serviceOrder).toMatchObject({ status: "paid" });
    expect(serviceOrder.items[0]?.entitlement).toBeNull();
    await expect(supportDelivery(browser, serviceOrder)).resolves.toMatchObject({ title: "合成服務說明", instructions: SERVICE_INSTRUCTIONS, destinationUrl: null });
    await expect(isVendorAvailableForPublic(db, a.vendorId)).resolves.toBe(false);

    // A full refund still withdraws it.
    await processPaymentWebhook(refund(a.vendorId, service, "refunded", 1_200));
    await expect(supportDelivery(browser, await order(service))).resolves.toBeNull();
  });
});

describe("owner policy 2026-11-10: a blacklisted email cannot request a learner sign-in link", () => {
  function form(values: Record<string, string>) {
    const data = new FormData();
    for (const [key, value] of Object.entries(values)) data.set(key, value);
    return data;
  }
  const portalTokens = (vendorId: string) => db.studentPortalAccessToken.count({ where: { vendorId } });
  const portalMails = (vendorId: string) => db.emailDelivery.count({ where: { vendorId, trigger: "student_portal_magic_link" } });

  it("answers like an unknown address, issues nothing, applies only this vendor's list and lifts with the block", async () => {
    const a = await tenant("A");
    const b = await tenant("B");
    const email = "blocked-learner@example.test";
    const checkoutA = await digitalCheckout(a.vendorId, email);
    const checkoutB = await digitalCheckout(b.vendorId, email);
    await processPaymentWebhook(paid(a.vendorId, checkoutA));
    await processPaymentWebhook(paid(b.vendorId, checkoutB));
    // The merchant blocks the address through the real action, typed in mixed case.
    await signInOwner(a.vendorId);
    await upsertBlacklistAction(blacklistForm(" Blocked-Learner@EXAMPLE.test "));
    cookieJar.token = "";
    const block = await db.blacklist.findFirstOrThrow({ where: { vendorId: a.vendorId } });
    expect(block).toMatchObject({ identifierType: "email", identifier: email, isActive: true });

    const blocked = await requestMagicLinkAction(STUDENT_PORTAL_INITIAL_STATE, form({ email: " Blocked-Learner@Example.test ", vendorSlug: a.slug }));
    const unknown = await requestMagicLinkAction(STUDENT_PORTAL_INITIAL_STATE, form({ email: "nobody@example.test", vendorSlug: a.slug }));
    expect(blocked).toEqual(unknown);
    expect(blocked).toMatchObject({ status: "sent" });
    expect(await portalTokens(a.vendorId)).toBe(0);
    expect(await portalMails(a.vendorId)).toBe(0);

    // Vendor A's list does not apply at vendor B, and B's answer is the same generic one.
    await expect(requestMagicLinkAction(STUDENT_PORTAL_INITIAL_STATE, form({ email, vendorSlug: b.slug }))).resolves.toEqual(blocked);
    expect(await portalTokens(b.vendorId)).toBe(1);
    expect(await portalMails(b.vendorId)).toBe(1);

    // Lifting the block lets the same address request a link again.
    await db.blacklist.update({ where: { id: block.id }, data: { isActive: false, unblockedAt: new Date() } });
    await expect(requestMagicLinkAction(STUDENT_PORTAL_INITIAL_STATE, form({ email, vendorSlug: a.slug }))).resolves.toEqual(blocked);
    expect(await portalTokens(a.vendorId)).toBe(1);
    expect(await portalMails(a.vendorId)).toBe(1);
  });

  it("suppresses a link queued just before the block committed instead of mailing it", async () => {
    const a = await tenant("A");
    const email = "raced-learner@example.test";
    const checkout = await digitalCheckout(a.vendorId, email);
    await processPaymentWebhook(paid(a.vendorId, checkout));
    await requestMagicLinkAction(STUDENT_PORTAL_INITIAL_STATE, form({ email, vendorSlug: a.slug }));
    const queued = await db.emailDelivery.findFirstOrThrow({ where: { vendorId: a.vendorId, trigger: "student_portal_magic_link" } });
    // The block lands after the request passed its check; its token revocation missed the new row.
    await db.blacklist.create({ data: { vendorId: a.vendorId, identifier: email, identifierType: "email", reason: "synthetic" } });

    await expect(dispatchEmailDelivery(queued.id)).resolves.toEqual({ status: "suppressed" });
    expect(mail.send).not.toHaveBeenCalled();
    await expect(db.emailDelivery.findUniqueOrThrow({ where: { id: queued.id } })).resolves.toMatchObject({ status: "suppressed", lastErrorCode: "recipient_blacklisted" });
  });

  it("revokes again after commit, so a link committed after the in-transaction revocation cannot mint a session", async () => {
    const a = await tenant("A");
    const b = await tenant("B");
    const email = "late-link@example.test";
    await signInOwner(a.vendorId);
    const keptAtB = await createStudentPortalAccessToken(db, { vendorId: b.vendorId, email, purpose: "magic_link" });
    // Commit the block's transaction, then land a link the in-transaction revocation could not see
    // (a request that passed its blacklist check while the block was still uncommitted).
    let lateLink = "";
    const original = db.$transaction.bind(db);
    const transactions = vi.spyOn(db, "$transaction").mockImplementationOnce(async (...args: unknown[]) => {
      const result = await (original as (...input: unknown[]) => Promise<unknown>)(...args);
      lateLink = await createStudentPortalAccessToken(db, { vendorId: a.vendorId, email, purpose: "magic_link" });
      return result;
    });
    try {
      await upsertBlacklistAction(blacklistForm("Late-Link@Example.Test"));
    } finally {
      transactions.mockRestore();
    }

    expect(lateLink).not.toBe("");
    await expect(consumeStudentPortalAccessToken(db, { token: lateLink, expectedPurpose: "magic_link" })).resolves.toBeNull();
    expect(await portalTokens(a.vendorId)).toBe(0);
    // The post-commit pass is bound to this vendor: the same address elsewhere keeps its link.
    await expect(consumeStudentPortalAccessToken(db, { token: keptAtB, expectedPurpose: "magic_link" })).resolves.not.toBeNull();
    // The persisted audit redacts token-named fields; the summed count is covered in src/app/actions.test.ts.
    await expect(db.auditLog.count({ where: { vendorId: a.vendorId, action: "blacklist_created" } })).resolves.toBe(1);
  });
});
