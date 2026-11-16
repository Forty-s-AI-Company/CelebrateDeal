import { createHash, randomUUID } from "node:crypto";
import { Prisma, PrismaClient } from "@prisma/client";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The database URL with an explicit pool size: the race cases below need a
 * known number of connections, never the environment's default pool (CI
 * runners default to 3–5).
 */
function pooledUrl(connections: number) {
  const url = new URL(process.env.DATABASE_URL ?? "");
  url.searchParams.set("connection_limit", String(connections));
  url.searchParams.set("pool_timeout", "20");
  return url.toString();
}

const clients = vi.hoisted(() => ({ app: null as null | import("@prisma/client").PrismaClient }));
vi.mock("@/lib/db", async () => {
  const { PrismaClient: Client } = await import("@prisma/client");
  return {
    getDb: () => {
      clients.app ??= new Client({ datasourceUrl: pooledUrl(6) });
      return clients.app;
    },
  };
});

// Q-10: the `payment_paid` catch-up on the disposable PostgreSQL database.
// Payment callbacks, orders, rules, execution logs, tags, vouchers, LINE
// outbox rows and automation e-mails are real. Synthetic: the post-response
// hook (`after`, which needs a Next.js request scope; the cases here drop it
// to stand for a hook the platform never ran), the immediate e-mail send,
// monitoring, and (in one case) a LINE outbox failure. No provider, e-mail or
// LINE service is called.
const hooks = vi.hoisted(() => ({
  after: (() => { throw new Error("`after` was called outside a request scope"); }) as (callback: () => unknown) => void,
  line: null as null | ((...args: unknown[]) => Promise<unknown>),
}));
const monitoring = vi.hoisted(() => ({ captureOperationalError: vi.fn() }));

vi.mock("next/server", async (original) => ({
  ...await original<typeof import("next/server")>(),
  after: (callback: () => unknown) => hooks.after(callback),
}));
vi.mock("@/lib/monitoring", async (original) => ({
  ...await original<typeof import("@/lib/monitoring")>(),
  captureOperationalError: monitoring.captureOperationalError,
}));
vi.mock("@/lib/email-delivery-immediate", async (original) => ({
  ...await original<typeof import("@/lib/email-delivery-immediate")>(),
  scheduleImmediateEmailDispatch: vi.fn(),
}));
vi.mock("@/lib/line-notification", async (original) => {
  const actual = await original<typeof import("@/lib/line-notification")>();
  return {
    ...actual,
    enqueueLineNotification: (...args: Parameters<typeof actual.enqueueLineNotification>) =>
      hooks.line ? hooks.line(...args) : actual.enqueueLineNotification(...args),
  };
});

import { createCommerceOrderForCheckout, reconcileCommerceOrderPaymentTransition } from "@/lib/commerce-orders";
import { getDb } from "@/lib/db";
import { createReservedPaymentTransaction, INVENTORY_EXPIRY_RECONCILE_EVENT_PREFIX } from "@/lib/inventory-reservations";
import { protectLineOfficialAccountCredentials } from "@/lib/line-credentials";
import { dispatchPaymentPaidAutomationForOrder } from "@/lib/payment-paid-automation";
import {
  PAYMENT_PAID_CATCHUP_MAX_AGE_MS,
  PAYMENT_PAID_CATCHUP_MIN_AGE_MS,
  runPaymentPaidAutomationCatchup,
} from "@/lib/payment-paid-automation-catchup";
import { PaymentWebhookPayload, processPaymentWebhook } from "@/lib/payment-webhooks";

// Each case pays several orders through the real webhook path (a Serializable
// transaction each); give slow shared runners room instead of the 5 s default.
vi.setConfig({ testTimeout: 30_000 });

const db = getDb();
const vendorIds: string[] = [];
const extraClients: PrismaClient[] = [];
const PRICE_CENTS = 2_000;
const MINUTE = 60_000;
/** Far enough after the payments of a case that they are inside the window. */
const later = () => new Date(Date.now() + PAYMENT_PAID_CATCHUP_MIN_AGE_MS + 5 * MINUTE);

