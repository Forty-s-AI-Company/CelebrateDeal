import { createHash, randomUUID } from "node:crypto";
import { Prisma, PrismaClient } from "@prisma/client";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Q-09: delayed steps of `payment_paid` rules on the disposable PostgreSQL
// database. Checkouts, payment and refund callbacks, orders, rules, steps,
// runs, execution logs, tags, LINE outbox rows and e-mails are real, and so
// are the worker (runDelayedStepWorker), the webhook-retry catch-up and the
// e-mail job's owed-run back-fill. Synthetic: the post-response hook
// (`after`, which needs a Next.js request scope), the immediate e-mail send,
// the e-mail provider and monitoring. No provider, e-mail or LINE service is
// called.
const hooks = vi.hoisted(() => ({
  after: (() => { throw new Error("`after` was called outside a request scope"); }) as (callback: () => unknown) => void,
  /** While set, decrypting an order's buyer envelope fails (one order's envelope problem). */
  revealFails: false,
  /** Calls of revealCommerceOrderPii, so a case can show the envelope was really tried. */
  revealCalls: 0,
  /** Runs right before the real decryption (a case can take the deployment's key away mid-round). */
  beforeReveal: null as null | (() => void),
}));
const monitoring = vi.hoisted(() => ({ captureOperationalError: vi.fn() }));
const provider = vi.hoisted(() => ({ send: vi.fn() }));

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
vi.mock("@/lib/email", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/email")>()), sendTransactionalEmail: provider.send }));
vi.mock("@/lib/commerce-order-pii", async (original) => {
  const actual = await original<typeof import("@/lib/commerce-order-pii")>();
  return {
    ...actual,
    revealCommerceOrderPii: (...args: Parameters<typeof actual.revealCommerceOrderPii>) => {
      hooks.revealCalls += 1;
      hooks.beforeReveal?.();
      if (hooks.revealFails) throw new Error("synthetic envelope failure");
      return actual.revealCommerceOrderPii(...args);
    },
  };
});

import { runDelayedStepWorker, startPendingAutomationRuns, PENDING_RUN_START_MIN_AGE_MS } from "@/lib/automation-delayed-steps";
import { DELAYED_STEP_LEASE_MS } from "@/lib/delayed-step-runs";
import { AUTOMATION_STEP_EMAIL_TRIGGER } from "@/lib/automation-email-trigger";
import { automationStepExecutionLogId } from "@/lib/automation-workflow";
import { createCommerceOrderForCheckout } from "@/lib/commerce-orders";
import { getDb } from "@/lib/db";
import { dispatchEmailDelivery } from "@/lib/email-delivery";
import { revealEmailDeliveryPayload } from "@/lib/email-delivery-pii";
import { createReservedPaymentTransaction } from "@/lib/inventory-reservations";
import { protectLineOfficialAccountCredentials } from "@/lib/line-credentials";
import { dispatchPaymentPaidAutomationForOrder } from "@/lib/payment-paid-automation";
import { PAYMENT_PAID_CATCHUP_MIN_AGE_MS, runPaymentPaidAutomationCatchup } from "@/lib/payment-paid-automation-catchup";
import { PaymentWebhookPayload, processPaymentWebhook } from "@/lib/payment-webhooks";
import { consumeStudentPortalAccessToken, createStudentPortalAccessToken } from "@/lib/student-portal-auth";

// Each case pays orders through the real webhook path (a Serializable
// transaction each); give slow shared runners room instead of the 5 s default.
vi.setConfig({ testTimeout: 30_000 });

const db = getDb();
const vendorIds: string[] = [];
const extraClients: PrismaClient[] = [];
const PRICE_CENTS = 2_000;
const MINUTE = 60_000;
const GRANT = "automation_delayed_steps";
const TAG_STEP = { type: "add_customer_tag", tag: "付款三天後" };
const EMAIL_STEP = { type: "send_email_notification", template: "repurchase_followup" };
const LINE_STEP = { type: "line_push", message: "還喜歡你買的商品嗎？" };

/** Bounded clients of their own, so racing callers never wait on the shared pool. */
function boundedClient(connections: number) {
  const url = new URL(process.env.DATABASE_URL ?? "");
  url.searchParams.set("connection_limit", String(connections));
  url.searchParams.set("pool_timeout", "20");
  const created = new PrismaClient({ datasourceUrl: url.toString() });
  extraClients.push(created);
  return created;
}

beforeEach(() => {
  vi.stubEnv("CSRF_SECRET", "payment-paid-delayed-steps-secret-longer-than-32-bytes");
  vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://paid-steps.example.test");
  // Synthetic provider settings: the worker only checks that they exist.
  vi.stubEnv("RESEND_API_KEY", "re_synthetic_paid_steps");
  vi.stubEnv("EMAIL_FROM", "CelebrateDeal <no-reply@example.test>");
  hooks.after = () => { throw new Error("`after` was called outside a request scope"); };
  hooks.revealFails = false;
  hooks.revealCalls = 0;
  hooks.beforeReveal = null;
  provider.send.mockReset();
  provider.send.mockResolvedValue({ id: "synthetic-provider-message" });
  monitoring.captureOperationalError.mockClear();
});

afterEach(async () => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  await db.auditLog.deleteMany({ where: { vendorId: { in: vendorIds } } });
  await db.vendor.deleteMany({ where: { id: { in: vendorIds.splice(0) } } });
});

afterAll(async () => {
  await Promise.all(extraClients.splice(0).map((client) => client.$disconnect()));
});

async function tenant(label: string, options: { grant?: boolean } = {}) {
  const key = randomUUID();
  const vendor = await db.vendor.create({
    data: {
      name: `付款延遲步驟 ${label}`,
      slug: `paid-steps-${key}`,
      email: `vendor-${key}@example.test`,
      passwordHash: "synthetic-only",
      betaFeatureGrants: options.grant === false ? [] : [GRANT],
    },
  });
  vendorIds.push(vendor.id);
  const product = await db.product.create({
    data: { vendorId: vendor.id, name: "付款商品", slug: `paid-steps-product-${key}`, priceCents: PRICE_CENTS, currency: "TWD", inventory: 200, isActive: true, fulfillmentTypeConfirmed: true },
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
  const form = await db.registrationForm.create({
    data: { vendorId: vendor.id, name: "報名表", slug: `paid-steps-form-${key}`, headline: "報名", fields: [{ key: "email", label: "Email", type: "email", required: true }] },
  });
  return { vendor, product, form };
}
type Tenant = Awaited<ReturnType<typeof tenant>>;

/** The checkout route's reservation, plus a LINE identity linked to the order. */
async function checkout(t: Tenant, buyerEmail = `buyer-${randomUUID().slice(0, 8)}@example.test`) {
  const orderNumber = `PAID-STEPS-${randomUUID()}`;
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
        totalAmountCents: PRICE_CENTS, currency: "TWD", buyer: { name: "合成買家", email: buyerEmail, phone: "0912345678" }, shipping: null,
      });
    },
  });
  const order = await db.commerceOrder.findFirstOrThrow({ where: { vendorId: t.vendor.id, primaryPaymentTransactionId: transaction.id } });
  await db.lineUserIdentity.create({
    data: { vendorId: t.vendor.id, subjectType: "buyer_order", subjectId: order.id, lineUserIdHash: createHash("sha256").update(randomUUID()).digest("hex"), lineUserIdEncrypted: "v1.synthetic" },
  });
  return { transactionId: transaction.id, orderNumber, orderId: order.id, buyerEmail, customerKey: order.automationCustomerKeyHash };
}
type Checkout = Awaited<ReturnType<typeof checkout>>;

