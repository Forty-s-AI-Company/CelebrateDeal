import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The database URL with an explicit pool size: the race below needs a known
 * number of connections per client, never the environment's default pool.
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

// F-3 PR 2「買了就停」on the disposable PostgreSQL database. The checkout,
// payment callbacks (paid and refunds), orders, the sequence worker, the
// e-mail queue and the send-time guard are all real. Synthetic: the e-mail
// provider (a mock that records calls) and monitoring. No provider is called.
const mocks = vi.hoisted(() => ({ sendTransactionalEmail: vi.fn() }));
vi.mock("@/lib/email", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/email")>(),
  sendTransactionalEmail: mocks.sendTransactionalEmail,
}));
vi.mock("@/lib/monitoring", async (original) => ({
  ...await original<typeof import("@/lib/monitoring")>(),
  captureOperationalError: vi.fn(),
}));

import { PrismaClient } from "@prisma/client";
import { createCommerceOrderForCheckout } from "@/lib/commerce-orders";
import { getDb } from "@/lib/db";
import {
  enrollSubmissionInEmailSequences,
  isCurrentSequenceEmailDelivery,
  isSequenceEmailStoppedByPurchase,
  processDueDelayedStepRuns,
  SEQUENCE_PURCHASED_SUPERSEDED_CODE,
} from "@/lib/delayed-step-runs";
import { dispatchEmailDelivery, isCurrentEmailDeliverySnapshot } from "@/lib/email-delivery";
import { emailSequenceRunCounts, saveEmailSequence } from "@/lib/email-sequences";
import { createReservedPaymentTransaction } from "@/lib/inventory-reservations";
import { PaymentWebhookPayload, processPaymentWebhook } from "@/lib/payment-webhooks";

const db = getDb();
const vendorIds: string[] = [];
const PRICE_CENTS = 1_500;
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
/** Checkout, payment callbacks and the worker each take a few round trips; the first test also opens the pool. */
const DB_TEST_TIMEOUT_MS = 30_000;

beforeEach(() => {
  vi.stubEnv("CSRF_SECRET", "sequence-stop-on-purchase-secret-longer-than-32-bytes");
  vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://stop-on-purchase.example.test");
  // Synthetic provider settings for the worker's check; the provider itself is the mock above.
  vi.stubEnv("RESEND_API_KEY", "re_synthetic_stop_on_purchase");
  vi.stubEnv("EMAIL_FROM", "CelebrateDeal <no-reply@example.test>");
  mocks.sendTransactionalEmail.mockReset();
  mocks.sendTransactionalEmail.mockImplementation(async (input: { idempotencyKey?: string }) => ({ id: `provider-${input.idempotencyKey ?? "x"}` }));
});

afterEach(async () => {
  vi.unstubAllEnvs();
  await db.auditLog.deleteMany({ where: { vendorId: { in: vendorIds } } });
  await db.vendor.deleteMany({ where: { id: { in: vendorIds.splice(0) } } });
});

afterAll(async () => {
  await clients.app?.$disconnect();
});

/**
 * Times are relative to the real clock: the payment callback stamps `paidAt`
 * with its own time unless the payload says otherwise, and the send-time
 * guard ages e-mails by the real clock.
 */
function timeline() {
  const now = new Date();
  const registeredAt = new Date(now.getTime() - 3 * HOUR - 5 * MINUTE);
  const verifiedAt = new Date(now.getTime() - 3 * HOUR);
  return { now, registeredAt, verifiedAt };
}

async function tenant(label: string, options: { grant?: boolean } = {}) {
  const key = randomUUID().slice(0, 12);
  const vendor = await db.vendor.create({
    data: {
      name: `買了就停 ${label} ${key}`,
      slug: `stop-on-purchase-${key}`,
      email: `vendor-${key}@example.test`,
      passwordHash: "synthetic-only",
      betaFeatureGrants: options.grant === false ? [] : ["email_sequences"],
    },
  });
  vendorIds.push(vendor.id);
  const product = await db.product.create({
    data: { vendorId: vendor.id, name: "任一商品", slug: `stop-product-${key}`, priceCents: PRICE_CENTS, currency: "TWD", inventory: 100, isActive: true, fulfillmentTypeConfirmed: true },
  });
  const form = await db.registrationForm.create({
    data: { vendorId: vendor.id, name: "報名表", slug: `stop-form-${key}`, headline: "報名", fields: [{ key: "email", label: "Email", type: "email", required: true }] },
  });
  const live = await db.live.create({
    data: { vendorId: vendor.id, formId: form.id, title: `追銷直播 ${key}`, slug: `stop-live-${key}`, scheduledAt: new Date(Date.now() + 7 * DAY), status: "scheduled" },
  });
  const template = await db.messageTemplate.create({
    data: { vendorId: vendor.id, name: "序列信", trigger: "sequence_email", subject: "{{live_title}} 的下一步", body: "{{name}} 你好" },
  });
  return { vendor, product, form, live, template };
}
type Tenant = Awaited<ReturnType<typeof tenant>>;

