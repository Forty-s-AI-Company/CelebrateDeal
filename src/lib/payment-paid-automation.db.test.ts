import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// F-4 PR 3: the `payment_paid` automation trigger on the disposable PostgreSQL
// database. Payment callbacks, orders, rules, execution logs, tags, vouchers
// and automation e-mails are real. Synthetic: the post-response hook (`after`,
// which needs a Next.js request scope), the immediate e-mail send, monitoring,
// and the LINE outbox (to make an action throw on purpose). No provider,
// e-mail or LINE service is called.
const hooks = vi.hoisted(() => ({
  /** Default: like a real call outside a request scope. A test may collect the callbacks instead. */
  after: (() => { throw new Error("`after` was called outside a request scope"); }) as (callback: () => unknown) => void,
  dispatch: null as null | ((...args: unknown[]) => Promise<unknown>),
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
vi.mock("@/lib/automation-workflow", async (original) => {
  const actual = await original<typeof import("@/lib/automation-workflow")>();
  return {
    ...actual,
    dispatchAutomationEvent: (...args: Parameters<typeof actual.dispatchAutomationEvent>) =>
      hooks.dispatch ? hooks.dispatch(...args) : actual.dispatchAutomationEvent(...args),
  };
});
vi.mock("@/lib/line-notification", async (original) => {
  const actual = await original<typeof import("@/lib/line-notification")>();
  return {
    ...actual,
    enqueueLineNotification: (...args: Parameters<typeof actual.enqueueLineNotification>) =>
      hooks.line ? hooks.line(...args) : actual.enqueueLineNotification(...args),
  };
});

import { POST as paymentWebhookRoute } from "@/app/api/webhooks/payments/route";
import { createCommerceOrderForCheckout } from "@/lib/commerce-orders";
import { getDb } from "@/lib/db";
import { revealEmailDeliveryPayload } from "@/lib/email-delivery-pii";
import { createReservedPaymentTransaction } from "@/lib/inventory-reservations";
import { dispatchPaymentPaidAutomationForOrder } from "@/lib/payment-paid-automation";
import { PaymentWebhookPayload, processPaymentWebhook } from "@/lib/payment-webhooks";

const db = getDb();
const vendorIds: string[] = [];
const PRICE_CENTS = 2_000;
const BUYER_EMAIL = "Paid.Buyer@Example.test";

beforeEach(() => {
  vi.stubEnv("CSRF_SECRET", "payment-paid-automation-secret-longer-than-32-bytes");
  vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://paid-automation.example.test");
  hooks.after = () => { throw new Error("`after` was called outside a request scope"); };
  hooks.dispatch = null;
  hooks.line = null;
  monitoring.captureOperationalError.mockClear();
});

afterEach(async () => {
  vi.unstubAllEnvs();
  await db.auditLog.deleteMany({ where: { vendorId: { in: vendorIds } } });
  await db.vendor.deleteMany({ where: { id: { in: vendorIds.splice(0) } } });
});

async function tenant(label: string) {
  const key = randomUUID();
  const vendor = await db.vendor.create({
    data: { name: `付款自動化 ${label}`, slug: `paid-automation-${key}`, email: `vendor-${key}@example.test`, passwordHash: "synthetic-only" },
  });
  vendorIds.push(vendor.id);
  const product = await db.product.create({
    data: { vendorId: vendor.id, name: "付款商品", slug: `paid-product-${key}`, priceCents: PRICE_CENTS, currency: "TWD", inventory: 50, isActive: true, fulfillmentTypeConfirmed: true },
  });
  return { vendor, product };
}
type Tenant = Awaited<ReturnType<typeof tenant>>;

/** The checkout route's reservation: server price, a pending transaction and its canonical order in one transaction. */
async function checkout(t: Tenant, provider: "payuni" | "demo" = "payuni") {
  const orderNumber = `PAID-AUTO-${randomUUID()}`;
  const checkoutIdempotencyKey = randomUUID();
  const transaction = await createReservedPaymentTransaction({
    vendorId: t.vendor.id,
    productId: t.product.id,
    checkoutIdempotencyKey,
    transactionData: {
      vendorId: t.vendor.id, checkoutIdempotencyKey, providerName: provider, orderNumber, paymentMode: "platform",
      grossAmountCents: PRICE_CENTS, netAmountCents: PRICE_CENTS, currency: "TWD", status: "pending", metadata: { productId: t.product.id },
    },
    createCommerceOrder: async (tx, payment) => {
      await createCommerceOrderForCheckout(tx, {
        vendorId: t.vendor.id, productId: t.product.id, orderNumber, checkoutIdempotencyKey, paymentTransactionId: payment.id,
        totalAmountCents: PRICE_CENTS, currency: "TWD", buyer: { name: "合成買家", email: BUYER_EMAIL, phone: "0912345678" }, shipping: null,
      });
    },
  });
  const order = await db.commerceOrder.findFirstOrThrow({ where: { vendorId: t.vendor.id, primaryPaymentTransactionId: transaction.id } });
  return { transactionId: transaction.id, orderNumber, orderId: order.id, provider };
}
type Checkout = Awaited<ReturnType<typeof checkout>>;

function callback(t: Tenant, c: Checkout, eventType: "paid" | "failed", eventId = `paid-auto-${randomUUID()}`) {
  return PaymentWebhookPayload.parse({ provider: c.provider, eventId, eventType, vendorId: t.vendor.id, orderNumber: c.orderNumber, grossAmountCents: PRICE_CENTS, currency: "TWD" });
}

function refund(t: Tenant, c: Checkout, eventType: "refunded" | "partially_refunded", refundAmountCents: number) {
  return PaymentWebhookPayload.parse({ provider: c.provider, eventId: `paid-auto-refund-${randomUUID()}`, eventType, vendorId: t.vendor.id, orderNumber: c.orderNumber, refundAmountCents, currency: "TWD" });
}

async function paymentRule(t: Tenant, options: { amountCents?: number; actions?: unknown[]; isActive?: boolean } = {}) {
  return db.automationRule.create({
    data: {
      vendorId: t.vendor.id,
      name: `付款規則 ${randomUUID().slice(0, 6)}`,
      trigger: "payment_paid",
      condition: { type: "order_amount_gte", amountCents: options.amountCents ?? 1_000 } as Prisma.InputJsonValue,
      actions: (options.actions ?? [{ type: "add_customer_tag", tag: "已付款" }]) as Prisma.InputJsonArray,
      isActive: options.isActive ?? true,
    },
  });
}

function logsOf(t: Tenant) {
  return db.automationExecutionLog.findMany({ where: { vendorId: t.vendor.id }, orderBy: { createdAt: "asc" } });
}

/** The payment's own outcome, which no automation outcome may change. */
async function paymentState(c: Checkout) {
  const [transaction, order, events] = await Promise.all([
    db.paymentTransaction.findUniqueOrThrow({ where: { id: c.transactionId }, select: { status: true, grossAmountCents: true } }),
    db.commerceOrder.findUniqueOrThrow({ where: { id: c.orderId }, select: { status: true, paidAmountCents: true, refundedAmountCents: true } }),
    db.commerceOrderEvent.count({ where: { orderId: c.orderId, eventType: "payment.paid" } }),
  ]);
  return { transaction, order, paidEvents: events };
}

const PAID_STATE = {
  transaction: { status: "paid", grossAmountCents: PRICE_CENTS },
  order: { status: "paid", paidAmountCents: PRICE_CENTS, refundedAmountCents: 0 },
  paidEvents: 1,
};

describe("付款成功觸發 payment_paid", () => {
  it("runs each active rule once after the first paid callback, from the server's order: amount, customer key and buyer e-mail", async () => {
    const t = await tenant("A");
    const c = await checkout(t);
    const order = await db.commerceOrder.findUniqueOrThrow({ where: { id: c.orderId } });
    const full = await paymentRule(t, {
      amountCents: PRICE_CENTS,
      actions: [
        { type: "add_customer_tag", tag: "已付款" },
        { type: "issue_repurchase_voucher", productId: t.product.id, discountType: "percentage", discountValue: 10, expiresInDays: 30 },
        { type: "send_email_notification", template: "repurchase_followup" },
      ],
    });
    // One cent above what the server recorded as paid: skipped.
    const above = await paymentRule(t, { amountCents: PRICE_CENTS + 1, actions: [{ type: "add_customer_tag", tag: "高客單" }] });
    const off = await paymentRule(t, { isActive: false, actions: [{ type: "add_customer_tag", tag: "停用" }] });

    await processPaymentWebhook(callback(t, c, "paid"));

    expect(await paymentState(c)).toEqual(PAID_STATE);
    const logs = await logsOf(t);
    expect(logs.map((log) => [log.ruleId, log.status, log.conditionMatched])).toEqual(expect.arrayContaining([
      [full.id, "completed", true],
      [above.id, "skipped", false],
    ]));
    expect(logs).toHaveLength(2);
    expect(logs.some((log) => log.ruleId === off.id)).toBe(false);
    for (const log of logs) {
      expect(log).toMatchObject({ trigger: "payment_paid", subjectType: "buyer_order", subjectKeyHash: order.automationCustomerKeyHash, eventId: `payment-paid:${c.orderId}` });
    }
    // Every output is bound to this vendor and the order's customer key.
    expect(await db.customerTagAssignment.findMany({ where: { vendorId: t.vendor.id }, select: { tag: true, customerKeyHash: true } }))
      .toEqual([{ tag: "已付款", customerKeyHash: order.automationCustomerKeyHash }]);
    expect(await db.automationVoucherGrant.count({ where: { vendorId: t.vendor.id, customerKeyHash: order.automationCustomerKeyHash!, productId: t.product.id } })).toBe(1);
    const mails = await db.emailDelivery.findMany({ where: { vendorId: t.vendor.id, trigger: "automation" } });
    expect(mails).toHaveLength(1);
    const payload = revealEmailDeliveryPayload(mails[0]!.payloadEncryptedEnvelope, { vendorId: t.vendor.id, deliveryId: mails[0]!.id });
    expect(payload.recipientEmail).toBe(BUYER_EMAIL.toLowerCase());
    expect(payload.body).toContain("/unsubscribe");
    expect(monitoring.captureOperationalError).not.toHaveBeenCalled();
  });

  it("does nothing for a vendor without a payment rule, and never decrypts the buyer for it", async () => {
    const t = await tenant("none");
    const c = await checkout(t);
    await processPaymentWebhook(callback(t, c, "paid"));
    expect(await paymentState(c)).toEqual(PAID_STATE);
    expect(await logsOf(t)).toEqual([]);
    await expect(dispatchPaymentPaidAutomationForOrder({ vendorId: t.vendor.id, orderId: c.orderId })).resolves.toEqual({ status: "no_rules" });
  });

  it("starts no delayed-step run for a payment_paid rule, even with the beta grant and a step written directly", async () => {
    const t = await tenant("steps");
    await db.vendor.update({ where: { id: t.vendor.id }, data: { betaFeatureGrants: ["automation_delayed_steps"] } });
    const rule = await paymentRule(t);
    await db.automationRuleStep.create({
      data: { vendorId: t.vendor.id, ruleId: rule.id, delayMinutes: 60, condition: { type: "always" }, actions: [{ type: "add_customer_tag", tag: "一小時後" }] as Prisma.InputJsonArray },
    });
    const c = await checkout(t);
    await processPaymentWebhook(callback(t, c, "paid"));
    expect((await logsOf(t)).map((log) => log.status)).toEqual(["completed"]);
    expect(await db.delayedStepRun.count({ where: { vendorId: t.vendor.id } })).toBe(0);
  });
});

describe("冪等：重送、return＋notify、併發", () => {
  it("a replayed event, a later paid callback with another event id and a direct re-dispatch run nothing again", async () => {
    const t = await tenant("replay");
    const rule = await paymentRule(t, {
      actions: [
        { type: "add_customer_tag", tag: "已付款" },
        { type: "issue_repurchase_voucher", productId: t.product.id, discountType: "fixed", discountValue: 10_000, expiresInDays: 7 },
        { type: "send_email_notification", template: "repurchase_followup" },
      ],
    });
    const c = await checkout(t);
    const first = callback(t, c, "paid");
    await processPaymentWebhook(first);
    await processPaymentWebhook(first);
    await processPaymentWebhook(callback(t, c, "paid"));
    await expect(dispatchPaymentPaidAutomationForOrder({ vendorId: t.vendor.id, orderId: c.orderId }))
      .resolves.toEqual({ status: "dispatched", results: [{ ruleId: rule.id, status: "duplicate" }] });

    expect(await paymentState(c)).toEqual(PAID_STATE);
    expect((await logsOf(t)).map((log) => log.status)).toEqual(["completed"]);
    expect(await db.customerTagAssignment.count({ where: { vendorId: t.vendor.id } })).toBe(1);
    expect(await db.automationVoucherGrant.count({ where: { vendorId: t.vendor.id } })).toBe(1);
    expect(await db.emailDelivery.count({ where: { vendorId: t.vendor.id, trigger: "automation" } })).toBe(1);
  });

  it("a rule created after the payment never runs for a later duplicate paid callback", async () => {
    const t = await tenant("late-rule");
    const c = await checkout(t);
    await processPaymentWebhook(callback(t, c, "paid"));
    await paymentRule(t);
    await processPaymentWebhook(callback(t, c, "paid"));
    expect(await logsOf(t)).toEqual([]);
  });

  it("concurrent paid callbacks (different event ids) dispatch once", async () => {
    const t = await tenant("concurrent");
    await paymentRule(t, { actions: [{ type: "add_customer_tag", tag: "已付款" }, { type: "send_email_notification", template: "repurchase_followup" }] });
    const c = await checkout(t);
    const results = await Promise.allSettled([1, 2, 3].map(() => processPaymentWebhook(callback(t, c, "paid"))));
    // Serializable conflicts beyond the retry budget are the provider's to redeliver; the payment converges either way.
    expect(results.some((result) => result.status === "fulfilled")).toBe(true);
    expect(await paymentState(c)).toEqual(PAID_STATE);
    expect((await logsOf(t)).map((log) => log.status)).toEqual(["completed"]);
    expect(await db.emailDelivery.count({ where: { vendorId: t.vendor.id, trigger: "automation" } })).toBe(1);
  });

  it("concurrent direct dispatches for one order claim each rule once", async () => {
    const t = await tenant("claims");
    await paymentRule(t, { actions: [{ type: "add_customer_tag", tag: "已付款" }, { type: "send_email_notification", template: "repurchase_followup" }] });
    const c = await checkout(t);
    hooks.dispatch = async () => [];
    await processPaymentWebhook(callback(t, c, "paid"));
    hooks.dispatch = null;
    const outcomes = await Promise.all([1, 2, 3, 4].map(() => dispatchPaymentPaidAutomationForOrder({ vendorId: t.vendor.id, orderId: c.orderId })));
    const statuses = outcomes.flatMap((outcome) => outcome.status === "dispatched" ? outcome.results.map((result) => result.status) : []);
    expect(statuses.filter((status) => status === "completed")).toHaveLength(1);
    expect(statuses.filter((status) => status === "duplicate")).toHaveLength(3);
    expect(await db.customerTagAssignment.count({ where: { vendorId: t.vendor.id } })).toBe(1);
    expect(await db.emailDelivery.count({ where: { vendorId: t.vendor.id, trigger: "automation" } })).toBe(1);
  });

  it("the webhook route: Return and Notify of one trade answer as before, register one post-response hook and run the rule once", async () => {
    vi.stubEnv("PAYMENT_PROVIDER", "demo");
    const t = await tenant("route");
    await paymentRule(t);
    const c = await checkout(t, "demo");
    const scheduled: Array<() => unknown> = [];
    hooks.after = (work) => { scheduled.push(work); };
    const event = { provider: "demo", eventId: `paid-auto-route-${randomUUID()}`, eventType: "paid", vendorId: t.vendor.id, orderNumber: c.orderNumber, grossAmountCents: PRICE_CENTS, currency: "TWD" };
    const deliver = (source: string) => paymentWebhookRoute(new Request(`http://127.0.0.1:31041/api/webhooks/payments?provider=demo&source=${source}`, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(event),
    }));
    const responses = await Promise.all([deliver("notify"), deliver("return"), deliver("notify")]);
    const bodies = await Promise.all(responses.map(async (response) => ({ status: response.status, body: await response.json() as Record<string, unknown> })));
    // One claim holder answers 200; the others are 200 duplicates or 503 "redeliver", never 500.
    expect(bodies.every(({ status }) => status === 200 || status === 503)).toBe(true);
    expect(bodies.filter(({ status, body }) => status === 200 && !body.duplicate)).toHaveLength(1);
    // The response went out before any rule ran.
    expect(await logsOf(t)).toEqual([]);
    expect(scheduled).toHaveLength(1);
    await Promise.all(scheduled.map((work) => work()));
    expect((await logsOf(t)).map((log) => log.status)).toEqual(["completed"]);
    // A redelivered Notify after the hook ran: duplicate, nothing scheduled.
    const redelivered = await deliver("notify");
    expect(redelivered.status).toBe(200);
    expect(await redelivered.json()).toMatchObject({ duplicate: true });
    expect(scheduled).toHaveLength(1);
    expect(await paymentState(c)).toEqual(PAID_STATE);
  });
});

describe("失敗隔離：自動化不影響付款結果", () => {
  it("an automation that throws leaves the payment and the webhook result untouched and is reported", async () => {
    const t = await tenant("throws");
    await paymentRule(t);
    const c = await checkout(t);
    hooks.dispatch = async () => { throw new Error("synthetic automation outage"); };
    const result = await processPaymentWebhook(callback(t, c, "paid"));
    expect(result.transaction).toMatchObject({ id: c.transactionId, status: "paid" });
    expect(await paymentState(c)).toEqual(PAID_STATE);
    expect(monitoring.captureOperationalError).toHaveBeenCalledWith(expect.any(Error), expect.objectContaining({ area: "payment_paid_automation", operation: "dispatch", vendorId: t.vendor.id }));
  });

  it("through the route: a hook that throws after the response changes neither the 200 nor the payment", async () => {
    vi.stubEnv("PAYMENT_PROVIDER", "demo");
    const t = await tenant("route-throws");
    await paymentRule(t);
    const c = await checkout(t, "demo");
    const scheduled: Array<() => unknown> = [];
    hooks.after = (work) => { scheduled.push(work); };
    hooks.dispatch = async () => { throw new Error("synthetic automation outage"); };
    const response = await paymentWebhookRoute(new Request("http://127.0.0.1:31041/api/webhooks/payments?provider=demo", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ provider: "demo", eventId: `paid-auto-route-${randomUUID()}`, eventType: "paid", vendorId: t.vendor.id, orderNumber: c.orderNumber, grossAmountCents: PRICE_CENTS, currency: "TWD" }),
    }));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ ok: true, transactionId: c.transactionId, vendorId: t.vendor.id });
    expect(scheduled).toHaveLength(1);
    // The hook itself never rejects.
    await expect(Promise.resolve(scheduled[0]!())).resolves.toBeUndefined();
    expect(await paymentState(c)).toEqual(PAID_STATE);
    expect(await db.webhookEvent.count({ where: { vendorId: t.vendor.id, status: "processed" } })).toBe(1);
  });

  it("a rule whose e-mail cannot get its unsubscribe link (no NEXT_PUBLIC_APP_URL) fails on its own; the payment and other actions stand", async () => {
    const t = await tenant("no-url");
    await paymentRule(t, { actions: [{ type: "add_customer_tag", tag: "已付款" }, { type: "send_email_notification", template: "repurchase_followup" }] });
    const c = await checkout(t);
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "");
    await processPaymentWebhook(callback(t, c, "paid"));
    expect(await paymentState(c)).toEqual(PAID_STATE);
    const [log] = await logsOf(t);
    expect(log).toMatchObject({ status: "failed", errorCode: "unsubscribe_url_unavailable" });
    expect(await db.customerTagAssignment.count({ where: { vendorId: t.vendor.id } })).toBe(1);
    expect(await db.emailDelivery.count({ where: { vendorId: t.vendor.id, trigger: "automation" } })).toBe(0);
    expect(monitoring.captureOperationalError).toHaveBeenCalledWith(expect.any(Error), expect.objectContaining({ area: "payment_paid_automation", operation: "rule_failed", failedRules: 1 }));
  });

  it("an action that throws fails its rule only; the other rule still runs and the payment stands", async () => {
    const t = await tenant("action-throws");
    const broken = await paymentRule(t, { actions: [{ type: "add_customer_tag", tag: "先貼標" }, { type: "line_push", message: "感謝購買" }] });
    const fine = await paymentRule(t, { actions: [{ type: "add_customer_tag", tag: "第二條" }] });
    const c = await checkout(t);
    hooks.line = async () => { throw new Error("synthetic LINE outbox failure"); };
    await processPaymentWebhook(callback(t, c, "paid"));
    expect(await paymentState(c)).toEqual(PAID_STATE);
    const logs = await logsOf(t);
    expect(logs.find((log) => log.ruleId === broken.id)).toMatchObject({ status: "failed", errorCode: "action_failed" });
    expect(logs.find((log) => log.ruleId === fine.id)).toMatchObject({ status: "completed" });
    expect((await db.customerTagAssignment.findMany({ where: { vendorId: t.vendor.id }, select: { tag: true } })).map((row) => row.tag).sort()).toEqual(["先貼標", "第二條"]);
  });
});