function paidCallback(t: Tenant, c: Checkout) {
  return PaymentWebhookPayload.parse({ provider: "payuni", eventId: `paid-steps-${randomUUID()}`, eventType: "paid", vendorId: t.vendor.id, orderNumber: c.orderNumber, grossAmountCents: PRICE_CENTS, currency: "TWD" });
}

function refundCallback(t: Tenant, c: Checkout, eventType: "refunded" | "partially_refunded", refundAmountCents: number) {
  return PaymentWebhookPayload.parse({ provider: "payuni", eventId: `paid-steps-refund-${randomUUID()}`, eventType, vendorId: t.vendor.id, orderNumber: c.orderNumber, refundAmountCents, currency: "TWD" });
}

/** Pays the order through the real webhook; outside a request the rules run inline. */
async function pay(t: Tenant, c: Checkout) {
  await processPaymentWebhook(paidCallback(t, c));
}

async function paymentRule(t: Tenant, options: { steps?: Array<{ delayMinutes: number; actions: unknown[] }>; isActive?: boolean; amountCents?: number } = {}) {
  const rule = await db.automationRule.create({
    data: {
      vendorId: t.vendor.id,
      name: `付款追蹤 ${randomUUID().slice(0, 6)}`,
      trigger: "payment_paid",
      condition: { type: "order_amount_gte", amountCents: options.amountCents ?? 1_000 } as Prisma.InputJsonValue,
      actions: [{ type: "add_customer_tag", tag: "已付款" }] as Prisma.InputJsonArray,
      isActive: options.isActive ?? true,
    },
  });
  const steps = [];
  for (const step of options.steps ?? [{ delayMinutes: 60, actions: [TAG_STEP, EMAIL_STEP] }]) {
    steps.push(await db.automationRuleStep.create({
      data: { vendorId: t.vendor.id, ruleId: rule.id, delayMinutes: step.delayMinutes, condition: { type: "always" } as Prisma.InputJsonValue, actions: step.actions as Prisma.InputJsonArray },
    }));
  }
  return { rule, steps };
}

async function verifiedRegistration(t: Tenant, email: string) {
  return db.formSubmission.create({
    data: { formId: t.form.id, name: "王小明", email, verificationStatus: "VERIFIED", verifiedAt: new Date() },
  });
}

function runsOf(t: Tenant) {
  return db.delayedStepRun.findMany({ where: { vendorId: t.vendor.id }, orderBy: { createdAt: "asc" } });
}

async function onlyRun(t: Tenant) {
  const runs = await runsOf(t);
  expect(runs).toHaveLength(1);
  return runs[0]!;
}

function stepMails(t: Tenant) {
  return db.emailDelivery.findMany({ where: { vendorId: t.vendor.id, trigger: AUTOMATION_STEP_EMAIL_TRIGGER }, orderBy: { createdAt: "asc" } });
}

/** One job round for this vendor. */
function work(t: Tenant, now: Date) {
  return runDelayedStepWorker({ now, vendorId: t.vendor.id });
}

/** The step's execution log of a run, if any. */
function stepLog(t: Tenant, runId: string, stepId: string) {
  return db.automationExecutionLog.findFirst({ where: { id: automationStepExecutionLogId(t.vendor.id, runId, stepId), vendorId: t.vendor.id } });
}

function stepResults(log: { actionResults: unknown } | null) {
  return ((log?.actionResults as { results?: unknown[] } | null)?.results ?? []) as Array<Record<string, unknown>>;
}

const due = (run: { anchorAt: Date }, delayMinutes: number) => new Date(run.anchorAt.getTime() + delayMinutes * MINUTE + MINUTE);