beforeEach(() => {
  vi.stubEnv("CSRF_SECRET", "payment-paid-catchup-secret-longer-than-32-bytes");
  vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://paid-catchup.example.test");
  // Default for these cases: the live hook is registered but never runs.
  hooks.after = () => undefined;
  hooks.line = null;
  monitoring.captureOperationalError.mockClear();
});

afterEach(async () => {
  vi.unstubAllEnvs();
  await db.auditLog.deleteMany({ where: { vendorId: { in: vendorIds } } });
  await db.vendor.deleteMany({ where: { id: { in: vendorIds.splice(0) } } });
});

afterAll(async () => {
  await Promise.all(extraClients.splice(0).map((client) => client.$disconnect()));
  await clients.app?.$disconnect();
});

function client(connections: number) {
  const created = new PrismaClient({ datasourceUrl: pooledUrl(connections) });
  extraClients.push(created);
  return created;
}

async function tenant(label: string) {
  const key = randomUUID();
  const vendor = await db.vendor.create({
    data: { name: `付款補跑 ${label}`, slug: `paid-catchup-${key}`, email: `vendor-${key}@example.test`, passwordHash: "synthetic-only" },
  });
  vendorIds.push(vendor.id);
  const product = await db.product.create({
    data: { vendorId: vendor.id, name: "付款商品", slug: `catchup-product-${key}`, priceCents: PRICE_CENTS, currency: "TWD", inventory: 200, isActive: true, fulfillmentTypeConfirmed: true },
  });
  await db.lineOfficialAccount.create({
    data: {
      vendorId: vendor.id,
      ...protectLineOfficialAccountCredentials(vendor.id, {
        messagingChannelId: "2000123456",
        messagingChannelSecret: "synthetic-messaging-secret-1234567890",
        messagingAccessToken: "synthetic-access-token-with-at-least-thirty-two-chars",
        loginChannelId: null,
        loginChannelSecret: null,
      }),
    },
  });
  return { vendor, product };
}
type Tenant = Awaited<ReturnType<typeof tenant>>;

/** The checkout route's reservation, plus a LINE identity linked to the order so a LINE action queues a row. */
async function checkout(t: Tenant) {
  const orderNumber = `PAID-CATCHUP-${randomUUID()}`;
  const checkoutIdempotencyKey = randomUUID();
  const transaction = await createReservedPaymentTransaction({
    vendorId: t.vendor.id,
    productId: t.product.id,
    checkoutIdempotencyKey,
    transactionData: {
      vendorId: t.vendor.id, checkoutIdempotencyKey, providerName: "payuni", orderNumber, paymentMode: "platform",
      grossAmountCents: PRICE_CENTS, netAmountCents: PRICE_CENTS, currency: "TWD", status: "pending", metadata: { productId: t.product.id },
    },
    createCommerceOrder: async (tx, payment) => {
      await createCommerceOrderForCheckout(tx, {
        vendorId: t.vendor.id, productId: t.product.id, orderNumber, checkoutIdempotencyKey, paymentTransactionId: payment.id,
        totalAmountCents: PRICE_CENTS, currency: "TWD", buyer: { name: "合成買家", email: `buyer-${randomUUID().slice(0, 8)}@example.test`, phone: "0912345678" }, shipping: null,
      });
    },
  });
  const order = await db.commerceOrder.findFirstOrThrow({ where: { vendorId: t.vendor.id, primaryPaymentTransactionId: transaction.id } });
  await db.lineUserIdentity.create({
    data: { vendorId: t.vendor.id, subjectType: "buyer_order", subjectId: order.id, lineUserIdHash: createHash("sha256").update(randomUUID()).digest("hex"), lineUserIdEncrypted: "v1.synthetic" },
  });
  return { transactionId: transaction.id, orderNumber, orderId: order.id };
}
type Checkout = Awaited<ReturnType<typeof checkout>>;

function paidCallback(t: Tenant, c: Checkout) {
  return PaymentWebhookPayload.parse({ provider: "payuni", eventId: `paid-catchup-${randomUUID()}`, eventType: "paid", vendorId: t.vendor.id, orderNumber: c.orderNumber, grossAmountCents: PRICE_CENTS, currency: "TWD" });
}