/** An active sequence with steps 1 h, 2 h and 1 day after verification. */
async function sequence(t: Tenant, options: { stopOnPurchase?: boolean; delays?: number[] } = {}) {
  const created = await db.emailSequence.create({
    data: {
      vendorId: t.vendor.id,
      liveId: t.live.id,
      name: "報名後追銷",
      status: "active",
      activatedAt: new Date(Date.now() - 10 * DAY),
      ...(options.stopOnPurchase === undefined ? {} : { stopOnPurchase: options.stopOnPurchase }),
    },
  });
  for (const delayMinutes of options.delays ?? [60, 120, 1_440]) {
    await db.emailSequenceStep.create({ data: { vendorId: t.vendor.id, emailSequenceId: created.id, delayMinutes, messageTemplateId: t.template.id } });
  }
  return created;
}

/** A verified registration, already in the Live's sequences. */
async function registrant(t: Tenant, email: string, times: ReturnType<typeof timeline>) {
  const submission = await db.formSubmission.create({
    data: {
      formId: t.form.id,
      liveId: t.live.id,
      name: "陳合成",
      email,
      verificationStatus: "VERIFIED",
      verifiedAt: times.verifiedAt,
      createdAt: times.registeredAt,
    },
  });
  await expect(enrollSubmissionInEmailSequences({ vendorId: t.vendor.id, liveId: t.live.id, formSubmissionId: submission.id, now: times.now }))
    .resolves.toMatchObject({ status: "enrolled" });
  return submission;
}

/** The checkout route's reservation: server price, pending transaction and canonical order. */
async function checkout(t: Tenant, buyerEmail: string) {
  const orderNumber = `STOP-${randomUUID()}`;
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
  return { orderNumber, orderId: order.id };
}
type Checkout = Awaited<ReturnType<typeof checkout>>;

function paid(t: Tenant, c: Checkout, occurredAt?: Date) {
  return processPaymentWebhook(PaymentWebhookPayload.parse({
    provider: "payuni", eventId: `stop-paid-${randomUUID()}`, eventType: "paid", vendorId: t.vendor.id, orderNumber: c.orderNumber,
    grossAmountCents: PRICE_CENTS, currency: "TWD", ...(occurredAt ? { occurredAt: occurredAt.toISOString() } : {}),
  }));
}

function refunded(t: Tenant, c: Checkout) {
  return processPaymentWebhook(PaymentWebhookPayload.parse({
    provider: "payuni", eventId: `stop-refund-${randomUUID()}`, eventType: "refunded", vendorId: t.vendor.id, orderNumber: c.orderNumber,
    refundAmountCents: PRICE_CENTS, currency: "TWD",
  }));
}

/** Buys any product of this vendor through checkout and the paid callback. */
async function buy(t: Tenant, buyerEmail: string, occurredAt?: Date) {
  const c = await checkout(t, buyerEmail);
  await paid(t, c, occurredAt);
  await expect(db.commerceOrder.findUniqueOrThrow({ where: { id: c.orderId } })).resolves.toMatchObject({ status: "paid" });
  return c;
}

function work(t: Tenant, now: Date, database: PrismaClient = db) {
  return processDueDelayedStepRuns({ now, vendorId: t.vendor.id }, database);
}

function runOf(t: Tenant, formSubmissionId: string) {
  return db.delayedStepRun.findFirstOrThrow({ where: { vendorId: t.vendor.id, formSubmissionId } });
}