describe("付款後建立 run、到點執行", () => {
  it("creates one run on the paid order after the immediate actions, with references only, and runs the step when due", async () => {
    const t = await tenant("A");
    const { rule, steps } = await paymentRule(t, { steps: [{ delayMinutes: 60, actions: [TAG_STEP, EMAIL_STEP, LINE_STEP] }] });
    // Same address as the order, written differently: the exact normalized match counts (trim + lowercase).
    const c = await checkout(t, "Paid.Buyer@Example.test");
    await verifiedRegistration(t, "  paid.buyer@example.test ");

    await pay(t, c);

    const log = await db.automationExecutionLog.findFirstOrThrow({ where: { vendorId: t.vendor.id, ruleId: rule.id, eventId: `payment-paid:${c.orderId}` } });
    expect(log).toMatchObject({ status: "completed", trigger: "payment_paid", subjectType: "buyer_order", delayedStepsPendingSubjectId: null });
    const run = await onlyRun(t);
    expect(run).toMatchObject({
      automationRuleId: rule.id,
      sourceExecutionLogId: log.id,
      commerceOrderId: c.orderId,
      formSubmissionId: null,
      consultationBookingId: null,
      emailSequenceId: null,
      recipientHash: null,
      subjectKeyHash: c.customerKey,
      status: "active",
      cursorDelayMinutes: -1,
    });
    expect(run.anchorAt.getTime()).toBe(log.createdAt.getTime());
    expect(run.nextRunAt?.getTime()).toBe(log.createdAt.getTime() + 60 * MINUTE);
    // References only: nothing on the run carries the address.
    expect(JSON.stringify(run).toLowerCase()).not.toContain("paid.buyer");

    // Not due yet.
    await work(t, new Date(run.anchorAt.getTime() + 30 * MINUTE));
    await expect(db.customerTagAssignment.count({ where: { vendorId: t.vendor.id, tag: TAG_STEP.tag } })).resolves.toBe(0);

    const lineBefore = await db.lineDelivery.count({ where: { vendorId: t.vendor.id } });
    await work(t, due(run, 60));
    const executed = await stepLog(t, run.id, steps[0]!.id);
    expect(executed).toMatchObject({ status: "completed", trigger: "payment_paid", subjectType: "buyer_order", subjectKeyHash: c.customerKey, eventId: `delayed-step:${run.id}:${steps[0]!.id}` });
    await expect(db.customerTagAssignment.count({ where: { vendorId: t.vendor.id, customerKeyHash: c.customerKey!, tag: TAG_STEP.tag } })).resolves.toBe(1);
    // LINE goes to the identity bound to the order (buyer_order).
    await expect(db.lineDelivery.count({ where: { vendorId: t.vendor.id } })).resolves.toBe(lineBefore + 1);
    const mails = await stepMails(t);
    expect(mails).toHaveLength(1);
    const payload = revealEmailDeliveryPayload(mails[0]!.payloadEncryptedEnvelope, { vendorId: t.vendor.id, deliveryId: mails[0]!.id });
    // The address decrypted from the order (checkout stores it normalized), read now.
    expect(payload.recipientEmail).toBe("paid.buyer@example.test");
    expect(payload.body).toContain("/unsubscribe");
    await expect(db.delayedStepRun.findUniqueOrThrow({ where: { id: run.id } })).resolves.toMatchObject({ status: "completed", cursorDelayMinutes: 60 });

    // The queued step e-mail goes out at send time.
    await expect(dispatchEmailDelivery(mails[0]!.id)).resolves.toMatchObject({ status: "sent" });
  });

  it("creates no run for a rule whose amount threshold the order does not reach, a switched-off rule, a vendor without the grant or a test order", async () => {
    const t = await tenant("thresholds");
    const above = await paymentRule(t, { amountCents: PRICE_CENTS + 1 });
    const off = await paymentRule(t, { isActive: false });
    const c = await checkout(t);
    await pay(t, c);
    expect(await runsOf(t)).toEqual([]);
    await expect(db.automationExecutionLog.findFirstOrThrow({ where: { ruleId: above.rule.id } })).resolves.toMatchObject({ status: "skipped", delayedStepsPendingSubjectId: null });
    await expect(db.automationExecutionLog.count({ where: { ruleId: off.rule.id } })).resolves.toBe(0);

    const closed = await tenant("no-grant", { grant: false });
    await paymentRule(closed);
    const closedOrder = await checkout(closed);
    await pay(closed, closedOrder);
    expect(await runsOf(closed)).toEqual([]);
    // Q-13: no grant, no owed-run mark either.
    await expect(db.automationExecutionLog.findFirstOrThrow({ where: { vendorId: closed.vendor.id } })).resolves.toMatchObject({ status: "completed", delayedStepsPendingSubjectId: null });

    // 測試單：the trigger and the dispatch never take it, so no run.
    const testShop = await tenant("test-order");
    await paymentRule(testShop);
    const testOrder = await checkout(testShop);
    await db.commerceOrder.update({ where: { id: testOrder.orderId }, data: { isTestOrder: true } });
    await pay(testShop, testOrder);
    await expect(dispatchPaymentPaidAutomationForOrder({ vendorId: testShop.vendor.id, orderId: testOrder.orderId })).resolves.toEqual({ status: "not_applicable" });
    expect(await runsOf(testShop)).toEqual([]);
    await expect(db.automationExecutionLog.count({ where: { vendorId: testShop.vendor.id } })).resolves.toBe(0);
  });

  it("evaluates a step's amount condition against the server's paid amount, read again when the step is due", async () => {
    const t = await tenant("step-condition");
    const { steps } = await paymentRule(t, { steps: [{ delayMinutes: 60, actions: [TAG_STEP] }, { delayMinutes: 120, actions: [{ type: "add_customer_tag", tag: "高客單" }] }] });
    // Only a direct write gives a step an amount condition (the Server Action saves "always").
    await db.automationRuleStep.update({ where: { id: steps[1]!.id }, data: { condition: { type: "order_amount_gte", amountCents: PRICE_CENTS + 1 } } });
    const c = await checkout(t);
    await pay(t, c);
    const run = await onlyRun(t);
    await work(t, due(run, 60));
    await work(t, due(run, 120));
    await expect(stepLog(t, run.id, steps[1]!.id)).resolves.toMatchObject({ status: "skipped", conditionMatched: false });
    await expect(db.customerTagAssignment.count({ where: { vendorId: t.vendor.id, tag: "高客單" } })).resolves.toBe(0);
    await expect(db.customerTagAssignment.count({ where: { vendorId: t.vendor.id, tag: TAG_STEP.tag } })).resolves.toBe(1);
  });
});