/** A paid order whose live `after()` hook never ran (the default hook above drops it). */
async function missedPayment(t: Tenant) {
  const c = await checkout(t);
  await processPaymentWebhook(paidCallback(t, c));
  return c;
}

const ALL_ACTIONS = (t: Tenant) => [
  { type: "add_customer_tag", tag: "已付款" },
  { type: "issue_repurchase_voucher", productId: t.product.id, discountType: "percentage", discountValue: 10, expiresInDays: 30 },
  { type: "line_push", message: "感謝購買" },
  { type: "send_email_notification", template: "repurchase_followup" },
];

async function paymentRule(t: Tenant, options: { actions?: unknown[]; isActive?: boolean; funnelPageId?: string } = {}) {
  return db.automationRule.create({
    data: {
      vendorId: t.vendor.id,
      name: `付款規則 ${randomUUID().slice(0, 6)}`,
      trigger: "payment_paid",
      condition: { type: "order_amount_gte", amountCents: 1_000 } as Prisma.InputJsonValue,
      actions: (options.actions ?? ALL_ACTIONS(t)) as Prisma.InputJsonArray,
      isActive: options.isActive ?? true,
    },
  });
}

function logsOf(t: Tenant, orderId?: string) {
  return db.automationExecutionLog.findMany({
    where: { vendorId: t.vendor.id, ...(orderId ? { eventId: `payment-paid:${orderId}` } : {}) },
    orderBy: { createdAt: "asc" },
  });
}

/** Everything a rule run leaves behind for one vendor. */
async function outputs(t: Tenant) {
  const [tags, vouchers, lines, mails] = await Promise.all([
    db.customerTagAssignment.count({ where: { vendorId: t.vendor.id } }),
    db.automationVoucherGrant.count({ where: { vendorId: t.vendor.id } }),
    db.lineDelivery.count({ where: { vendorId: t.vendor.id } }),
    db.emailDelivery.count({ where: { vendorId: t.vendor.id, trigger: "automation" } }),
  ]);
  return { tags, vouchers, lines, mails };
}

/** Pins when the order was paid and its payment recorded (both the same instant). */
async function pinPayment(c: Checkout, at: Date, recordedAt: Date = at) {
  await db.commerceOrder.update({ where: { id: c.orderId }, data: { paidAt: at } });
  await db.commerceOrderEvent.updateMany({ where: { orderId: c.orderId, eventType: "payment.paid" }, data: { createdAt: recordedAt } });
}

function catchup(now: Date, options: { limit?: number; db?: PrismaClient } = {}) {
  return runPaymentPaidAutomationCatchup({ db: options.db ?? db, now, ...(options.limit ? { limit: options.limit } : {}) });
}

