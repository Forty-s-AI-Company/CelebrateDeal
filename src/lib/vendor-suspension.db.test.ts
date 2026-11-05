import { createHash, randomBytes, randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

// F-036 (B02-14) and F-030 wiring on real PostgreSQL. Only the request
// boundary (cookies, headers, navigation, CSRF, mail transport and the
// post-response hook) is synthetic; every guard and query runs for real.
const cookieJar = vi.hoisted(() => ({ token: "" }));
const mail = vi.hoisted(() => ({ send: vi.fn() }));

vi.mock("next/headers", () => ({
  // Matches the current back-office cookie and its pre-rename name.
  cookies: vi.fn(async () => ({
    get: (name: string) => (name.endsWith("celebrate_session") && cookieJar.token ? { value: cookieJar.token } : undefined),
    set: vi.fn(),
    delete: vi.fn(),
  })),
  headers: vi.fn(async () => new Headers({ "user-agent": "synthetic-agent" })),
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
vi.mock("@/lib/email-delivery-immediate", async (original) => ({
  ...await original<typeof import("@/lib/email-delivery-immediate")>(),
  scheduleImmediateEmailDispatch: vi.fn(),
}));
// M1: lets one test commit a concurrent Vendor update between the webhook
// transaction's snapshot and its `FOR SHARE` read of the vendor.
const race = vi.hoisted(() => ({ vendorId: "", pending: false, orderTransitionRuns: 0 }));
vi.mock("@/lib/payment-webhook-errors", async (original) => {
  const actual = await original<typeof import("@/lib/payment-webhook-errors")>();
  return {
    ...actual,
    withPaymentWebhookStage: async <T,>(stage: Parameters<typeof actual.withPaymentWebhookStage>[0], action: () => T | Promise<T>) => {
      if (stage === "ORDER_TRANSITION" && race.vendorId) {
        race.orderTransitionRuns += 1;
        if (race.pending) {
          race.pending = false;
          const { getDb: outside } = await import("@/lib/db");
          await outside().vendor.update({ where: { id: race.vendorId }, data: { name: `Concurrent rename ${Date.now()}` } });
        }
      }
      return actual.withPaymentWebhookStage(stage, action);
    },
  };
});
vi.mock("@/lib/email", async (original) => ({
  ...await original<typeof import("@/lib/email")>(),
  sendTransactionalEmail: mail.send,
}));

import { upsertBlacklistAction } from "@/app/actions/interaction-actions";
import { resumeVendorAction, suspendVendorAction, switchFromSuspendedVendorAction } from "@/app/actions/vendor-suspension-actions";
import { getCurrentAuth, requireVendorContext } from "@/lib/auth";
import { createCommerceOrderForCheckout, reconcileCommerceOrderRefund } from "@/lib/commerce-orders";
import { getDb } from "@/lib/db";
import { dispatchEmailDelivery, processDueEmailDeliveries } from "@/lib/email-delivery";
import { createReservedPaymentTransaction } from "@/lib/inventory-reservations";
import { generatePaymentOrderNumber } from "@/lib/payment-order-number";
import { PaymentWebhookPayload, processPaymentWebhook } from "@/lib/payment-webhooks";
import { protectProductDeliveryConfig, validateProductDeliveryDraft } from "@/lib/product-delivery";
import { loadPublicRegistrationForm } from "@/lib/public-registration-form";
import { publicLiveAvailabilityWhere } from "@/lib/sellable-live";
import { createStudentPortalAccessToken } from "@/lib/student-portal-auth";
import { isVendorAvailableForPublic, releaseHeldEntitlements, resumeVendor, suspendVendor } from "@/lib/vendor-suspension";

const db = getDb();
const vendorIds: string[] = [];
const userIds: string[] = [];

type Tenant = { vendorId: string; slug: string; ownerId: string; formSlug: string; liveId: string };

beforeAll(() => {
  process.env.CSRF_SECRET ??= "ci-csrf-fixture-32-bytes-safe-key";
});

afterEach(async () => {
  cookieJar.token = "";
  race.vendorId = ""; race.pending = false; race.orderTransitionRuns = 0;
  mail.send.mockReset();
  await db.auditLog.deleteMany({ where: { vendorId: { in: vendorIds } } });
  await db.vendor.deleteMany({ where: { id: { in: vendorIds.splice(0) } } });
  await db.user.deleteMany({ where: { id: { in: userIds.splice(0) } } });
});

async function createTenant(label: string): Promise<Tenant> {
  const key = randomUUID();
  const vendor = await db.vendor.create({
    data: { name: `Suspension ${label}`, slug: `suspension-${label.toLowerCase()}-${key}`, email: `vendor-${key}@example.test`, passwordHash: "synthetic-only" },
  });
  vendorIds.push(vendor.id);
  const owner = await db.user.create({ data: { name: `Owner ${label}`, email: `owner-${key}@example.test`, passwordHash: "synthetic-only" } });
  userIds.push(owner.id);
  await db.vendorMember.create({ data: { vendorId: vendor.id, userId: owner.id, role: "owner" } });
  const form = await db.registrationForm.create({
    data: { vendorId: vendor.id, name: `Form ${label}`, slug: `suspension-form-${key}`, headline: "報名", fields: [{ key: "name", label: "姓名", type: "text", required: true }] },
  });
  const live = await db.live.create({
    data: { vendorId: vendor.id, title: `Live ${label}`, slug: `suspension-live-${key}`, scheduledAt: new Date(Date.now() + 86_400_000), status: "scheduled" },
  });
  return { vendorId: vendor.id, slug: vendor.slug, ownerId: owner.id, formSlug: form.slug, liveId: live.id };
}

async function createPlatformAdmin(mfaVerifiedAt: Date | null) {
  const key = randomUUID();
  const admin = await db.user.create({ data: { name: "Platform admin", email: `admin-${key}@example.test`, passwordHash: "synthetic-only", platformRole: "platform_admin" } });
  userIds.push(admin.id);
  await db.userMfaFactor.create({ data: { userId: admin.id, secretEncrypted: "synthetic-not-decrypted" } });
  await signIn(admin.id, null, mfaVerifiedAt);
  return admin;
}

async function signIn(userId: string, vendorId: string | null, mfaVerifiedAt: Date | null = null) {
  const token = randomBytes(32).toString("base64url");
  await db.userSession.create({
    data: { userId, vendorId, tokenHash: createHash("sha256").update(token).digest("hex"), mfaVerifiedAt, expiresAt: new Date(Date.now() + 3_600_000) },
  });
  cookieJar.token = token;
  return token;
}

async function outcome(run: () => Promise<unknown>) {
  try {
    await run();
    return "completed";
  } catch (error) {
    if (error instanceof Error && (error.message.startsWith("redirect:") || error.message === "not_found")) return error.message;
    throw error;
  }
}

function form(entries: Record<string, string>) {
  const data = new FormData();
  for (const [key, value] of Object.entries(entries)) data.set(key, value);
  return data;
}

async function digitalCheckout(vendorId: string, buyerEmail: string) {
  const product = await db.product.create({
    data: { vendorId, name: "合成數位商品", slug: `digital-${randomUUID()}`, priceCents: 1_200, currency: "TWD", inventory: 5, isActive: true, commerceDomain: "merchant", fulfillmentType: "digital", fulfillmentTypeConfirmed: true },
  });
  const delivery = validateProductDeliveryDraft({
    fulfillmentType: "digital", isActive: true, title: "合成下載", destinationUrl: "https://delivery.example.com/buyer/content",
    instructions: "付款後從訂單頁取得內容。", hostConfirmed: true,
  })!;
  // One allowlist row per vendor host/prefix; a second checkout of the same vendor reuses it.
  const allowlist = await db.vendorDeliveryUrlAllowlist.findFirst({ where: { vendorId, hostname: delivery.destinationHostname!, pathPrefix: delivery.destinationPathPrefix! } })
    ?? await db.vendorDeliveryUrlAllowlist.create({
      data: { vendorId, hostname: delivery.destinationHostname!, pathPrefix: delivery.destinationPathPrefix!, allowQuery: false, status: "active" },
    });
  const configId = randomUUID();
  await db.productDeliveryConfig.create({
    data: {
      id: configId, vendorId, productId: product.id, allowlistId: allowlist.id, revision: 1, status: "active", fulfillmentType: "digital",
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
  return { transaction, orderNumber };
}

function paid(vendorId: string, orderNumber: string) {
  return PaymentWebhookPayload.parse({ provider: "payuni", eventId: `suspension-${randomUUID()}`, eventType: "paid", vendorId, orderNumber, grossAmountCents: 1_200, currency: "TWD" });
}

async function orderState(transactionId: string) {
  return db.commerceOrder.findFirstOrThrow({
    where: { primaryPaymentTransactionId: transactionId },
    include: { items: { include: { entitlement: true } }, events: { where: { eventType: "payment.paid" } } },
  });
}

describe("F-036 vendor suspension: back office", () => {
  it("withholds a suspended vendor from getCurrentAuth, guards and Server Actions without touching the other tenant", async () => {
    const a = await createTenant("A");
    const b = await createTenant("B");
    const admin = await createPlatformAdmin(new Date());
    await expect(suspendVendor(db, { vendorId: a.vendorId, reason: "合成：違反服務條款", actorUserId: admin.id })).resolves.toMatchObject({ status: "suspended" });

    await signIn(a.ownerId, a.vendorId);
    const suspended = await getCurrentAuth();
    expect(suspended).toMatchObject({ vendor: null, member: null, partnerPortalOnly: false, suspendedVendor: { id: a.vendorId, name: "Suspension A" } });
    await expect(outcome(() => requireVendorContext())).resolves.toBe("redirect:/vendor-suspended");
    // A Server Action of the suspended tenant is refused before any write.
    await expect(outcome(() => upsertBlacklistAction(form({ identifierType: "email", identifier: "blocked@example.test", reason: "spam" })))).resolves.toBe("redirect:/vendor-suspended");
    expect(await db.blacklist.count({ where: { vendorId: a.vendorId } })).toBe(0);

    await signIn(b.ownerId, b.vendorId);
    await expect(getCurrentAuth()).resolves.toMatchObject({ vendor: { id: b.vendorId }, member: { vendorId: b.vendorId }, suspendedVendor: null });
    await expect(outcome(() => upsertBlacklistAction(form({ identifierType: "email", identifier: "blocked@example.test", reason: "spam" })))).resolves.toBe("completed");
    expect(await db.blacklist.count({ where: { vendorId: b.vendorId } })).toBe(1);

    await expect(resumeVendor(db, { vendorId: a.vendorId, actorUserId: admin.id })).resolves.toMatchObject({ status: "resumed" });
    await signIn(a.ownerId, a.vendorId);
    await expect(getCurrentAuth()).resolves.toMatchObject({ vendor: { id: a.vendorId }, suspendedVendor: null });
  });

  it("prefers a member's other, active vendor when the session names none", async () => {
    const a = await createTenant("A");
    const b = await createTenant("B");
    await db.vendorMember.create({ data: { vendorId: b.vendorId, userId: a.ownerId, role: "admin" } });
    const admin = await createPlatformAdmin(new Date());
    await suspendVendor(db, { vendorId: a.vendorId, reason: "合成", actorUserId: admin.id });

    await signIn(a.ownerId, null);
    await expect(getCurrentAuth()).resolves.toMatchObject({ vendor: { id: b.vendorId }, suspendedVendor: null });
    // An explicit session vendor is honoured even when suspended.
    const token = await signIn(a.ownerId, a.vendorId);
    await expect(getCurrentAuth()).resolves.toMatchObject({ vendor: null, suspendedVendor: { id: a.vendorId } });
    // The suspended page can move this session only to the user's own active vendor.
    const stranger = await createTenant("C");
    await expect(outcome(() => switchFromSuspendedVendorAction(form({ vendorId: stranger.vendorId })))).resolves.toBe("redirect:/vendor-suspended");
    await expect(outcome(() => switchFromSuspendedVendorAction(form({ vendorId: b.vendorId })))).resolves.toBe("redirect:/dashboard");
    cookieJar.token = token;
    // The member's role is recomputed for the new vendor (owner of A, admin of B).
    await expect(getCurrentAuth()).resolves.toMatchObject({ vendor: { id: b.vendorId }, member: { vendorId: b.vendorId, role: "admin" }, suspendedVendor: null });
    const audit = await db.auditLog.findFirstOrThrow({ where: { vendorId: b.vendorId, action: "session_vendor_switched", actorId: a.ownerId } });
    // The suspended tenant is not named in the other tenant's audit trail.
    expect(audit.before).toEqual({ from: "suspended_vendor" });
    expect(JSON.stringify(audit.before)).not.toContain(a.vendorId);
    // Once off the suspended vendor, the switch is no longer available.
    await expect(outcome(() => switchFromSuspendedVendorAction(form({ vendorId: b.vendorId })))).resolves.toBe("redirect:/dashboard");
    await expect(db.auditLog.count({ where: { action: "session_vendor_switched", actorId: a.ownerId } })).resolves.toBe(1);
  });

  it("refuses a switch to another suspended vendor, a partner membership or an inactive membership", async () => {
    const a = await createTenant("A");
    const alsoSuspended = await createTenant("S");
    const partnerOnly = await createTenant("P");
    const deactivated = await createTenant("D");
    await db.vendorMember.createMany({ data: [
      { vendorId: alsoSuspended.vendorId, userId: a.ownerId, role: "admin" },
      { vendorId: partnerOnly.vendorId, userId: a.ownerId, role: "partner" },
      { vendorId: deactivated.vendorId, userId: a.ownerId, role: "admin", status: "inactive" },
    ] });
    const admin = await createPlatformAdmin(new Date());
    await suspendVendor(db, { vendorId: a.vendorId, reason: "合成", actorUserId: admin.id });
    await suspendVendor(db, { vendorId: alsoSuspended.vendorId, reason: "合成", actorUserId: admin.id });
    const token = await signIn(a.ownerId, a.vendorId);
    for (const target of [alsoSuspended, partnerOnly, deactivated]) {
      cookieJar.token = token;
      await expect(outcome(() => switchFromSuspendedVendorAction(form({ vendorId: target.vendorId })))).resolves.toBe("redirect:/vendor-suspended");
    }
    await expect(db.userSession.findFirstOrThrow({ where: { userId: a.ownerId, tokenHash: createHash("sha256").update(token).digest("hex") } })).resolves.toMatchObject({ vendorId: a.vendorId });
    await expect(db.auditLog.count({ where: { action: "session_vendor_switched", actorId: a.ownerId } })).resolves.toBe(0);
  });
});

describe("F-036 platform admin actions", () => {
  it("require a recent MFA step-up before any change", async () => {
    const a = await createTenant("A");
    await createPlatformAdmin(new Date(Date.now() - 20 * 60_000));
    const result = await outcome(() => suspendVendorAction(form({ vendorId: a.vendorId, reason: "合成" })));
    expect(result).toMatch(/^redirect:\/mfa\/verify\?reason=step_up/u);
    await expect(db.vendor.findUniqueOrThrow({ where: { id: a.vendorId } })).resolves.toMatchObject({ suspendedAt: null, suspendedReason: null });
    expect(await db.auditLog.count({ where: { vendorId: a.vendorId, action: { startsWith: "vendor_suspen" } } })).toBe(0);
  });

  it("suspend and resume with audit rows bound to the target vendor only", async () => {
    const a = await createTenant("A");
    const b = await createTenant("B");
    const admin = await createPlatformAdmin(new Date());
    await expect(outcome(() => suspendVendorAction(form({ vendorId: a.vendorId, reason: "  " })))).resolves.toBe("redirect:/admin/vendor-features?suspensionError=reason_required");
    await expect(outcome(() => suspendVendorAction(form({ vendorId: a.vendorId, reason: "合成" })))).resolves.toBe("redirect:/admin/vendor-features?suspensionError=confirm_required");
    await expect(outcome(() => suspendVendorAction(form({ vendorId: a.vendorId, reason: " 合成：退款爭議過多 ", confirm: "on" }))))
      .resolves.toBe(`redirect:/admin/vendor-features?suspension=suspended&vendor=${a.vendorId}#vendor-${a.vendorId}`);
    const suspended = await db.vendor.findUniqueOrThrow({ where: { id: a.vendorId } });
    expect(suspended).toMatchObject({ suspendedAt: expect.any(Date), suspendedReason: "合成：退款爭議過多" });
    await expect(db.auditLog.findFirstOrThrow({ where: { vendorId: a.vendorId, action: "vendor_suspended" } }))
      .resolves.toMatchObject({ actorId: admin.id, actorLabel: "platform_admin", targetType: "Vendor", targetId: a.vendorId, userAgent: "synthetic-agent", after: expect.objectContaining({ reason: "合成：退款爭議過多" }) });
    await expect(outcome(() => suspendVendorAction(form({ vendorId: a.vendorId, reason: "again", confirm: "on" })))).resolves.toBe("redirect:/admin/vendor-features?suspensionError=already_suspended");

    await expect(outcome(() => resumeVendorAction(form({ vendorId: a.vendorId }))))
      .resolves.toBe(`redirect:/admin/vendor-features?suspension=resumed&vendor=${a.vendorId}#vendor-${a.vendorId}`);
    await expect(db.vendor.findUniqueOrThrow({ where: { id: a.vendorId } })).resolves.toMatchObject({ suspendedAt: null, suspendedReason: null });
    await expect(db.auditLog.count({ where: { vendorId: a.vendorId, action: "vendor_suspension_lifted", actorId: admin.id } })).resolves.toBe(1);
    // Nothing happened to the other tenant.
    await expect(db.vendor.findUniqueOrThrow({ where: { id: b.vendorId } })).resolves.toMatchObject({ suspendedAt: null });
    expect(await db.auditLog.count({ where: { vendorId: b.vendorId } })).toBe(0);
  });

  it("refuses non-admin members and the CHECK constraint rejects a reason without a suspension", async () => {
    const a = await createTenant("A");
    await signIn(a.ownerId, a.vendorId, new Date());
    await expect(outcome(() => suspendVendorAction(form({ vendorId: a.vendorId, reason: "合成" })))).resolves.toBe("redirect:/dashboard");
    await expect(db.vendor.findUniqueOrThrow({ where: { id: a.vendorId } })).resolves.toMatchObject({ suspendedAt: null });
    await expect(db.vendor.update({ where: { id: a.vendorId }, data: { suspendedReason: "orphan reason" } })).rejects.toThrow();
    await expect(db.vendor.update({ where: { id: a.vendorId }, data: { suspendedAt: new Date() } })).rejects.toThrow();
  });
});

describe("F-036 public surfaces", () => {
  it("hide a suspended vendor's form, live and checkout eligibility only", async () => {
    const a = await createTenant("A");
    const b = await createTenant("B");
    const admin = await createPlatformAdmin(new Date());
    await suspendVendor(db, { vendorId: a.vendorId, reason: "合成", actorUserId: admin.id });

    await expect(loadPublicRegistrationForm(a.formSlug)).resolves.toBeNull();
    await expect(loadPublicRegistrationForm(b.formSlug)).resolves.toMatchObject({ slug: b.formSlug });
    expect(await db.live.count({ where: { id: a.liveId, ...publicLiveAvailabilityWhere() } })).toBe(0);
    expect(await db.live.count({ where: { id: b.liveId, ...publicLiveAvailabilityWhere() } })).toBe(1);
    await expect(isVendorAvailableForPublic(db, a.vendorId)).resolves.toBe(false);
    await expect(isVendorAvailableForPublic(db, b.vendorId)).resolves.toBe(true);
  });
});

describe("F-036 payments and jobs", () => {
  it("records a suspended vendor's PayUni payment without opening access; resume grants it; receipts wait", async () => {
    const a = await createTenant("A");
    const b = await createTenant("B");
    const admin = await createPlatformAdmin(new Date());
    const checkoutA = await digitalCheckout(a.vendorId, "buyer-a@example.test");
    const checkoutB = await digitalCheckout(b.vendorId, "buyer-b@example.test");
    await suspendVendor(db, { vendorId: a.vendorId, reason: "合成", actorUserId: admin.id });

    await processPaymentWebhook(paid(a.vendorId, checkoutA.orderNumber));
    await processPaymentWebhook(paid(b.vendorId, checkoutB.orderNumber));

    // The money is booked for both tenants.
    await expect(db.paymentTransaction.findUniqueOrThrow({ where: { id: checkoutA.transaction.id } })).resolves.toMatchObject({ status: "paid", grossAmountCents: 1_200 });
    await expect(db.paymentTransaction.findUniqueOrThrow({ where: { id: checkoutB.transaction.id } })).resolves.toMatchObject({ status: "paid" });
    const heldOrder = await orderState(checkoutA.transaction.id);
    expect(heldOrder).toMatchObject({ status: "paid", paidAmountCents: 1_200 });
    expect(heldOrder.items[0]?.entitlement).toMatchObject({ status: "pending", grantedAt: null });
    expect(heldOrder.events[0]?.sanitizedData).toMatchObject({ grantedEntitlementCount: 0, fulfillmentHeld: "vendor_suspended" });
    const openOrder = await orderState(checkoutB.transaction.id);
    expect(openOrder.items[0]?.entitlement).toMatchObject({ status: "granted" });
    expect(openOrder.events[0]?.sanitizedData).not.toHaveProperty("fulfillmentHeld");

    // A provider resend while still suspended keeps access closed.
    await processPaymentWebhook(paid(a.vendorId, checkoutA.orderNumber));
    expect((await orderState(checkoutA.transaction.id)).items[0]?.entitlement).toMatchObject({ status: "pending" });

    // The email job sends only the active tenant's receipt.
    mail.send.mockResolvedValue({ id: "synthetic-provider-id" });
    const receiptA = await db.emailDelivery.findFirstOrThrow({ where: { vendorId: a.vendorId, trigger: "order_paid" } });
    const receiptB = await db.emailDelivery.findFirstOrThrow({ where: { vendorId: b.vendorId, trigger: "order_paid" } });
    await expect(dispatchEmailDelivery(receiptA.id)).resolves.toEqual({ status: "vendor_suspended" });
    const results = await processDueEmailDeliveries(50);
    expect(results.map((row) => row.deliveryId)).not.toContain(receiptA.id);
    await expect(db.emailDelivery.findUniqueOrThrow({ where: { id: receiptA.id } })).resolves.toMatchObject({ status: "queued", attemptCount: 0 });
    await expect(db.emailDelivery.findUniqueOrThrow({ where: { id: receiptB.id } })).resolves.toMatchObject({ status: "sent" });

    await expect(resumeVendor(db, { vendorId: a.vendorId, actorUserId: admin.id })).resolves.toMatchObject({ status: "resumed", grantedEntitlementCount: 1 });
    expect((await orderState(checkoutA.transaction.id)).items[0]?.entitlement).toMatchObject({ status: "granted", grantedAt: expect.any(Date) });
    await expect(dispatchEmailDelivery(receiptA.id)).resolves.toEqual({ status: "sent" });
  });
});

describe("F-036 concurrency of the vendor FOR SHARE read (M1)", () => {
  it("retries a webhook whose vendor row changed mid-transaction and still books the payment once", async () => {
    const a = await createTenant("A");
    const checkout = await digitalCheckout(a.vendorId, "race-buyer@example.test");
    race.vendorId = a.vendorId; race.pending = true;

    await processPaymentWebhook(paid(a.vendorId, checkout.orderNumber));

    // The first attempt hit the concurrent update (40001 on FOR SHARE) and was retried.
    expect(race.orderTransitionRuns).toBeGreaterThanOrEqual(2);
    await expect(db.paymentTransaction.findUniqueOrThrow({ where: { id: checkout.transaction.id } })).resolves.toMatchObject({ status: "paid" });
    const order = await orderState(checkout.transaction.id);
    expect(order).toMatchObject({ status: "paid" });
    expect(order.events).toHaveLength(1);
    expect(order.items[0]?.entitlement).toMatchObject({ status: "granted" });
  });
});

describe("F-036 resume releases held orders with events and audit (m3)", () => {
  it("appends one release event per held order and names the orders in the audit", async () => {
    const a = await createTenant("A");
    const admin = await createPlatformAdmin(new Date());
    const first = await digitalCheckout(a.vendorId, "held-1@example.test");
    const second = await digitalCheckout(a.vendorId, "held-2@example.test");
    await suspendVendor(db, { vendorId: a.vendorId, reason: "合成", actorUserId: admin.id });
    await processPaymentWebhook(paid(a.vendorId, first.orderNumber));
    await processPaymentWebhook(paid(a.vendorId, second.orderNumber));
    await expect(resumeVendor(db, { vendorId: a.vendorId, actorUserId: admin.id })).resolves.toMatchObject({ status: "resumed", complete: true, grantedEntitlementCount: 2 });

    const orders = [await orderState(first.transaction.id), await orderState(second.transaction.id)];
    for (const order of orders) {
      expect(order.items[0]?.entitlement).toMatchObject({ status: "granted" });
      await expect(db.commerceOrderEvent.count({ where: { vendorId: a.vendorId, orderId: order.id, eventType: "fulfillment.released_after_suspension" } })).resolves.toBe(1);
    }
    await expect(db.auditLog.count({ where: { vendorId: a.vendorId, action: "vendor_suspension_lifted" } })).resolves.toBe(1);
    const audit = await db.auditLog.findFirstOrThrow({ where: { vendorId: a.vendorId, action: "vendor_suspension_release_completed" } });
    expect(audit.after).toMatchObject({ grantedEntitlementCount: 2, releasedOrderCount: 2 });
    expect([...(audit.after as { releasedOrderIds: string[] }).releasedOrderIds].sort()).toEqual(orders.map((order) => order.id).sort());
    // A repeated release finds nothing left and writes no duplicate order event.
    await expect(releaseHeldEntitlements(db, { vendorId: a.vendorId, actorUserId: admin.id })).resolves.toMatchObject({ complete: true, grantedEntitlementCount: 0 });
    await expect(db.commerceOrderEvent.count({ where: { vendorId: a.vendorId, eventType: "fulfillment.released_after_suspension" } })).resolves.toBe(2);
  });

  it("releases more than one batch (501 held entitlements) in separate short transactions", async () => {
    const a = await createTenant("A");
    const admin = await createPlatformAdmin(new Date());
    await suspendVendor(db, { vendorId: a.vendorId, reason: "合成", actorUserId: admin.id });
    const orderId = randomUUID();
    const count = 501;
    await db.commerceOrder.create({ data: {
      id: orderId, vendorId: a.vendorId, orderNumber: `HELD-${orderId}`, checkoutIdempotencyKey: randomUUID(),
      checkoutIdentityHash: createHash("sha256").update(orderId).digest("base64url"), status: "paid", currency: "TWD",
      subtotalAmountCents: count * 100, totalAmountCents: count * 100, paidAmountCents: count * 100, paidAt: new Date(),
      buyerEncryptedEnvelope: "synthetic-envelope", buyerMaskedName: "合成買家", buyerMaskedEmail: "h***@example.test",
    } });
    const items = Array.from({ length: count }, (_, lineIndex) => ({
      id: randomUUID(), vendorId: a.vendorId, orderId, lineIndex, productName: "合成數位", productSlug: `held-${lineIndex}`,
      commerceDomain: "merchant", fulfillmentType: "digital" as const, unitPriceCents: 100, quantity: 1, lineTotalCents: 100, nonSensitiveSnapshot: {},
    }));
    await db.commerceOrderItem.createMany({ data: items });
    await db.commerceEntitlement.createMany({ data: items.map((item) => ({
      vendorId: a.vendorId, orderItemId: item.id, accessEncryptedEnvelope: "v1.synthetic", accessMaskedSummary: "合成",
    })) });
    const transactions = vi.spyOn(db, "$transaction");
    try {
      await expect(resumeVendor(db, { vendorId: a.vendorId, actorUserId: admin.id })).resolves.toMatchObject({ status: "resumed", complete: true, grantedEntitlementCount: count });
      // lift + two release batches + the empty check + the outcome audit, each its own transaction.
      expect(transactions.mock.calls.length).toBeGreaterThanOrEqual(4);
    } finally {
      transactions.mockRestore();
    }
    await expect(db.commerceEntitlement.count({ where: { vendorId: a.vendorId, status: "granted" } })).resolves.toBe(count);
    await expect(db.commerceOrderEvent.count({ where: { vendorId: a.vendorId, orderId, eventType: "fulfillment.released_after_suspension" } })).resolves.toBe(1);
  });
});

describe("F-030 learner portal revocation wiring", () => {
  async function tokens(vendorId: string, email: string) {
    await createStudentPortalAccessToken(db, { vendorId, email, purpose: "magic_link" });
  }
  async function tokenCount(vendorId: string) {
    return db.studentPortalAccessToken.count({ where: { vendorId } });
  }

  it("suspension deletes every learner capability of the tenant in one batch, and nothing of the other", async () => {
    const a = await createTenant("A");
    const b = await createTenant("B");
    const admin = await createPlatformAdmin(new Date());
    await tokens(a.vendorId, "one@example.test");
    await tokens(a.vendorId, "two@example.test");
    await tokens(b.vendorId, "one@example.test");
    await expect(suspendVendor(db, { vendorId: a.vendorId, reason: "合成", actorUserId: admin.id }))
      .resolves.toMatchObject({ status: "suspended", revokedStudentPortalTokenCount: 2 });
    expect(await tokenCount(a.vendorId)).toBe(0);
    expect(await tokenCount(b.vendorId)).toBe(1);
  });

  it("blocking an email revokes that customer's portal capabilities at this vendor only", async () => {
    const a = await createTenant("A");
    const b = await createTenant("B");
    await tokens(a.vendorId, "blocked@example.test");
    await tokens(b.vendorId, "blocked@example.test");
    await tokens(b.vendorId, "kept@example.test");
    await signIn(b.ownerId, b.vendorId);
    await expect(outcome(() => upsertBlacklistAction(form({ identifierType: "email", identifier: "Blocked@Example.test", reason: "spam" })))).resolves.toBe("completed");
    expect(await tokenCount(a.vendorId)).toBe(1);
    expect(await tokenCount(b.vendorId)).toBe(1);
    // A non-email block revokes nothing.
    await expect(outcome(() => upsertBlacklistAction(form({ identifierType: "phone", identifier: "0912345678", reason: "spam" })))).resolves.toBe("completed");
    expect(await tokenCount(b.vendorId)).toBe(1);
  });

  it("a full refund keeps the buyer's learner session: access is refused per request, consent can still be withdrawn", async () => {
    const b = await createTenant("B");
    const checkout = await digitalCheckout(b.vendorId, "refund-buyer@example.test");
    await processPaymentWebhook(paid(b.vendorId, checkout.orderNumber));
    await tokens(b.vendorId, "refund-buyer@example.test");
    const order = await orderState(checkout.transaction.id);

    await db.$transaction((tx) => reconcileCommerceOrderRefund(tx, {
      vendorId: b.vendorId, orderId: order.id, providerName: "payuni", eventIdentity: `refund-${randomUUID()}`,
      amountCents: order.totalAmountCents, paymentTransactionId: checkout.transaction.id, occurredAt: new Date(),
    }), { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });

    expect((await orderState(checkout.transaction.id)).items[0]?.entitlement).toMatchObject({ status: "revoked" });
    // Same contract as tests/e2e/learner-notifications.spec.ts: the session row survives the refund.
    expect(await tokenCount(b.vendorId)).toBe(1);
  });
});