describe("跨租戶、退款、失敗、停權", () => {
  it("vendor A's paid order never runs vendor B's rules, and B cannot dispatch A's order", async () => {
    const a = await tenant("A");
    const b = await tenant("B");
    const ruleB = await paymentRule(b);
    const c = await checkout(a);
    await processPaymentWebhook(callback(a, c, "paid"));
    expect(await logsOf(b)).toEqual([]);
    expect(await logsOf(a)).toEqual([]);
    await expect(dispatchPaymentPaidAutomationForOrder({ vendorId: b.vendor.id, orderId: c.orderId })).resolves.toEqual({ status: "not_applicable" });
    expect(await db.automationExecutionLog.count({ where: { ruleId: ruleB.id } })).toBe(0);
    expect(await db.customerTagAssignment.count({ where: { vendorId: { in: [a.vendor.id, b.vendor.id] } } })).toBe(0);
  });

  it("a failed payment does not trigger; the paid callback that follows it triggers once", async () => {
    const t = await tenant("failed");
    await paymentRule(t);
    const c = await checkout(t);
    await processPaymentWebhook(callback(t, c, "failed"));
    expect(await db.commerceOrder.findUniqueOrThrow({ where: { id: c.orderId } })).toMatchObject({ status: "payment_failed" });
    expect(await logsOf(t)).toEqual([]);
    await processPaymentWebhook(callback(t, c, "paid"));
    expect((await logsOf(t)).map((log) => log.status)).toEqual(["completed"]);
  });

  it("partial and full refunds never trigger, and a refunded order cannot be dispatched", async () => {
    const t = await tenant("refund");
    await paymentRule(t);
    const c = await checkout(t);
    await processPaymentWebhook(callback(t, c, "paid"));
    expect(await logsOf(t)).toHaveLength(1);
    // A rule added after the payment: refunds must not start it.
    const later = await paymentRule(t, { actions: [{ type: "add_customer_tag", tag: "退款後" }] });
    await processPaymentWebhook(refund(t, c, "partially_refunded", 500));
    await expect(dispatchPaymentPaidAutomationForOrder({ vendorId: t.vendor.id, orderId: c.orderId })).resolves.toEqual({ status: "not_applicable" });
    await processPaymentWebhook(refund(t, c, "refunded", PRICE_CENTS - 500));
    expect(await db.commerceOrder.findUniqueOrThrow({ where: { id: c.orderId } })).toMatchObject({ status: "refunded", refundedAmountCents: PRICE_CENTS });
    expect(await logsOf(t)).toHaveLength(1);
    expect(await db.automationExecutionLog.count({ where: { ruleId: later.id } })).toBe(0);
    await expect(dispatchPaymentPaidAutomationForOrder({ vendorId: t.vendor.id, orderId: c.orderId })).resolves.toEqual({ status: "not_applicable" });
  });

  it("a suspended vendor's payment is recorded but runs no automation (F-036)", async () => {
    const t = await tenant("suspended");
    await paymentRule(t);
    const c = await checkout(t);
    // The authoritative state the payment path reads (src/lib/vendor-suspension-state.ts).
    await db.vendor.update({ where: { id: t.vendor.id }, data: { suspendedAt: new Date(), suspendedReason: "合成測試停權" } });
    await processPaymentWebhook(callback(t, c, "paid"));
    expect(await paymentState(c)).toEqual(PAID_STATE);
    expect(await logsOf(t)).toEqual([]);
  });
});