describe("到點時重讀訂單", () => {
  it("stops after a full refund (no action, no e-mail), and goes on after a partial refund", async () => {
    const full = await tenant("full-refund");
    const fullRule = await paymentRule(full);
    const fullOrder = await checkout(full);
    await verifiedRegistration(full, fullOrder.buyerEmail);
    await pay(full, fullOrder);
    await processPaymentWebhook(refundCallback(full, fullOrder, "refunded", PRICE_CENTS));
    await expect(db.commerceOrder.findUniqueOrThrow({ where: { id: fullOrder.orderId } })).resolves.toMatchObject({ status: "refunded", refundedAmountCents: PRICE_CENTS });
    const fullRun = await onlyRun(full);
    await work(full, due(fullRun, 60));
    await expect(db.delayedStepRun.findUniqueOrThrow({ where: { id: fullRun.id } })).resolves.toMatchObject({ status: "cancelled", cancelReason: "subject_gone", nextRunAt: null });
    await expect(stepLog(full, fullRun.id, fullRule.steps[0]!.id)).resolves.toBeNull();
    await expect(db.customerTagAssignment.count({ where: { vendorId: full.vendor.id, tag: TAG_STEP.tag } })).resolves.toBe(0);
    expect(await stepMails(full)).toEqual([]);

    const partial = await tenant("partial-refund");
    const partialRule = await paymentRule(partial);
    const partialOrder = await checkout(partial);
    await verifiedRegistration(partial, partialOrder.buyerEmail);
    await pay(partial, partialOrder);
    await processPaymentWebhook(refundCallback(partial, partialOrder, "partially_refunded", 500));
    await expect(db.commerceOrder.findUniqueOrThrow({ where: { id: partialOrder.orderId } })).resolves.toMatchObject({ status: "partially_refunded", refundedAmountCents: 500 });
    const partialRun = await onlyRun(partial);
    await work(partial, due(partialRun, 60));
    await expect(stepLog(partial, partialRun.id, partialRule.steps[0]!.id)).resolves.toMatchObject({ status: "completed" });
    await expect(db.delayedStepRun.findUniqueOrThrow({ where: { id: partialRun.id } })).resolves.toMatchObject({ status: "completed" });
    expect(await stepMails(partial)).toHaveLength(1);
  });

  it("review NIT-2: two refunds that add up to the full amount stop the step that falls due after them", async () => {
    const t = await tenant("two-partials");
    const { steps } = await paymentRule(t);
    const c = await checkout(t);
    await verifiedRegistration(t, c.buyerEmail);
    await pay(t, c);
    const run = await onlyRun(t);
    await processPaymentWebhook(refundCallback(t, c, "partially_refunded", 1_200));
    await expect(db.commerceOrder.findUniqueOrThrow({ where: { id: c.orderId } })).resolves.toMatchObject({ status: "partially_refunded", refundedAmountCents: 1_200 });
    // A second `partially_refunded` event for the whole remainder is refused by
    // the payment invariants (a partial refund may not use up what is left)
    // and changes nothing; the remainder arrives as the provider's `refunded`.
    await expect(processPaymentWebhook(refundCallback(t, c, "partially_refunded", PRICE_CENTS - 1_200))).rejects.toThrow();
    await expect(db.commerceOrder.findUniqueOrThrow({ where: { id: c.orderId } })).resolves.toMatchObject({ status: "partially_refunded", refundedAmountCents: 1_200 });
    await processPaymentWebhook(refundCallback(t, c, "refunded", PRICE_CENTS - 1_200));
    await expect(db.commerceOrder.findUniqueOrThrow({ where: { id: c.orderId } })).resolves.toMatchObject({ refundedAmountCents: PRICE_CENTS });
    await work(t, due(run, 60));
    await expect(db.delayedStepRun.findUniqueOrThrow({ where: { id: run.id } })).resolves.toMatchObject({ status: "cancelled", cancelReason: "subject_gone" });
    await expect(stepLog(t, run.id, steps[0]!.id)).resolves.toBeNull();
    await expect(db.customerTagAssignment.count({ where: { vendorId: t.vendor.id, tag: TAG_STEP.tag } })).resolves.toBe(0);
    expect(await stepMails(t)).toEqual([]);
  });

  it("stops on a cancelled order, a test order and an order whose refunds reached the paid amount while still marked paid", async () => {
    for (const change of [
      { status: "cancelled" as const },
      { isTestOrder: true },
      { refundedAmountCents: PRICE_CENTS },
    ]) {
      const t = await tenant(`gone-${Object.keys(change)[0]}`);
      await paymentRule(t);
      const c = await checkout(t);
      await pay(t, c);
      const run = await onlyRun(t);
      await db.commerceOrder.update({ where: { id: c.orderId }, data: change });
      await work(t, due(run, 60));
      await expect(db.delayedStepRun.findUniqueOrThrow({ where: { id: run.id } })).resolves.toMatchObject({ status: "cancelled", cancelReason: "subject_gone" });
      await expect(db.customerTagAssignment.count({ where: { vendorId: t.vendor.id, tag: TAG_STEP.tag } })).resolves.toBe(0);
    }
  });

  it("does not send a queued step e-mail once the order was fully refunded after the step ran", async () => {
    const t = await tenant("refund-before-send");
    await paymentRule(t);
    const c = await checkout(t);
    await verifiedRegistration(t, c.buyerEmail);
    await pay(t, c);
    const run = await onlyRun(t);
    await work(t, due(run, 60));
    const [mail] = await stepMails(t);
    expect(mail).toMatchObject({ status: "queued" });
    await processPaymentWebhook(refundCallback(t, c, "refunded", PRICE_CENTS));
    await expect(dispatchEmailDelivery(mail!.id)).resolves.toMatchObject({ status: "superseded" });
    expect(provider.send).not.toHaveBeenCalled();
  });

  it("keeps a suspended vendor's run without running it, also when the suspension lands after the claim", async () => {
    const t = await tenant("suspended");
    await paymentRule(t);
    const c = await checkout(t);
    await pay(t, c);
    const run = await onlyRun(t);
    // Suspended before the round: not claimed at all.
    await db.vendor.update({ where: { id: t.vendor.id }, data: { suspendedAt: new Date(), suspendedReason: "合成" } });
    await work(t, due(run, 60));
    await expect(db.delayedStepRun.findUniqueOrThrow({ where: { id: run.id } })).resolves.toMatchObject({ status: "active", claimedAt: null, attemptCount: 0, cursorDelayMinutes: -1 });
    await db.vendor.update({ where: { id: t.vendor.id }, data: { suspendedAt: null, suspendedReason: null } });

    // Suspended between the claim and the order read: the lease is given back, the attempt is not counted.
    const original = db.commerceOrder.findFirst.bind(db.commerceOrder);
    vi.spyOn(db.commerceOrder, "findFirst").mockImplementationOnce((async (args: Parameters<typeof original>[0]) => {
      await db.vendor.update({ where: { id: t.vendor.id }, data: { suspendedAt: new Date(), suspendedReason: "合成" } });
      return original(args);
    }) as never);
    await work(t, due(run, 60));
    await expect(db.delayedStepRun.findUniqueOrThrow({ where: { id: run.id } })).resolves.toMatchObject({ status: "active", claimedAt: null, attemptCount: 0, cursorDelayMinutes: -1 });
    await expect(db.customerTagAssignment.count({ where: { vendorId: t.vendor.id, tag: TAG_STEP.tag } })).resolves.toBe(0);

    // Resumed: the step runs.
    vi.restoreAllMocks();
    await db.vendor.update({ where: { id: t.vendor.id }, data: { suspendedAt: null, suspendedReason: null } });
    await work(t, due(run, 60));
    await expect(db.customerTagAssignment.count({ where: { vendorId: t.vendor.id, tag: TAG_STEP.tag } })).resolves.toBe(1);
  });

  it("stops when the rule is switched off (definition_paused)", async () => {
    const t = await tenant("rule-off");
    const { rule } = await paymentRule(t);
    const c = await checkout(t);
    await pay(t, c);
    const run = await onlyRun(t);
    await db.automationRule.update({ where: { id: rule.id }, data: { isActive: false } });
    await work(t, due(run, 60));
    await expect(db.delayedStepRun.findUniqueOrThrow({ where: { id: run.id } })).resolves.toMatchObject({ status: "cancelled", cancelReason: "definition_paused" });
  });
});