function sequenceMails(t: Tenant) {
  return db.emailDelivery.findMany({ where: { vendorId: t.vendor.id, trigger: "sequence_email" }, orderBy: { createdAt: "asc" } });
}

/** Dispatches every queued sequence e-mail of this vendor through the real dispatcher. */
async function dispatchQueued(t: Tenant) {
  const queued = await db.emailDelivery.findMany({ where: { vendorId: t.vendor.id, trigger: "sequence_email", status: "queued" }, select: { id: true } });
  return Promise.all(queued.map((delivery) => dispatchEmailDelivery(delivery.id)));
}

/** Sequence e-mails that reached the (mock) provider. */
function sentSequenceMails() {
  return mocks.sendTransactionalEmail.mock.calls
    .map((call) => call[0] as { to: string; idempotencyKey?: string })
    .filter((input) => input.idempotencyKey?.startsWith("sequence-email/"));
}

describe("買了就停：步驟到點時", { timeout: DB_TEST_TIMEOUT_MS }, () => {
  it("stops the remaining steps once the registrant buys any product after registering, and shows it in the counts", async () => {
    const times = timeline();
    const t = await tenant("A");
    const seq = await sequence(t);
    const lead = await registrant(t, "Buyer.One@Example.test", times);

    // Step 1 (1 h) is queued and sent before any purchase.
    await expect(work(t, times.now)).resolves.toEqual([expect.objectContaining({ status: "queued" })]);
    await expect(dispatchQueued(t)).resolves.toEqual([{ status: "sent" }]);
    expect(sentSequenceMails()).toHaveLength(1);

    // The buyer address differs in case and spacing: the customer key normalizes it.
    await buy(t, "  buyer.one@example.TEST ");
    await expect(work(t, times.now)).resolves.toEqual([{ runId: expect.any(String), status: "cancelled", cancelReason: "purchased" }]);
    await expect(runOf(t, lead.id)).resolves.toMatchObject({ status: "cancelled", cancelReason: "purchased", nextRunAt: null, claimedAt: null });
    // Later rounds (step 2 and step 3 times) send nothing more.
    await expect(work(t, new Date(times.now.getTime() + DAY))).resolves.toEqual([]);
    expect(await sequenceMails(t)).toHaveLength(1);
    expect(sentSequenceMails()).toHaveLength(1);

    const counts = await emailSequenceRunCounts(t.vendor.id);
    expect(counts.get(seq.id)).toEqual({ active: 0, completed: 0, cancelled: 1, purchased: 1 });
  });

  it("derives the customer key from the registration when a run has none stored", async () => {
    const times = timeline();
    const t = await tenant("no-key");
    await sequence(t);
    const lead = await registrant(t, `no-key-${randomUUID().slice(0, 8)}@example.test`, times);
    await db.delayedStepRun.updateMany({ where: { vendorId: t.vendor.id, formSubmissionId: lead.id }, data: { subjectKeyHash: null } });
    await expect(work(t, times.now)).resolves.toEqual([expect.objectContaining({ status: "queued" })]);
    const [mail] = await sequenceMails(t);
    await buy(t, lead.email);
    await expect(isSequenceEmailStoppedByPurchase(mail!, db)).resolves.toBe(true);
    await expect(work(t, times.now)).resolves.toEqual([expect.objectContaining({ status: "cancelled", cancelReason: "purchased" })]);
  });

  it("keeps sending when the sequence has 「買了就停」switched off", async () => {
    const times = timeline();
    const t = await tenant("off");
    await sequence(t, { stopOnPurchase: false });
    const lead = await registrant(t, `keep-${randomUUID().slice(0, 8)}@example.test`, times);
    await buy(t, lead.email);

    await expect(work(t, times.now)).resolves.toEqual([expect.objectContaining({ status: "queued" })]);
    await expect(dispatchQueued(t)).resolves.toEqual([{ status: "sent" }]);
    await expect(work(t, times.now)).resolves.toEqual([expect.objectContaining({ status: "queued" })]);
    await expect(dispatchQueued(t)).resolves.toEqual([{ status: "sent" }]);
    expect(sentSequenceMails()).toHaveLength(2);
    await expect(runOf(t, lead.id)).resolves.toMatchObject({ status: "active", cancelReason: null });
  });

  it("ignores another vendor's order for the same address (tenant boundary)", async () => {
    const times = timeline();
    const a = await tenant("A");
    const b = await tenant("B");
    const seqA = await sequence(a);
    const email = `shared-${randomUUID().slice(0, 8)}@example.test`;
    const lead = await registrant(a, email, times);
    // Same address, paid at vendor B after the registration at A.
    await buy(b, email);

    await expect(work(a, times.now)).resolves.toEqual([expect.objectContaining({ status: "queued" })]);
    await expect(dispatchQueued(a)).resolves.toEqual([{ status: "sent" }]);
    await expect(runOf(a, lead.id)).resolves.toMatchObject({ status: "active" });
    expect((await emailSequenceRunCounts(a.vendor.id)).get(seqA.id)).toMatchObject({ purchased: 0, active: 1 });
  });

  it("does not count a test order", async () => {
    const times = timeline();
    const t = await tenant("test-order");
    await sequence(t);
    const lead = await registrant(t, `tester-${randomUUID().slice(0, 8)}@example.test`, times);
    const c = await buy(t, lead.email);
    await db.commerceOrder.update({ where: { id: c.orderId }, data: { isTestOrder: true } });

    await expect(work(t, times.now)).resolves.toEqual([expect.objectContaining({ status: "queued" })]);
    await expect(dispatchQueued(t)).resolves.toEqual([{ status: "sent" }]);
    await expect(runOf(t, lead.id)).resolves.toMatchObject({ status: "active" });
  });

  it("does not count an order paid before the registration, nor an unpaid or failed one", async () => {
    const times = timeline();
    const t = await tenant("earlier");
    await sequence(t);
    const email = `returning-${randomUUID().slice(0, 8)}@example.test`;
    // Paid one minute before this registration was created.
    await buy(t, email, new Date(times.registeredAt.getTime() - MINUTE));
    // Checked out after registering but never paid.
    await checkout(t, email);
    const failed = await checkout(t, email);
    await processPaymentWebhook(PaymentWebhookPayload.parse({
      provider: "payuni", eventId: `stop-failed-${randomUUID()}`, eventType: "failed", vendorId: t.vendor.id, orderNumber: failed.orderNumber,
      grossAmountCents: PRICE_CENTS, currency: "TWD",
    }));
    const lead = await registrant(t, email, times);

    await expect(work(t, times.now)).resolves.toEqual([expect.objectContaining({ status: "queued" })]);
    await expect(dispatchQueued(t)).resolves.toEqual([{ status: "sent" }]);
    await expect(runOf(t, lead.id)).resolves.toMatchObject({ status: "active" });
  });

  it("stops for a purchase paid after registering but before the e-mail was verified (review MINOR-1)", async () => {
    const times = timeline();
    const t = await tenant("before-verify");
    await sequence(t);
    const lead = await registrant(t, `before-verify-${randomUUID().slice(0, 8)}@example.test`, times);
    // Paid between the registration (createdAt) and the verification (the run's anchorAt).
    const paidAt = new Date(times.registeredAt.getTime() + 2 * MINUTE);
    expect(paidAt < times.verifiedAt).toBe(true);
    const c = await buy(t, lead.email, paidAt);
    await expect(db.commerceOrder.findUniqueOrThrow({ where: { id: c.orderId } })).resolves.toMatchObject({ paidAt });

    await expect(work(t, times.now)).resolves.toEqual([expect.objectContaining({ status: "cancelled", cancelReason: "purchased" })]);
    expect(await sequenceMails(t)).toHaveLength(0);
  });

  it("counts an order paid at exactly the registration's creation time, not one a millisecond earlier (review MINOR-1)", async () => {
    const times = timeline();
    const atBoundary = await tenant("boundary");
    await sequence(atBoundary);
    const email = `boundary-${randomUUID().slice(0, 8)}@example.test`;
    const lead = await registrant(atBoundary, email, times);
    const c = await buy(atBoundary, email, times.registeredAt);
    await expect(db.commerceOrder.findUniqueOrThrow({ where: { id: c.orderId } })).resolves.toMatchObject({ paidAt: times.registeredAt });
    await expect(work(atBoundary, times.now)).resolves.toEqual([expect.objectContaining({ status: "cancelled", cancelReason: "purchased" })]);
    await expect(runOf(atBoundary, lead.id)).resolves.toMatchObject({ cancelReason: "purchased" });

    const justBefore = await tenant("just-before");
    await sequence(justBefore);
    const earlier = await registrant(justBefore, email, times);
    await buy(justBefore, email, new Date(times.registeredAt.getTime() - 1));
    await expect(work(justBefore, times.now)).resolves.toEqual([expect.objectContaining({ status: "queued" })]);
    await expect(runOf(justBefore, earlier.id)).resolves.toMatchObject({ status: "active" });
  });

  it("counts a partially refunded order as a purchase (review MINOR-1)", async () => {
    const times = timeline();
    const t = await tenant("partial");
    await sequence(t);
    const lead = await registrant(t, `partial-${randomUUID().slice(0, 8)}@example.test`, times);
    const c = await buy(t, lead.email);
    await processPaymentWebhook(PaymentWebhookPayload.parse({
      provider: "payuni", eventId: `stop-partial-${randomUUID()}`, eventType: "partially_refunded", vendorId: t.vendor.id, orderNumber: c.orderNumber,
      refundAmountCents: 500, currency: "TWD",
    }));
    await expect(db.commerceOrder.findUniqueOrThrow({ where: { id: c.orderId } })).resolves.toMatchObject({ status: "partially_refunded", refundedAmountCents: 500 });

    await expect(work(t, times.now)).resolves.toEqual([expect.objectContaining({ status: "cancelled", cancelReason: "purchased" })]);
    expect(await sequenceMails(t)).toHaveLength(0);
  });

  it("follows the merchant's saved setting: switched off, a buyer keeps receiving; a save without it keeps it", async () => {
    const times = timeline();
    const t = await tenant("toggle");
    const seq = await sequence(t);
    const lead = await registrant(t, `toggle-${randomUUID().slice(0, 8)}@example.test`, times);
    await buy(t, lead.email);

    // Switched off (and the version bumped) through the merchant save.
    const saved = await saveEmailSequence({
      vendorId: t.vendor.id,
      sequenceId: seq.id,
      expectedVersion: seq.version,
      data: {
        name: seq.name,
        liveId: t.live.id,
        stopOnPurchase: false,
        steps: (await db.emailSequenceStep.findMany({ where: { emailSequenceId: seq.id }, orderBy: { delayMinutes: "asc" } }))
          .map((step) => ({ id: step.id, delayMinutes: step.delayMinutes, messageTemplateId: step.messageTemplateId, isActive: true })),
      },
      now: times.now,
    });
    expect(saved).toMatchObject({ ok: true, version: seq.version + 1 });
    await expect(db.emailSequence.findUniqueOrThrow({ where: { id: seq.id } })).resolves.toMatchObject({ stopOnPurchase: false });
    await expect(work(t, times.now)).resolves.toEqual([expect.objectContaining({ status: "queued" })]);
    await expect(runOf(t, lead.id)).resolves.toMatchObject({ status: "active" });

    // A save without the setting keeps it as it is.
    const kept = await saveEmailSequence({
      vendorId: t.vendor.id,
      sequenceId: seq.id,
      expectedVersion: seq.version + 1,
      data: { name: "改名", liveId: t.live.id, steps: [{ id: null, delayMinutes: 60, messageTemplateId: t.template.id, isActive: true }] },
      now: times.now,
    });
    expect(kept).toMatchObject({ ok: true });
    await expect(db.emailSequence.findUniqueOrThrow({ where: { id: seq.id } })).resolves.toMatchObject({ stopOnPurchase: false, name: "改名" });
  });
});