describe("補跑漏掉的 payment_paid", () => {
  it("runs a missed order once with the live event id and keys; a second pass and a late live hook repeat nothing", async () => {
    const t = await tenant("missed");
    const rule = await paymentRule(t);
    const c = await missedPayment(t);
    expect(await logsOf(t)).toEqual([]);
    const order = await db.commerceOrder.findUniqueOrThrow({ where: { id: c.orderId } });

    const first = await catchup(later());
    expect(first).toMatchObject({ completed: 1, failed: 0, errors: 0 });
    const logs = await logsOf(t);
    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatchObject({ ruleId: rule.id, status: "completed", trigger: "payment_paid", subjectType: "buyer_order", eventId: `payment-paid:${c.orderId}`, subjectKeyHash: order.automationCustomerKeyHash });
    expect(await outputs(t)).toEqual({ tags: 1, vouchers: 1, lines: 1, mails: 1 });

    await catchup(later());
    // The live dispatch, if its hook ran late, finds the same claim.
    await expect(dispatchPaymentPaidAutomationForOrder({ vendorId: t.vendor.id, orderId: c.orderId }))
      .resolves.toEqual({ status: "dispatched", results: [{ ruleId: rule.id, status: "duplicate" }] });
    expect((await logsOf(t)).map((log) => [log.id, log.status])).toEqual([[logs[0]!.id, "completed"]]);
    expect(await outputs(t)).toEqual({ tags: 1, vouchers: 1, lines: 1, mails: 1 });
    expect(monitoring.captureOperationalError).not.toHaveBeenCalled();
  });

  it("leaves orders the live hook ran alone, and never retries a failed execution", async () => {
    const t = await tenant("ran");
    await paymentRule(t);
    // Outside a request scope the live call runs inline: the hook "ran".
    hooks.after = () => { throw new Error("outside a request"); };
    const ran = await checkout(t);
    await processPaymentWebhook(paidCallback(t, ran));
    // The LINE outbox fails during the live run: the execution is `failed`.
    hooks.line = async () => { throw new Error("synthetic LINE outbox failure"); };
    const failed = await checkout(t);
    await processPaymentWebhook(paidCallback(t, failed));
    hooks.line = null;
    const before = await logsOf(t);
    expect(before.map((log) => [log.eventId, log.status])).toEqual([
      [`payment-paid:${ran.orderId}`, "completed"],
      [`payment-paid:${failed.orderId}`, "failed"],
    ]);
    const outputsBefore = await outputs(t);

    await catchup(later());
    expect(await logsOf(t)).toEqual(before);
    expect(await outputs(t)).toEqual(outputsBefore);
  });

  it("reclaims an execution whose process died (running past the reclaim threshold) and finishes it without duplicating outputs; a fresh running one is left alone", async () => {
    const t = await tenant("died");
    await paymentRule(t);
    hooks.after = () => { throw new Error("outside a request"); };
    // The live run tags and issues the voucher, then the LINE step fails ...
    hooks.line = async () => { throw new Error("synthetic process stop"); };
    const dead = await checkout(t);
    await processPaymentWebhook(paidCallback(t, dead));
    const fresh = await checkout(t);
    await processPaymentWebhook(paidCallback(t, fresh));
    hooks.line = null;
    // ... and its process stopped before it could record the end. The claim
    // compares `startedAt` with the real clock, so this case moves the
    // payments (and the rule) into the past instead of moving `now` ahead.
    const now = new Date();
    const paidAt = new Date(now.getTime() - PAYMENT_PAID_CATCHUP_MIN_AGE_MS - 5 * MINUTE);
    await db.$executeRaw`UPDATE "AutomationRule" SET "createdAt" = ${new Date(paidAt.getTime() - MINUTE)}, "updatedAt" = ${new Date(paidAt.getTime() - MINUTE)} WHERE "vendorId" = ${t.vendor.id}`;
    await pinPayment(dead, paidAt);
    await pinPayment(fresh, paidAt);
    await db.automationExecutionLog.updateMany({
      where: { vendorId: t.vendor.id, eventId: `payment-paid:${dead.orderId}` },
      data: { status: "running", completedAt: null, errorCode: null, startedAt: new Date(now.getTime() - 6 * MINUTE) },
    });
    await db.automationExecutionLog.updateMany({
      where: { vendorId: t.vendor.id, eventId: `payment-paid:${fresh.orderId}` },
      data: { status: "running", completedAt: null, errorCode: null, startedAt: new Date(now.getTime() - MINUTE) },
    });
    expect(await outputs(t)).toEqual({ tags: 2, vouchers: 2, lines: 0, mails: 0 });

    const summary = await catchup(now);
    expect(summary).toMatchObject({ examined: 1, completed: 1 });
    const [deadLog] = await logsOf(t, dead.orderId);
    expect(deadLog).toMatchObject({ status: "completed" });
    expect((await logsOf(t, fresh.orderId))[0]).toMatchObject({ status: "running" });
    // The tag and voucher were not issued twice; LINE and e-mail now exist once.
    expect(await outputs(t)).toEqual({ tags: 2, vouchers: 2, lines: 1, mails: 1 });
  });
});