describe("收件者 Email：只寄給本商家已確認的地址", () => {
  /** Pays, runs the rule's first step when due and returns what its e-mail and tag actions recorded. */
  async function stepEmailOutcome(t: Tenant, c: Checkout) {
    const { steps } = await db.automationRule.findFirstOrThrow({ where: { vendorId: t.vendor.id }, select: { steps: { orderBy: { delayMinutes: "asc" } } } });
    await pay(t, c);
    const run = await onlyRun(t);
    await work(t, due(run, 60));
    const results = stepResults(await stepLog(t, run.id, steps[0]!.id));
    return {
      email: results.find((result) => result.type === "send_email_notification"),
      tag: results.find((result) => result.type === "add_customer_tag"),
      mails: await stepMails(t),
    };
  }

  it("skips the e-mail of a buyer with no verified registration or portal sign-in as recipient_unverified, and runs the other actions", async () => {
    const t = await tenant("unverified");
    await paymentRule(t);
    const c = await checkout(t);
    // An unverified registration and a portal link never opened do not count.
    await db.formSubmission.create({ data: { formId: t.form.id, name: "王小明", email: c.buyerEmail, verificationStatus: "UNVERIFIED" } });
    await createStudentPortalAccessToken(db, { vendorId: t.vendor.id, email: c.buyerEmail, purpose: "magic_link" });
    const outcome = await stepEmailOutcome(t, c);
    expect(outcome.email).toMatchObject({ status: "skipped", reason: "recipient_unverified" });
    expect(outcome.tag).toMatchObject({ status: "tagged" });
    expect(outcome.mails).toEqual([]);
  });

  it("mails a buyer who signed in to the vendor's student portal with the same address", async () => {
    const t = await tenant("portal");
    await paymentRule(t);
    const c = await checkout(t);
    const token = await createStudentPortalAccessToken(db, { vendorId: t.vendor.id, email: ` ${c.buyerEmail.toUpperCase()} `, purpose: "magic_link" });
    await expect(consumeStudentPortalAccessToken(db, { token, expectedPurpose: "magic_link" })).resolves.not.toBeNull();
    const outcome = await stepEmailOutcome(t, c);
    expect(outcome.email).toMatchObject({ status: "queued" });
    expect(outcome.mails).toHaveLength(1);
  });

  it("does not count the checkout-success redirect token, which proves nothing about the mailbox", async () => {
    const t = await tenant("checkout-redirect");
    await paymentRule(t);
    const c = await checkout(t);
    const token = await createStudentPortalAccessToken(db, { vendorId: t.vendor.id, email: c.buyerEmail, purpose: "checkout_redirect" });
    await expect(consumeStudentPortalAccessToken(db, { token, expectedPurpose: "checkout_redirect" })).resolves.not.toBeNull();
    const outcome = await stepEmailOutcome(t, c);
    expect(outcome.email).toMatchObject({ status: "skipped", reason: "recipient_unverified" });
  });

  it("never counts another vendor's verified registration or portal sign-in", async () => {
    const t = await tenant("tenant-a");
    const other = await tenant("tenant-b");
    await paymentRule(t);
    const c = await checkout(t);
    await verifiedRegistration(other, c.buyerEmail);
    const token = await createStudentPortalAccessToken(db, { vendorId: other.vendor.id, email: c.buyerEmail, purpose: "magic_link" });
    await consumeStudentPortalAccessToken(db, { token, expectedPurpose: "magic_link" });
    const outcome = await stepEmailOutcome(t, c);
    expect(outcome.email).toMatchObject({ status: "skipped", reason: "recipient_unverified" });
  });

  it("follows the vendor's unsubscribe list and blacklist without stopping the run", async () => {
    const t = await tenant("suppressed");
    await paymentRule(t, { steps: [{ delayMinutes: 60, actions: [TAG_STEP, EMAIL_STEP] }, { delayMinutes: 120, actions: [EMAIL_STEP] }] });
    const c = await checkout(t);
    await verifiedRegistration(t, c.buyerEmail);
    await db.blacklist.create({ data: { vendorId: t.vendor.id, identifierType: "email", identifier: c.buyerEmail.toLowerCase(), reason: "合成" } });
    const outcome = await stepEmailOutcome(t, c);
    expect(outcome.email).toMatchObject({ status: "skipped", reason: "recipient_blacklisted" });
    expect(outcome.tag).toMatchObject({ status: "tagged" });
    await expect(onlyRun(t)).resolves.toMatchObject({ status: "active", cursorDelayMinutes: 60 });
  });
});

describe("跨租戶", () => {
  it("never starts a run for another vendor's order, and a run can only name its own vendor's order", async () => {
    const a = await tenant("owner");
    const b = await tenant("other");
    await paymentRule(a);
    const { rule: ruleB } = await paymentRule(b);
    const orderA = await checkout(a);
    await pay(a, orderA);
    // B's dispatch with A's order id: nothing (the order is read bound to B).
    await expect(dispatchPaymentPaidAutomationForOrder({ vendorId: b.vendor.id, orderId: orderA.orderId })).resolves.toEqual({ status: "not_applicable" });
    expect(await runsOf(b)).toEqual([]);
    // An owed-run mark on B's log naming A's order is cleared without a run.
    const logB = await db.automationExecutionLog.create({
      data: {
        vendorId: b.vendor.id, ruleId: ruleB.id, idempotencyKey: `synthetic-${randomUUID()}`, eventId: `payment-paid:${orderA.orderId}`,
        trigger: "payment_paid", subjectType: "buyer_order", subjectKeyHash: "synthetic-key", status: "completed",
        completedAt: new Date(Date.now() - 10 * MINUTE), delayedStepsPendingSubjectId: orderA.orderId,
      },
    });
    await startPendingAutomationRuns({ vendorId: b.vendor.id });
    await expect(db.automationExecutionLog.findUniqueOrThrow({ where: { id: logB.id } })).resolves.toMatchObject({ delayedStepsPendingSubjectId: null });
    expect(await runsOf(b)).toEqual([]);
    // Not even a direct write can point B's run at A's order (composite foreign key).
    await expect(db.delayedStepRun.create({
      data: { vendorId: b.vendor.id, automationRuleId: ruleB.id, sourceExecutionLogId: logB.id, commerceOrderId: orderA.orderId, subjectKeyHash: "k", anchorAt: new Date(), nextRunAt: new Date() },
    })).rejects.toMatchObject({ code: "P2003" });
    // A's own run is untouched.
    await expect(onlyRun(a)).resolves.toMatchObject({ commerceOrderId: orderA.orderId, status: "active" });
  });
});