describe("買了就停：已排入待寄的信", { timeout: DB_TEST_TIMEOUT_MS }, () => {
  it("supersedes a queued step e-mail at send time when the recipient bought after it was queued", async () => {
    const times = timeline();
    const t = await tenant("queued");
    await sequence(t);
    const lead = await registrant(t, `queued-${randomUUID().slice(0, 8)}@example.test`, times);
    await expect(work(t, times.now)).resolves.toEqual([expect.objectContaining({ status: "queued" })]);
    const [mail] = await sequenceMails(t);
    await expect(isCurrentEmailDeliverySnapshot(mail!)).resolves.toBe(true);

    await buy(t, lead.email);
    // The merchant retry path and the dispatcher apply the same rule.
    await expect(isCurrentEmailDeliverySnapshot(mail!)).resolves.toBe(false);
    await expect(isSequenceEmailStoppedByPurchase(mail!, db)).resolves.toBe(true);
    await expect(dispatchEmailDelivery(mail!.id)).resolves.toEqual({ status: "superseded" });
    await expect(db.emailDelivery.findUniqueOrThrow({ where: { id: mail!.id } })).resolves.toMatchObject({ status: "superseded", lastErrorCode: SEQUENCE_PURCHASED_SUPERSEDED_CODE });
    expect(sentSequenceMails()).toHaveLength(0);

    // The next round no longer waits for that e-mail: it stops the run.
    await expect(work(t, times.now)).resolves.toEqual([expect.objectContaining({ status: "cancelled", cancelReason: "purchased" })]);
    await expect(runOf(t, lead.id)).resolves.toMatchObject({ status: "cancelled", cancelReason: "purchased" });
  });

  it("also holds back the last step's e-mail, whose run is already completed", async () => {
    const times = timeline();
    const t = await tenant("last");
    await sequence(t, { delays: [60] });
    const lead = await registrant(t, `last-${randomUUID().slice(0, 8)}@example.test`, times);
    await expect(work(t, times.now)).resolves.toEqual([expect.objectContaining({ status: "queued" })]);
    await expect(runOf(t, lead.id)).resolves.toMatchObject({ status: "completed" });
    await buy(t, lead.email);

    const [mail] = await sequenceMails(t);
    await expect(dispatchEmailDelivery(mail!.id)).resolves.toEqual({ status: "superseded" });
    await expect(db.emailDelivery.findUniqueOrThrow({ where: { id: mail!.id } })).resolves.toMatchObject({ lastErrorCode: SEQUENCE_PURCHASED_SUPERSEDED_CODE });
    expect(sentSequenceMails()).toHaveLength(0);
    // A completed run stays completed; nothing is re-sent.
    await expect(runOf(t, lead.id)).resolves.toMatchObject({ status: "completed" });
  });

  it("sends a queued e-mail when the sequence does not stop on purchase, or the purchase was at another vendor", async () => {
    const times = timeline();
    const t = await tenant("send");
    const other = await tenant("other");
    await sequence(t, { stopOnPurchase: false });
    const lead = await registrant(t, `send-${randomUUID().slice(0, 8)}@example.test`, times);
    await expect(work(t, times.now)).resolves.toEqual([expect.objectContaining({ status: "queued" })]);
    await buy(t, lead.email);
    await buy(other, lead.email);
    const [mail] = await sequenceMails(t);
    await expect(isCurrentSequenceEmailDelivery(mail!, new Date(), db)).resolves.toBe(true);
    await expect(isSequenceEmailStoppedByPurchase(mail!, db)).resolves.toBe(false);
    await expect(dispatchEmailDelivery(mail!.id)).resolves.toEqual({ status: "sent" });
    expect(sentSequenceMails()).toEqual([expect.objectContaining({ to: lead.email })]);
  });

  it("does not count as bought when there is no customer key to compare (review NIT-1)", async () => {
    const times = timeline();
    const t = await tenant("no-key-send");
    await sequence(t);
    const lead = await registrant(t, `no-key-send-${randomUUID().slice(0, 8)}@example.test`, times);
    await expect(work(t, times.now)).resolves.toEqual([expect.objectContaining({ status: "queued" })]);
    const [mail] = await sequenceMails(t);
    await buy(t, lead.email);
    await expect(isSequenceEmailStoppedByPurchase(mail!, db)).resolves.toBe(true);

    // No stored key, and the registration's address yields none: nothing to
    // compare, so the purchase rule does not apply (an error is not a purchase).
    await db.delayedStepRun.updateMany({ where: { vendorId: t.vendor.id, formSubmissionId: lead.id }, data: { subjectKeyHash: null } });
    await db.formSubmission.update({ where: { id: lead.id }, data: { email: "not-an-address" } });
    await expect(isSequenceEmailStoppedByPurchase(mail!, db)).resolves.toBe(false);
  });

  it("never reads another vendor's run from a forged delivery", async () => {
    const times = timeline();
    const a = await tenant("A");
    const b = await tenant("B");
    await sequence(a);
    const lead = await registrant(a, `forged-${randomUUID().slice(0, 8)}@example.test`, times);
    await expect(work(a, times.now)).resolves.toEqual([expect.objectContaining({ status: "queued" })]);
    const [mail] = await sequenceMails(a);
    await buy(a, lead.email);
    // The same key and registration under vendor B find no run: no answer leaks across.
    await expect(isSequenceEmailStoppedByPurchase({ ...mail!, vendorId: b.vendor.id }, db)).resolves.toBe(false);
    await expect(isSequenceEmailStoppedByPurchase(mail!, db)).resolves.toBe(true);
  });
});