describe("即時路徑與補跑併發", () => {
  it("the live dispatch, two catch-up passes and a second live dispatch racing on separate pools run each rule once per order", async () => {
    const t = await tenant("race");
    const rule = await paymentRule(t);
    const orders = [];
    for (let index = 0; index < 4; index += 1) orders.push(await missedPayment(t));
    const live = client(4);
    const job = client(3);
    const otherJob = client(3);
    const now = later();
    const race = Promise.all([
      ...orders.map((c) => dispatchPaymentPaidAutomationForOrder({ vendorId: t.vendor.id, orderId: c.orderId }, live)),
      catchup(now, { db: job }),
      catchup(now, { db: otherJob }),
      ...orders.map((c) => dispatchPaymentPaidAutomationForOrder({ vendorId: t.vendor.id, orderId: c.orderId }, live)),
    ]);
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error("race did not settle in 60 s")), 60_000); });
    try {
      await Promise.race([race, timeout]);
    } finally {
      clearTimeout(timer);
    }
    for (const c of orders) {
      const logs = await logsOf(t, c.orderId);
      expect(logs.map((log) => [log.ruleId, log.status])).toEqual([[rule.id, "completed"]]);
    }
    // Four buyers (four customer keys): one of each output per order.
    expect(await outputs(t)).toEqual({ tags: 4, vouchers: 4, lines: 4, mails: 4 });
  }, 90_000);
});