describe("即時路徑與 #613 補跑", () => {
  /** A paid order whose live `after()` hook never ran. */
  async function missedPayment(t: Tenant) {
    hooks.after = () => undefined;
    const c = await checkout(t);
    await pay(t, c);
    return c;
  }

  /** Rules and their steps older than the payment, the payment inside the catch-up window. */
  async function backdate(t: Tenant, c: Checkout, paidAt: Date) {
    const ruleTime = new Date(paidAt.getTime() - MINUTE);
    await db.$executeRaw`UPDATE "AutomationRule" SET "createdAt" = ${ruleTime}, "updatedAt" = ${ruleTime} WHERE "vendorId" = ${t.vendor.id}`;
    await db.$executeRaw`UPDATE "AutomationRuleStep" SET "createdAt" = ${ruleTime}, "updatedAt" = ${ruleTime} WHERE "vendorId" = ${t.vendor.id}`;
    await db.commerceOrder.update({ where: { id: c.orderId }, data: { paidAt } });
    await db.commerceOrderEvent.updateMany({ where: { orderId: c.orderId, eventType: "payment.paid" }, data: { createdAt: paidAt } });
  }

  it("the catch-up of a missed payment creates the same run the live path would", async () => {
    const t = await tenant("catchup");
    const { rule } = await paymentRule(t);
    const c = await missedPayment(t);
    expect(await runsOf(t)).toEqual([]);
    const now = new Date();
    await backdate(t, c, new Date(now.getTime() - PAYMENT_PAID_CATCHUP_MIN_AGE_MS - 5 * MINUTE));
    await expect(runPaymentPaidAutomationCatchup({ db, now })).resolves.toMatchObject({ candidates: 1, completed: 1 });
    const log = await db.automationExecutionLog.findFirstOrThrow({ where: { vendorId: t.vendor.id, ruleId: rule.id } });
    await expect(onlyRun(t)).resolves.toMatchObject({ commerceOrderId: c.orderId, sourceExecutionLogId: log.id, anchorAt: log.createdAt, status: "active" });
  });

  it("review MINOR-1 / MINOR-A: a catch-up starts no run when an active step was added or edited after the payment, and leaves nothing owed", async () => {
    const now = new Date();
    const paidAt = new Date(now.getTime() - PAYMENT_PAID_CATCHUP_MIN_AGE_MS - 5 * MINUTE);

    // A step added after the payment.
    const added = await tenant("step-added");
    const addedRule = await paymentRule(added);
    const addedOrder = await missedPayment(added);
    await backdate(added, addedOrder, paidAt);
    await db.automationRuleStep.create({
      data: { vendorId: added.vendor.id, ruleId: addedRule.rule.id, delayMinutes: 120, condition: { type: "always" } as Prisma.InputJsonValue, actions: [TAG_STEP] as Prisma.InputJsonArray },
    });

    // A step edited (its delay moved) after the payment.
    const edited = await tenant("step-edited");
    const editedRule = await paymentRule(edited);
    const editedOrder = await missedPayment(edited);
    await backdate(edited, editedOrder, paidAt);
    await db.automationRuleStep.update({ where: { id: editedRule.steps[0]!.id }, data: { delayMinutes: 90 } });

    // An inactive step added after the payment does not count; the old active one starts the run.
    const inactive = await tenant("step-inactive");
    const inactiveRule = await paymentRule(inactive);
    const inactiveOrder = await missedPayment(inactive);
    await backdate(inactive, inactiveOrder, paidAt);
    await db.automationRuleStep.create({
      data: { vendorId: inactive.vendor.id, ruleId: inactiveRule.rule.id, delayMinutes: 180, condition: { type: "always" } as Prisma.InputJsonValue, actions: [TAG_STEP] as Prisma.InputJsonArray, isActive: false },
    });

    await expect(runPaymentPaidAutomationCatchup({ db, now })).resolves.toMatchObject({ candidates: 3, completed: 3 });
    for (const [t, rule] of [[added, addedRule.rule], [edited, editedRule.rule]] as const) {
      // The immediate actions ran; no delayed steps for this payment, and nothing owed to the job.
      await expect(db.automationExecutionLog.findFirstOrThrow({ where: { vendorId: t.vendor.id, ruleId: rule.id } }))
        .resolves.toMatchObject({ status: "completed", delayedStepsPendingSubjectId: null });
      expect(await runsOf(t)).toEqual([]);
      await expect(startPendingAutomationRuns({ now: new Date(now.getTime() + PENDING_RUN_START_MIN_AGE_MS + MINUTE), vendorId: t.vendor.id })).resolves.toEqual([]);
      expect(await runsOf(t)).toEqual([]);
    }
    await expect(onlyRun(inactive)).resolves.toMatchObject({ commerceOrderId: inactiveOrder.orderId, status: "active" });
  });

  it("re-review MINOR-A: a step added after the payment starts no run on the live path, on a replay or in the job's back-fill either", async () => {
    const now = new Date();
    const paidAt = new Date(now.getTime() - 20 * MINUTE);

    // Live path: the after() hook runs only after a step was added (payment recorded before it).
    const live = await tenant("after-step-live");
    const liveRule = await paymentRule(live);
    const liveOrder = await missedPayment(live);
    await backdate(live, liveOrder, paidAt);
    await db.automationRuleStep.create({
      data: { vendorId: live.vendor.id, ruleId: liveRule.rule.id, delayMinutes: 240, condition: { type: "always" } as Prisma.InputJsonValue, actions: [TAG_STEP] as Prisma.InputJsonArray },
    });
    await expect(dispatchPaymentPaidAutomationForOrder({ vendorId: live.vendor.id, orderId: liveOrder.orderId }, db))
      .resolves.toMatchObject({ status: "dispatched", results: [{ ruleId: liveRule.rule.id, status: "completed" }] });
    expect(await runsOf(live)).toEqual([]);
    await expect(db.automationExecutionLog.findFirstOrThrow({ where: { vendorId: live.vendor.id, ruleId: liveRule.rule.id } }))
      .resolves.toMatchObject({ status: "completed", delayedStepsPendingSubjectId: null });
    // A replay of the same payment meets the completed execution and starts nothing either.
    await expect(dispatchPaymentPaidAutomationForOrder({ vendorId: live.vendor.id, orderId: liveOrder.orderId }, db))
      .resolves.toMatchObject({ status: "dispatched", results: [{ ruleId: liveRule.rule.id, status: "duplicate" }] });
    expect(await runsOf(live)).toEqual([]);

    // The job's back-fill of an owed run: the payment ran (and owed its run) before a step was edited.
    const owed = await tenant("after-step-owed");
    const owedRule = await paymentRule(owed);
    const owedOrder = await checkout(owed);
    // This payment runs its rules inline again (missedPayment above dropped the hook).
    hooks.after = () => { throw new Error("`after` was called outside a request scope"); };
    await pay(owed, owedOrder);
    const log = await db.automationExecutionLog.findFirstOrThrow({ where: { vendorId: owed.vendor.id, ruleId: owedRule.rule.id } });
    await db.delayedStepRun.deleteMany({ where: { vendorId: owed.vendor.id } });
    await db.automationExecutionLog.update({ where: { id: log.id }, data: { delayedStepsPendingSubjectId: owedOrder.orderId, completedAt: new Date(now.getTime() - 10 * MINUTE) } });
    await db.automationRuleStep.update({ where: { id: owedRule.steps[0]!.id }, data: { delayMinutes: 90 } });
    await expect(startPendingAutomationRuns({ vendorId: owed.vendor.id })).resolves.toEqual([{ status: "not_needed" }]);
    expect(await runsOf(owed)).toEqual([]);
    await expect(db.automationExecutionLog.findUniqueOrThrow({ where: { id: log.id } })).resolves.toMatchObject({ delayedStepsPendingSubjectId: null });
  });

  it("re-review MINOR-A: a catch-up whose run waits past 2 s on a merchant save keeps the owed-run mark, and the job's back-fill creates the run", async () => {
    const t = await tenant("catchup-deferred");
    const { rule } = await paymentRule(t);
    const c = await missedPayment(t);
    const now = new Date();
    await backdate(t, c, new Date(now.getTime() - PAYMENT_PAID_CATCHUP_MIN_AGE_MS - 5 * MINUTE));
    // A save takes the rule row right after the catch-up's execution log is
    // written and holds it past the 2 s lock timeout of the run's creation
    // (it changes nothing, like a save of an unrelated field).
    const holder = boundedClient(1);
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    let held: Promise<unknown> = Promise.resolve();
    const original = db.automationExecutionLog.update.bind(db.automationExecutionLog);
    vi.spyOn(db.automationExecutionLog, "update").mockImplementationOnce((async (args: Parameters<typeof original>[0]) => {
      let locked!: () => void;
      const isLocked = new Promise<void>((resolve) => { locked = resolve; });
      held = holder.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT "id" FROM "AutomationRule" WHERE "id" = ${rule.id} AND "vendorId" = ${t.vendor.id} FOR UPDATE`;
        locked();
        await gate;
      }, { maxWait: 5_000, timeout: 15_000 }).catch(() => undefined);
      await isLocked;
      return original(args);
    }) as never);
    try {
      await expect(runPaymentPaidAutomationCatchup({ db, now })).resolves.toMatchObject({ candidates: 1, completed: 1 });
    } finally {
      release();
      await held;
    }
    const log = await db.automationExecutionLog.findFirstOrThrow({ where: { vendorId: t.vendor.id, ruleId: rule.id } });
    expect(log).toMatchObject({ status: "completed", delayedStepsPendingSubjectId: c.orderId });
    expect(await runsOf(t)).toEqual([]);
    expect(monitoring.captureOperationalError).toHaveBeenCalledWith(expect.anything(), { source: "automation_delayed_steps", operation: "start_run_deferred" }, { level: "warning" });

    const jobNow = new Date(log.completedAt!.getTime() + PENDING_RUN_START_MIN_AGE_MS + MINUTE);
    await expect(startPendingAutomationRuns({ now: jobNow, vendorId: t.vendor.id })).resolves.toEqual([{ status: "started" }]);
    await expect(onlyRun(t)).resolves.toMatchObject({ commerceOrderId: c.orderId, sourceExecutionLogId: log.id, anchorAt: log.createdAt, status: "active" });
  });

  it("the live dispatch and two catch-up passes racing on separate connections create exactly one run per order", async () => {
    const t = await tenant("race");
    const { rule } = await paymentRule(t);
    const orders = [await missedPayment(t), await missedPayment(t), await missedPayment(t)];
    const now = new Date();
    for (const c of orders) await backdate(t, c, new Date(now.getTime() - PAYMENT_PAID_CATCHUP_MIN_AGE_MS - 5 * MINUTE));
    const live = boundedClient(4);
    const job = boundedClient(3);
    const otherJob = boundedClient(3);
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error("race did not settle in 60 s")), 60_000); });
    try {
      await Promise.race([Promise.all([
        ...orders.map((c) => dispatchPaymentPaidAutomationForOrder({ vendorId: t.vendor.id, orderId: c.orderId }, live)),
        runPaymentPaidAutomationCatchup({ db: job, now }),
        runPaymentPaidAutomationCatchup({ db: otherJob, now }),
        ...orders.map((c) => dispatchPaymentPaidAutomationForOrder({ vendorId: t.vendor.id, orderId: c.orderId }, live)),
      ]), timeout]);
    } finally {
      clearTimeout(timer);
    }
    const runs = await runsOf(t);
    expect(runs.map((run) => run.commerceOrderId).sort()).toEqual(orders.map((c) => c.orderId).sort());
    for (const c of orders) {
      const logs = await db.automationExecutionLog.findMany({ where: { vendorId: t.vendor.id, eventId: `payment-paid:${c.orderId}` } });
      expect(logs.map((log) => [log.ruleId, log.status])).toEqual([[rule.id, "completed"]]);
      expect(runs.find((run) => run.commerceOrderId === c.orderId)?.sourceExecutionLogId).toBe(logs[0]!.id);
    }
  }, 90_000);
});

describe("#631 補建：訂單對象", () => {
  it("a payment whose run could not be created while a merchant save held the rule gets it from the e-mail job, anchored at the payment's execution", async () => {
    const t = await tenant("owed");
    const { rule } = await paymentRule(t);
    hooks.after = () => undefined;
    const c = await checkout(t);
    await pay(t, c);
    // The live hook never ran; now it runs while a save takes the rule row
    // right after the execution log is written and holds it past the 2 s
    // lock timeout of the run's creation.
    const holder = boundedClient(1);
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    let held: Promise<unknown> = Promise.resolve();
    const original = db.automationExecutionLog.update.bind(db.automationExecutionLog);
    vi.spyOn(db.automationExecutionLog, "update").mockImplementationOnce((async (args: Parameters<typeof original>[0]) => {
      let locked!: () => void;
      const isLocked = new Promise<void>((resolve) => { locked = resolve; });
      held = holder.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT "id" FROM "AutomationRule" WHERE "id" = ${rule.id} AND "vendorId" = ${t.vendor.id} FOR UPDATE`;
        locked();
        await gate;
      }, { maxWait: 5_000, timeout: 15_000 }).catch(() => undefined);
      await isLocked;
      return original(args);
    }) as never);
    try {
      await expect(dispatchPaymentPaidAutomationForOrder({ vendorId: t.vendor.id, orderId: c.orderId }, db)).resolves.toMatchObject({ status: "dispatched" });
    } finally {
      release();
      await held;
    }
    const log = await db.automationExecutionLog.findFirstOrThrow({ where: { vendorId: t.vendor.id, ruleId: rule.id } });
    expect(log).toMatchObject({ status: "completed", delayedStepsPendingSubjectId: c.orderId });
    expect(await runsOf(t)).toEqual([]);
    expect(monitoring.captureOperationalError).toHaveBeenCalledWith(expect.anything(), { source: "automation_delayed_steps", operation: "start_run_deferred" }, { level: "warning" });

    const jobNow = new Date(log.completedAt!.getTime() + PENDING_RUN_START_MIN_AGE_MS + MINUTE);
    await expect(startPendingAutomationRuns({ now: jobNow, vendorId: t.vendor.id })).resolves.toEqual([{ status: "started" }]);
    await expect(onlyRun(t)).resolves.toMatchObject({ commerceOrderId: c.orderId, sourceExecutionLogId: log.id, anchorAt: log.createdAt, status: "active" });
    await expect(db.automationExecutionLog.findUniqueOrThrow({ where: { id: log.id } })).resolves.toMatchObject({ delayedStepsPendingSubjectId: null });
    // A second round finds nothing more.
    await expect(startPendingAutomationRuns({ now: jobNow, vendorId: t.vendor.id })).resolves.toEqual([]);
  });

  it("clears the mark without a run when the order was fully refunded before the job took it", async () => {
    const t = await tenant("owed-refunded");
    const { rule } = await paymentRule(t);
    const c = await checkout(t);
    await pay(t, c);
    const log = await db.automationExecutionLog.findFirstOrThrow({ where: { vendorId: t.vendor.id, ruleId: rule.id } });
    // The state a deferred start leaves: the mark, no run.
    await db.delayedStepRun.deleteMany({ where: { vendorId: t.vendor.id } });
    const completedAt = new Date(Date.now() - 10 * MINUTE);
    await db.automationExecutionLog.update({ where: { id: log.id }, data: { delayedStepsPendingSubjectId: c.orderId, completedAt } });
    await processPaymentWebhook(refundCallback(t, c, "refunded", PRICE_CENTS));
    await expect(startPendingAutomationRuns({ vendorId: t.vendor.id })).resolves.toEqual([{ status: "not_needed" }]);
    expect(await runsOf(t)).toEqual([]);
    await expect(db.automationExecutionLog.findUniqueOrThrow({ where: { id: log.id } })).resolves.toMatchObject({ delayedStepsPendingSubjectId: null });
  });
});