describe("買了就停：退款", { timeout: DB_TEST_TIMEOUT_MS }, () => {
  it("does not resume a run stopped for a purchase after a full refund", async () => {
    const times = timeline();
    const t = await tenant("refund-after");
    await sequence(t);
    const lead = await registrant(t, `refund-${randomUUID().slice(0, 8)}@example.test`, times);
    const c = await buy(t, lead.email);
    await expect(work(t, times.now)).resolves.toEqual([expect.objectContaining({ cancelReason: "purchased" })]);

    await refunded(t, c);
    await expect(db.commerceOrder.findUniqueOrThrow({ where: { id: c.orderId } })).resolves.toMatchObject({ status: "refunded" });
    await expect(work(t, new Date(times.now.getTime() + DAY))).resolves.toEqual([]);
    await expect(runOf(t, lead.id)).resolves.toMatchObject({ status: "cancelled", cancelReason: "purchased" });
    expect(await sequenceMails(t)).toHaveLength(0);
  });

  it("still stops when the order was already refunded before the next step came due", async () => {
    const times = timeline();
    const t = await tenant("refund-before");
    await sequence(t);
    const lead = await registrant(t, `refund-early-${randomUUID().slice(0, 8)}@example.test`, times);
    const c = await buy(t, lead.email);
    await refunded(t, c);
    await expect(db.commerceOrder.findUniqueOrThrow({ where: { id: c.orderId } })).resolves.toMatchObject({ status: "refunded", paidAt: expect.any(Date) });

    await expect(work(t, times.now)).resolves.toEqual([expect.objectContaining({ status: "cancelled", cancelReason: "purchased" })]);
    expect(await sequenceMails(t)).toHaveLength(0);
  });
});