describe("不補跑的訂單", () => {
  it("skips refunded, test, inventory-reconciled and suspended-at-payment orders", async () => {
    const t = await tenant("not-eligible");
    await paymentRule(t, { actions: [{ type: "add_customer_tag", tag: "已付款" }] });
    const refunded = await missedPayment(t);
    await processPaymentWebhook(PaymentWebhookPayload.parse({ provider: "payuni", eventId: `paid-catchup-refund-${randomUUID()}`, eventType: "partially_refunded", vendorId: t.vendor.id, orderNumber: refunded.orderNumber, refundAmountCents: 500, currency: "TWD" }));
    const testOrder = await missedPayment(t);
    await db.commerceOrder.update({ where: { id: testOrder.orderId }, data: { isTestOrder: true } });
    // The inventory-expiry job's own paid transition (not the webhook's).
    const reconciled = await checkout(t);
    await db.$transaction((tx) => reconcileCommerceOrderPaymentTransition(tx, {
      vendorId: t.vendor.id, paymentTransactionId: reconciled.transactionId, eventIdentity: `${INVENTORY_EXPIRY_RECONCILE_EVENT_PREFIX}${randomUUID()}`, transition: "paid", occurredAt: new Date(),
    }), { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    expect(await db.commerceOrder.findUniqueOrThrow({ where: { id: reconciled.orderId } })).toMatchObject({ status: "paid" });
    // Paid while the vendor was suspended (F-036): never run, also not after resume.
    await db.vendor.update({ where: { id: t.vendor.id }, data: { suspendedAt: new Date(), suspendedReason: "合成測試停權" } });
    const suspended = await missedPayment(t);
    await db.vendor.update({ where: { id: t.vendor.id }, data: { suspendedAt: null, suspendedReason: null } });
    expect(await db.commerceOrder.findUniqueOrThrow({ where: { id: suspended.orderId } })).toMatchObject({ status: "paid" });

    expect(await catchup(later())).toMatchObject({ examined: 0 });
    expect(await logsOf(t)).toEqual([]);

    // Control: the same vendor's ordinary missed order does run.
    const ordinary = await missedPayment(t);
    await catchup(later());
    expect((await logsOf(t)).map((log) => log.eventId)).toEqual([`payment-paid:${ordinary.orderId}`]);
  });

  it("a suspended vendor's orders wait while it is suspended", async () => {
    const t = await tenant("suspended-now");
    await paymentRule(t);
    await missedPayment(t);
    await db.vendor.update({ where: { id: t.vendor.id }, data: { suspendedAt: new Date(), suspendedReason: "合成測試停權" } });
    await catchup(later());
    expect(await logsOf(t)).toEqual([]);
  });

  it("runs only rules active and unchanged since the payment: not a switched-off rule, a rule created later, or one switched back on later", async () => {
    const t = await tenant("rules");
    const before = await paymentRule(t, { actions: [{ type: "add_customer_tag", tag: "付款前" }] });
    const off = await paymentRule(t, { isActive: false, actions: [{ type: "add_customer_tag", tag: "停用" }] });
    const pausedThenOn = await paymentRule(t, { actions: [{ type: "add_customer_tag", tag: "暫停後重開" }] });
    // Switched off before the payment, the way /settings/automations does (updateMany).
    await db.automationRule.updateMany({ where: { id: pausedThenOn.id, vendorId: t.vendor.id }, data: { isActive: false } });
    const c = await missedPayment(t);
    // After the payment: switched back on, and a new rule created.
    await db.automationRule.updateMany({ where: { id: pausedThenOn.id, vendorId: t.vendor.id }, data: { isActive: true } });
    const created = await paymentRule(t, { actions: [{ type: "add_customer_tag", tag: "付款後" }] });
    const recorded = await db.commerceOrderEvent.findFirstOrThrow({ where: { orderId: c.orderId, eventType: "payment.paid" } });
    expect((await db.automationRule.findUniqueOrThrow({ where: { id: pausedThenOn.id } })).updatedAt.getTime()).toBeGreaterThan(recorded.createdAt.getTime());

    await catchup(later());
    expect((await logsOf(t)).map((log) => log.ruleId)).toEqual([before.id]);
    for (const ruleId of [off.id, pausedThenOn.id, created.id]) {
      expect(await db.automationExecutionLog.count({ where: { ruleId } })).toBe(0);
    }
    expect((await db.customerTagAssignment.findMany({ where: { vendorId: t.vendor.id }, select: { tag: true } })).map((row) => row.tag)).toEqual(["付款前"]);
  });

  it("does nothing for a vendor whose only payment rule is switched off", async () => {
    const t = await tenant("off");
    const rule = await paymentRule(t);
    await missedPayment(t);
    await db.automationRule.updateMany({ where: { id: rule.id, vendorId: t.vendor.id }, data: { isActive: false } });
    expect(await catchup(later())).toMatchObject({ examined: 0 });
    expect(await logsOf(t)).toEqual([]);
  });
});

describe("跨租戶", () => {
  it("vendor B's rule never runs for vendor A's order, and each vendor's catch-up stays in its own records", async () => {
    const a = await tenant("A");
    const b = await tenant("B");
    const ruleB = await paymentRule(b, { actions: [{ type: "add_customer_tag", tag: "乙的規則" }] });
    const orderA = await missedPayment(a);
    await catchup(later());
    expect(await logsOf(a)).toEqual([]);
    expect(await db.automationExecutionLog.count({ where: { ruleId: ruleB.id } })).toBe(0);

    const ruleA = await paymentRule(a, { actions: [{ type: "add_customer_tag", tag: "甲的規則" }] });
    const lateA = await missedPayment(a);
    const orderB = await missedPayment(b);
    await catchup(later());
    // A's earlier order paid before A had a rule: still nothing.
    expect(await logsOf(a, orderA.orderId)).toEqual([]);
    expect((await logsOf(a)).map((log) => [log.ruleId, log.eventId])).toEqual([[ruleA.id, `payment-paid:${lateA.orderId}`]]);
    expect((await logsOf(b)).map((log) => [log.ruleId, log.eventId])).toEqual([[ruleB.id, `payment-paid:${orderB.orderId}`]]);
    const keyA = (await db.commerceOrder.findUniqueOrThrow({ where: { id: lateA.orderId } })).automationCustomerKeyHash;
    expect(await db.customerTagAssignment.findMany({ where: { vendorId: a.vendor.id }, select: { tag: true, customerKeyHash: true } }))
      .toEqual([{ tag: "甲的規則", customerKeyHash: keyA }]);
    expect((await db.customerTagAssignment.findMany({ where: { vendorId: b.vendor.id }, select: { tag: true } })).map((row) => row.tag)).toEqual(["乙的規則"]);
  });
});

describe("時間窗", () => {
  it("runs an order only between MIN_AGE and MAX_AGE after it was paid and recorded", async () => {
    const t = await tenant("window");
    await paymentRule(t, { actions: [{ type: "add_customer_tag", tag: "已付款" }] });
    const c = await missedPayment(t);
    const at = new Date();
    await pinPayment(c, at);
    const after = (ms: number) => new Date(at.getTime() + ms);

    await catchup(after(PAYMENT_PAID_CATCHUP_MIN_AGE_MS - 1_000));
    expect(await logsOf(t)).toEqual([]);
    await catchup(after(PAYMENT_PAID_CATCHUP_MAX_AGE_MS + 1_000));
    expect(await logsOf(t)).toEqual([]);
    await catchup(after(PAYMENT_PAID_CATCHUP_MIN_AGE_MS));
    expect((await logsOf(t)).map((log) => log.status)).toEqual(["completed"]);
  });

  it("the upper bound is inclusive: an order exactly MAX_AGE old still runs", async () => {
    const t = await tenant("window-max");
    await paymentRule(t, { actions: [{ type: "add_customer_tag", tag: "已付款" }] });
    const c = await missedPayment(t);
    const at = new Date();
    await pinPayment(c, at);
    await catchup(new Date(at.getTime() + PAYMENT_PAID_CATCHUP_MAX_AGE_MS));
    expect((await logsOf(t)).map((log) => log.status)).toEqual(["completed"]);
  });

  it("a payment recorded only now (a late webhook for an older payment) is left to its live hook", async () => {
    const t = await tenant("late-webhook");
    await paymentRule(t, { actions: [{ type: "add_customer_tag", tag: "已付款" }] });
    const c = await missedPayment(t);
    const recordedAt = new Date();
    await pinPayment(c, new Date(recordedAt.getTime() - 60 * MINUTE), recordedAt);
    await catchup(new Date(recordedAt.getTime() + 2 * MINUTE));
    expect(await logsOf(t)).toEqual([]);
    await catchup(new Date(recordedAt.getTime() + PAYMENT_PAID_CATCHUP_MIN_AGE_MS + MINUTE));
    expect((await logsOf(t)).map((log) => log.status)).toEqual(["completed"]);
  });
});

describe("每輪上限與商家輪流", () => {
  it("takes at most the limit per pass, each vendor's oldest order first, round-robin across vendors", async () => {
    const big = await tenant("big");
    const small = await tenant("small");
    const single = await tenant("single");
    for (const t of [big, small, single]) await paymentRule(t, { actions: [{ type: "add_customer_tag", tag: "已付款" }] });
    const base = Date.now();
    const bigOrders = [];
    for (let index = 0; index < 5; index += 1) bigOrders.push(await missedPayment(big));
    const smallOrders = [await missedPayment(small), await missedPayment(small)];
    const singleOrder = await missedPayment(single);
    // The big vendor's orders are the oldest of all: without the per-vendor
    // rank it would take every slot.
    for (const [index, c] of bigOrders.entries()) await pinPayment(c, new Date(base + index * 1_000));
    for (const [index, c] of smallOrders.entries()) await pinPayment(c, new Date(base + 10_000 + index * 1_000));
    await pinPayment(singleOrder, new Date(base + 20_000));
    const now = new Date(base + PAYMENT_PAID_CATCHUP_MIN_AGE_MS + 30_000);

    const first = await catchup(now, { limit: 4 });
    expect(first).toMatchObject({ candidates: 4, examined: 4, completed: 4 });
    // Rank 1 of each vendor (3 orders), then the oldest rank-2 order (big's second).
    const ran = (await db.automationExecutionLog.findMany({ where: { vendorId: { in: [big.vendor.id, small.vendor.id, single.vendor.id] } }, select: { eventId: true } }))
      .map((log) => log.eventId).sort();
    expect(ran).toEqual([bigOrders[0]!, bigOrders[1]!, smallOrders[0]!, singleOrder].map((c) => `payment-paid:${c.orderId}`).sort());

    // The next pass picks up where this one stopped.
    const second = await catchup(now, { limit: 4 });
    expect(second).toMatchObject({ candidates: 4, completed: 4 });
    expect(await logsOf(small)).toHaveLength(2);
    expect(await logsOf(big)).toHaveLength(5);
    expect(await catchup(now, { limit: 4 })).toMatchObject({ candidates: 0 });
  });
});