describe("資料與刪除", () => {
  it("drops the run with its order and with the vendor", async () => {
    const t = await tenant("cascade");
    await paymentRule(t);
    const c = await checkout(t);
    await pay(t, c);
    const run = await onlyRun(t);
    expect(run.commerceOrderId).toBe(c.orderId);
    await db.vendor.delete({ where: { id: t.vendor.id } });
    vendorIds.splice(vendorIds.indexOf(t.vendor.id), 1);
    await expect(db.delayedStepRun.count({ where: { id: run.id } })).resolves.toBe(0);
  });

  it("review MINOR-2: a deployment that cannot decrypt at all gives the lease back without using an attempt and runs nothing", async () => {
    const t = await tenant("no-key");
    const { steps } = await paymentRule(t, { steps: [{ delayMinutes: 60, actions: [TAG_STEP] }] });
    const c = await checkout(t);
    await pay(t, c);
    const run = await onlyRun(t);
    monitoring.captureOperationalError.mockClear();
    const untouched = { status: "active", claimedAt: null, attemptCount: 0, cursorDelayMinutes: -1 };
    // The payment's immediate dispatch read the envelope already; count from here.
    hooks.revealCalls = 0;
    // Key missing when the round starts: the worker's own deployment probe claims nothing.
    vi.stubEnv("CSRF_SECRET", "");
    await work(t, due(run, 60));
    expect(hooks.revealCalls).toBe(0);
    await expect(db.delayedStepRun.findUniqueOrThrow({ where: { id: run.id } })).resolves.toMatchObject(untouched);
    // Key gone after the round's probe, right before this order's envelope is read.
    vi.stubEnv("CSRF_SECRET", "payment-paid-delayed-steps-secret-longer-than-32-bytes");
    hooks.beforeReveal = () => {
      hooks.beforeReveal = null;
      vi.stubEnv("CSRF_SECRET", "");
    };
    await work(t, due(run, 60));
    // The order's envelope was really tried; the run was claimed and given back without using an attempt.
    expect(hooks.revealCalls).toBe(1);
    await expect(db.delayedStepRun.findUniqueOrThrow({ where: { id: run.id } })).resolves.toMatchObject(untouched);
    await expect(stepLog(t, run.id, steps[0]!.id)).resolves.toBeNull();
    await expect(db.customerTagAssignment.count({ where: { vendorId: t.vendor.id, tag: TAG_STEP.tag } })).resolves.toBe(0);
    // Not recorded as this buyer's unreadable e-mail.
    expect(monitoring.captureOperationalError).not.toHaveBeenCalledWith(expect.anything(), { source: "automation_delayed_steps", operation: "buyer_email" });
    // Key back: the step runs.
    vi.stubEnv("CSRF_SECRET", "payment-paid-delayed-steps-secret-longer-than-32-bytes");
    await work(t, due(run, 60));
    await expect(stepLog(t, run.id, steps[0]!.id)).resolves.toMatchObject({ status: "completed" });
    await expect(db.customerTagAssignment.count({ where: { vendorId: t.vendor.id, tag: TAG_STEP.tag } })).resolves.toBe(1);
  });

  it("re-review MINOR-B: an envelope under a key id the keyring does not list is retried, never recorded as recipient_not_linked", async () => {
    const t = await tenant("unknown-kid");
    const { steps } = await paymentRule(t);
    const c = await checkout(t);
    await verifiedRegistration(t, c.buyerEmail);
    await pay(t, c);
    const run = await onlyRun(t);
    // A well-formed v2 envelope whose key id ("retired-key") is not in the running keyring.
    await db.commerceOrder.update({
      where: { id: c.orderId },
      data: { buyerEncryptedEnvelope: `v2.retired-key.${"A".repeat(16)}.${"B".repeat(22)}.${"C".repeat(40)}` },
    });
    monitoring.captureOperationalError.mockClear();
    const firstRound = due(run, 60);
    await work(t, firstRound);
    // Not settled: the lease stays and counts one attempt; nothing ran and nothing was recorded for the buyer.
    const afterFirst = await db.delayedStepRun.findUniqueOrThrow({ where: { id: run.id } });
    expect(afterFirst).toMatchObject({ status: "active", attemptCount: 1, cursorDelayMinutes: -1 });
    expect(afterFirst.claimedAt).not.toBeNull();
    await expect(stepLog(t, run.id, steps[0]!.id)).resolves.toBeNull();
    await expect(db.customerTagAssignment.count({ where: { vendorId: t.vendor.id, tag: TAG_STEP.tag } })).resolves.toBe(0);
    expect(monitoring.captureOperationalError).not.toHaveBeenCalledWith(expect.anything(), { source: "automation_delayed_steps", operation: "buyer_email" });
    // Claimed again once the lease expired: another attempt, still nothing recorded.
    await work(t, new Date(firstRound.getTime() + DELAYED_STEP_LEASE_MS + MINUTE));
    await expect(db.delayedStepRun.findUniqueOrThrow({ where: { id: run.id } })).resolves.toMatchObject({ status: "active", attemptCount: 2, cursorDelayMinutes: -1 });
    await expect(stepLog(t, run.id, steps[0]!.id)).resolves.toBeNull();
  });

  it("runs the other actions when the buyer e-mail cannot be read, and reports it with safe keys only", async () => {
    const t = await tenant("monitoring");
    const { steps } = await paymentRule(t);
    const c = await checkout(t);
    await verifiedRegistration(t, c.buyerEmail);
    await pay(t, c);
    const run = await onlyRun(t);
    monitoring.captureOperationalError.mockClear();
    hooks.revealFails = true;
    await work(t, due(run, 60));
    const results = stepResults(await stepLog(t, run.id, steps[0]!.id));
    expect(results.find((result) => result.type === "send_email_notification")).toMatchObject({ status: "recipient_not_linked" });
    expect(results.find((result) => result.type === "add_customer_tag")).toMatchObject({ status: "tagged" });
    expect(await stepMails(t)).toEqual([]);
    expect(monitoring.captureOperationalError).toHaveBeenCalledWith(expect.anything(), { source: "automation_delayed_steps", operation: "buyer_email" });
    for (const [, context] of monitoring.captureOperationalError.mock.calls) {
      expect(JSON.stringify(context)).not.toContain(c.orderId);
      expect(JSON.stringify(context)).not.toContain(t.vendor.id);
    }
  });
});