describe("買了就停：併發", () => {
  const workerClients: PrismaClient[] = [];
  afterAll(async () => {
    await Promise.all(workerClients.map((client) => client.$disconnect()));
  });

  it("never sends a step e-mail after the purchase committed, whichever of the worker and the payment goes first", async () => {
    // The worker runs on its own pool, as the job does in its own function instance.
    const worker = new PrismaClient({ datasourceUrl: pooledUrl(3) });
    workerClients.push(worker);
    for (let round = 0; round < 6; round += 1) {
      const times = timeline();
      const t = await tenant(`race-${round}`);
      await sequence(t);
      const lead = await registrant(t, `race-${round}-${randomUUID().slice(0, 8)}@example.test`, times);
      const c = await checkout(t, lead.email);
      mocks.sendTransactionalEmail.mockClear();

      // Alternate which side starts first; both are in flight together.
      const runs = round % 2 === 0
        ? await Promise.all([work(t, times.now, worker), paid(t, c)]).then(([results]) => results)
        : await Promise.all([paid(t, c), work(t, times.now, worker)]).then(([, results]) => results);
      expect(runs).toHaveLength(1);
      expect(["queued", "cancelled"]).toContain(runs[0]!.status);
      await expect(db.commerceOrder.findUniqueOrThrow({ where: { id: c.orderId } })).resolves.toMatchObject({ status: "paid" });

      // Every e-mail the race may have queued is dispatched after the payment committed.
      const dispatched = await dispatchQueued(t);
      expect(dispatched.every((result) => result.status === "superseded")).toBe(true);
      expect(sentSequenceMails()).toHaveLength(0);
      // The following round stops the run for good.
      await work(t, times.now);
      await expect(runOf(t, lead.id)).resolves.toMatchObject({ status: "cancelled", cancelReason: "purchased" });
      expect((await sequenceMails(t)).every((mail) => mail.status === "superseded")).toBe(true);
    }
  }, 120_000);
});
