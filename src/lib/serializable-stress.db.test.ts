import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";
import { performance } from "node:perf_hooks";
import { Prisma } from "@prisma/client";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createCommerceOrderForCheckout } from "@/lib/commerce-orders";
import { getDb } from "@/lib/db";
import {
  CHECKOUT_RESERVATION_RETRY,
  createReservedPaymentTransaction,
  InventoryUnavailableError,
  ProductChangedError,
  type ReservedInventoryRevision,
} from "@/lib/inventory-reservations";
import { createInteractionBearer, hashInteractionBearer } from "@/lib/live-interaction";
import { consumeFlashSaleQuote, FlashSaleUnavailableError, resolveFlashSaleQuote } from "@/lib/live-flash-sale";
import { ensureLiveNotificationDelivery } from "@/lib/live-notification-delivery";
import { PaymentWebhookPayload, processPaymentWebhook } from "@/lib/payment-webhooks";
import { POST as paymentWebhookRoute } from "@/app/api/webhooks/payments/route";
import { isTransientTransactionConflict } from "@/lib/serializable-retry";

/**
 * F-055: concurrent callers on the most contended Serializable paths.
 *
 * The normal DB suite runs this file with 10 callers per path. The opt-in
 * stress run (`npm run test:db:stress`, vitest.serializable-stress-db.config.ts)
 * sets SERIALIZABLE_STRESS_CONCURRENCY=50 and a pool large enough for every
 * caller to hold its own connection. Both only ever reach the loopback
 * `celebratedeal_*` database that the Vitest config already asserts.
 */

// Isolate outbound email and fiscal side effects; payment, order, stock and
// notification rows stay real.
vi.mock("@/lib/commerce-order-email", () => ({ ensureCommerceOrderPaidDelivery: vi.fn() }));
vi.mock("@/lib/taiwan-electronic-invoice", () => ({ reconcileElectronicInvoiceAfterPayment: vi.fn() }));

const CONCURRENCY = (() => {
  const raw = process.env.SERIALIZABLE_STRESS_CONCURRENCY;
  if (raw === undefined || raw === "") return 10;
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < 2 || value > 200) {
    throw new Error("[serializable_stress] SERIALIZABLE_STRESS_CONCURRENCY must be an integer between 2 and 200.");
  }
  return value;
})();
const STRESS = CONCURRENCY > 10;
const TEST_TIMEOUT_MS = STRESS ? 180_000 : 60_000;
/** A buyer whose admission went stale reloads checkout; bounded so a livelock fails the test. */
const MAX_BUYER_RELOADS = CONCURRENCY * 4;

// Retry policies of the code under test (kept in sync with the callers): how
// many transactions one retry loop opens and which aborts it re-runs.
type RetryPolicy = { attempts: number; retried: ReadonlySet<TransactionOutcome> };
const CHECKOUT_RETRY: RetryPolicy = { attempts: CHECKOUT_RESERVATION_RETRY.attempts, retried: new Set(["transient"]) }; // inventory-reservations.ts
const WEBHOOK_RETRY: RetryPolicy = { attempts: 3, retried: new Set(["transient", "unique"]) }; // payment-webhooks.ts
const NOTIFICATION_RETRY: RetryPolicy = { attempts: 3, retried: new Set(["transient"]) }; // live-notification-delivery.ts TRANSIENT_RETRY

const buyer = { name: "Synthetic buyer", email: "buyer@example.test", phone: "0912345678" };
const shipping = { recipientName: "Synthetic buyer", phone: "0912345678", countryCode: "TW", postalCode: "100", administrativeArea: "台北市", locality: "中正區", addressLine1: "合成測試路 1 號" };

// ---------------------------------------------------------------------------
// Measurement: every Serializable interactive transaction opened by a caller
// is recorded against that caller through AsyncLocalStorage.

type TransactionOutcome = "committed" | "transient" | "unique" | "other";
type CallerTrace = { outcomes: TransactionOutcome[] };
const callerTrace = new AsyncLocalStorage<CallerTrace>();

function isSerializableTransaction(args: unknown[]) {
  const options = args[1] as { isolationLevel?: unknown } | undefined;
  return typeof args[0] === "function" && options?.isolationLevel === Prisma.TransactionIsolationLevel.Serializable;
}

function instrumentTransactions() {
  const db = getDb();
  const original = db.$transaction.bind(db) as (...args: unknown[]) => Promise<unknown>;
  vi.spyOn(db, "$transaction").mockImplementation(((...args: unknown[]) => {
    const trace = callerTrace.getStore();
    if (!trace || !isSerializableTransaction(args)) return original(...args);
    return original(...args).then((value) => {
      trace.outcomes.push("committed");
      return value;
    }, (error: unknown) => {
      trace.outcomes.push(isTransientTransactionConflict(error) ? "transient" : isUniqueConflict(error) ? "unique" : "other");
      throw error;
    });
  }) as typeof db.$transaction);
}

function isUniqueConflict(error: unknown) {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}

type CallerResult<T> = {
  index: number;
  ms: number;
  attempts: number;
  outcomes: TransactionOutcome[];
  value?: T;
  error?: unknown;
};

async function runConcurrently<T>(count: number, call: (index: number) => Promise<T>) {
  const start = performance.now();
  // Every caller starts in the same macrotask, so they genuinely race.
  const results = await Promise.all(Array.from({ length: count }, (_, index) => {
    const trace: CallerTrace = { outcomes: [] };
    return callerTrace.run(trace, async (): Promise<CallerResult<T>> => {
      const begin = performance.now();
      const finish = (partial: Pick<CallerResult<T>, "value" | "error">): CallerResult<T> =>
        ({ index, ms: performance.now() - begin, attempts: trace.outcomes.length, outcomes: trace.outcomes, ...partial });
      try {
        return finish({ value: await call(index) });
      } catch (error) {
        return finish({ error });
      }
    });
  }));
  return { results, wallMs: performance.now() - start };
}

function percentile(values: number[], p: number) {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)]!;
}

function errorKind(error: unknown) {
  if (error === undefined) return "ok";
  if (error instanceof InventoryUnavailableError) return "InventoryUnavailableError";
  if (error instanceof ProductChangedError) return "ProductChangedError";
  if (error instanceof FlashSaleUnavailableError) return "FlashSaleUnavailableError";
  if (isTransientTransactionConflict(error) || isUniqueConflict(error)) return `retry_exhausted:${(error as { code?: string }).code ?? "unknown"}`;
  return `unexpected:${error instanceof Error ? error.name : typeof error}`;
}

function report<T>(path: string, run: { results: CallerResult<T>[]; wallMs: number }, extra: Record<string, unknown> = {}) {
  const attempts = run.results.map((result) => result.attempts);
  const latencies = run.results.map((result) => result.ms);
  const outcomes: Record<string, number> = {};
  for (const result of run.results) {
    const kind = errorKind(result.error);
    outcomes[kind] = (outcomes[kind] ?? 0) + 1;
  }
  const summary = {
    path,
    concurrency: run.results.length,
    outcomes,
    attempts: {
      total: attempts.reduce((sum, value) => sum + value, 0),
      max: Math.max(...attempts),
      mean: Number((attempts.reduce((sum, value) => sum + value, 0) / attempts.length).toFixed(2)),
    },
    latencyMs: {
      p50: Math.round(percentile(latencies, 50)),
      p95: Math.round(percentile(latencies, 95)),
      max: Math.round(Math.max(...latencies)),
      wall: Math.round(run.wallMs),
    },
    ...extra,
  };
  console.info(`[serializable_stress] ${JSON.stringify(summary)}`);
  return summary;
}

/**
 * A failure must be a domain error or a conflict that used the whole retry
 * budget of its last retry loop. Anything else (an early P2034, a pool
 * timeout, a TypeError) is a defect.
 */
function expectCleanFailures<T>(results: CallerResult<T>[], allowed: Array<new (...args: never[]) => Error>, policy: RetryPolicy) {
  for (const result of results) {
    if (result.error === undefined) continue;
    if (allowed.some((type) => result.error instanceof type)) continue;
    expect(errorKind(result.error), `caller ${result.index}: ${String(result.error)}`).toMatch(/^retry_exhausted:/u);
    let trailingRetried = 0;
    for (let i = result.outcomes.length - 1; i >= 0 && policy.retried.has(result.outcomes[i]!); i -= 1) trailingRetried += 1;
    expect(trailingRetried, `caller ${result.index} gave up before its retry budget`).toBe(policy.attempts);
  }
}

// ---------------------------------------------------------------------------
// Fixtures: one disposable vendor per test, removed with cascades afterwards.

const vendorIds: string[] = [];
beforeAll(() => instrumentTransactions());
afterAll(() => vi.restoreAllMocks());
beforeEach(() => {
  vi.stubEnv("CSRF_SECRET", "synthetic-serializable-stress-secret-over-thirty-two-bytes");
  vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://serializable-stress.example.test");
});
afterEach(async () => {
  await getDb().vendor.deleteMany({ where: { id: { in: vendorIds.splice(0) } } });
  vi.unstubAllEnvs();
});

async function createVendor(label: string) {
  const suffix = `${label}-${randomUUID()}`;
  const vendor = await getDb().vendor.create({
    data: { name: `Stress ${label}`, slug: `stress-${suffix}`, email: `stress-${suffix}@example.test`, passwordHash: "synthetic-only" },
  });
  vendorIds.push(vendor.id);
  return vendor;
}

async function createProduct(vendorId: string, inventory: number) {
  return getDb().product.create({
    data: { vendorId, name: "Stress product", slug: `stress-product-${randomUUID()}`, priceCents: 2000, inventory, fulfillmentTypeConfirmed: true },
  });
}

/** The checkout route's reservation call: server price, server revision, canonical order in the same transaction. */
function reserveCheckout(input: {
  vendorId: string;
  productId: string;
  expectedProductRevision: number;
  amountCents: number;
  discountAmountCents?: number;
  /** Runs after the canonical order exists, inside the same Serializable transaction. */
  afterOrder?: (tx: Prisma.TransactionClient, orderId: string, revisions: readonly ReservedInventoryRevision[]) => Promise<void>;
}) {
  const key = randomUUID();
  const orderNumber = `STRESS-${randomUUID()}`;
  return createReservedPaymentTransaction({
    vendorId: input.vendorId,
    productId: input.productId,
    expectedProductRevision: input.expectedProductRevision,
    checkoutIdempotencyKey: key,
    transactionData: {
      vendorId: input.vendorId, checkoutIdempotencyKey: key, providerName: "demo", orderNumber,
      paymentMode: "platform", grossAmountCents: input.amountCents, netAmountCents: input.amountCents, currency: "TWD", status: "pending",
    },
    createCommerceOrder: async (tx, payment, revisions) => {
      const order = await createCommerceOrderForCheckout(tx, {
        vendorId: input.vendorId, productId: input.productId, orderNumber, checkoutIdempotencyKey: key,
        paymentTransactionId: payment.id, totalAmountCents: input.amountCents,
        ...(input.discountAmountCents ? { discountAmountCents: input.discountAmountCents } : {}),
        currency: "TWD", buyer, shipping,
      });
      if (input.afterOrder) await input.afterOrder(tx, order.id, revisions);
    },
  });
}

type BuyerOutcome = { won: boolean; reloads: number };

/**
 * A buyer whose admission is stale (409 "Product changed; reload checkout")
 * reloads and tries again with the current server revision, as the checkout
 * page does. Sold out ends the attempt. Since B-2 only a content change (a
 * merchant edit) makes an admission stale, so these paths expect no reload.
 */
async function buyerWithReloads(attempt: () => Promise<unknown>): Promise<BuyerOutcome> {
  for (let reloads = 0; reloads <= MAX_BUYER_RELOADS; reloads += 1) {
    try {
      await attempt();
      return { won: true, reloads };
    } catch (error) {
      if (error instanceof ProductChangedError) continue;
      throw error;
    }
  }
  throw new Error("[serializable_stress] buyer exceeded the reload bound.");
}

describe(`F-055 Serializable contention (${CONCURRENCY} concurrent callers)`, () => {
  it("checkout reservation sells exactly N units to 2N buyers and never oversells", async () => {
    const db = getDb();
    const vendor = await createVendor("checkout");
    const units = Math.floor(CONCURRENCY / 2);
    const product = await createProduct(vendor.id, units);

    const run = await runConcurrently(CONCURRENCY, () => buyerWithReloads(async () => {
      // Each (re)load reads the server revision and price, exactly like admission.
      const current = await db.product.findFirstOrThrow({ where: { id: product.id, vendorId: vendor.id }, select: { revision: true, priceCents: true } });
      return reserveCheckout({ vendorId: vendor.id, productId: product.id, expectedProductRevision: current.revision, amountCents: current.priceCents });
    }));

    const winners = run.results.filter((result) => result.value?.won);
    const reloads = run.results.map((result) => result.value?.reloads ?? 0);
    report("checkout_reservation", run, {
      units,
      winners: winners.length,
      firstLoadWinners: winners.filter((result) => result.value!.reloads === 0).length,
      reloads: { max: Math.max(...reloads), p95: percentile(reloads, 95), total: reloads.reduce((sum, value) => sum + value, 0) },
    });

    expectCleanFailures(run.results, [InventoryUnavailableError], CHECKOUT_RETRY);
    expect(winners).toHaveLength(units);
    // B-2: a sale moves stock, not the content revision, so no admitted buyer
    // of the unchanged product is sent back to reload checkout.
    expect(winners.filter((result) => result.value!.reloads === 0)).toHaveLength(units);
    expect(reloads.every((value) => value === 0)).toBe(true);
    expect(run.results.filter((result) => result.error !== undefined).every((result) => result.error instanceof InventoryUnavailableError)).toBe(true);
    const after = await db.product.findUniqueOrThrow({ where: { id: product.id } });
    expect(after.inventory).toBe(0);
    expect(after.revision).toBe(product.revision);
    expect(await db.paymentTransaction.count({ where: { vendorId: vendor.id } })).toBe(units);
    expect(await db.commerceOrder.count({ where: { vendorId: vendor.id } })).toBe(units);
    expect(await db.inventoryReservation.count({ where: { vendorId: vendor.id, status: "reserved" } })).toBe(units);
    // Server price only: every pending payment carries the product's own amount.
    expect(await db.paymentTransaction.count({ where: { vendorId: vendor.id, grossAmountCents: { not: product.priceCents } } })).toBe(0);
  }, TEST_TIMEOUT_MS);

  it("limited flash sale consumes exactly stockLimit claims and charges only the server sale price", async () => {
    const db = getDb();
    const vendor = await createVendor("flash");
    const stockLimit = Math.max(1, Math.floor(CONCURRENCY / 5));
    const product = await createProduct(vendor.id, CONCURRENCY);
    const live = await db.live.create({ data: { vendorId: vendor.id, title: "Stress live", slug: `stress-live-${randomUUID()}`, scheduledAt: new Date(), status: "live" } });
    await db.liveProduct.create({ data: { vendorId: vendor.id, liveId: live.id, productId: product.id } });
    const flashRun = await db.liveInteractionRun.create({ data: {
      vendorId: vendor.id, liveId: live.id, source: "manual", eventType: "flash_sale", title: "Sale",
      startsAt: new Date(Date.now() - 1_000), endsAt: new Date(Date.now() + 10 * 60_000),
      configuration: { kind: "flash_sale", durationSec: 600, productId: product.id, salePriceCents: 1000, originalPriceCents: 2000, stockLimit },
    } });
    const bearers = Array.from({ length: CONCURRENCY }, () => createInteractionBearer());
    await db.liveInteractionResponse.createMany({ data: bearers.map((bearer) => ({
      vendorId: vendor.id, liveId: live.id, runId: flashRun.id, productId: product.id,
      eventType: "flash_sale", participantHash: randomUUID(), value: "buy",
      claimTokenHash: hashInteractionBearer(bearer), expiresAt: flashRun.endsAt,
    })) });
    const scope = { vendorId: vendor.id, productId: product.id };

    const run = await runConcurrently(CONCURRENCY, (index) => buyerWithReloads(async () => {
      const bearer = bearers[index]!;
      const quote = (await resolveFlashSaleQuote(db, bearer, scope))!;
      return reserveCheckout({
        ...scope, expectedProductRevision: quote.productRevision,
        amountCents: quote.salePriceCents, discountAmountCents: quote.priceCents - quote.salePriceCents,
        afterOrder: (tx, orderId, revisions) => consumeFlashSaleQuote(tx, bearer, quote, orderId, new Date(), revisions.find((item) => item.productId === product.id)),
      });
    }));

    const winners = run.results.filter((result) => result.value?.won);
    const reloads = run.results.map((result) => result.value?.reloads ?? 0);
    report("flash_sale_quota", run, {
      stockLimit,
      winners: winners.length,
      firstLoadWinners: winners.filter((result) => result.value!.reloads === 0).length,
      reloads: { max: Math.max(...reloads), p95: percentile(reloads, 95), total: reloads.reduce((sum, value) => sum + value, 0) },
    });

    expectCleanFailures(run.results, [FlashSaleUnavailableError], CHECKOUT_RETRY);
    expect(winners).toHaveLength(stockLimit);
    // B-2: an unchanged offer stays valid for every buyer who saw it.
    expect(reloads.every((value) => value === 0)).toBe(true);
    expect(await db.liveInteractionResponse.count({ where: { runId: flashRun.id, usedOrderId: { not: null } } })).toBe(stockLimit);
    expect(await db.paymentTransaction.count({ where: { vendorId: vendor.id } })).toBe(stockLimit);
    expect(await db.paymentTransaction.count({ where: { vendorId: vendor.id, grossAmountCents: { not: 1000 } } })).toBe(0);
    expect(await db.commerceOrder.count({ where: { vendorId: vendor.id } })).toBe(stockLimit);
    expect((await db.product.findUniqueOrThrow({ where: { id: product.id } })).inventory).toBe(CONCURRENCY - stockLimit);
  }, TEST_TIMEOUT_MS);

  it("a merchant price edit during a concurrent sale still invalidates every stale admission", async () => {
    const db = getDb();
    const vendor = await createVendor("price-edit");
    const half = Math.floor(CONCURRENCY / 2);
    const product = await createProduct(vendor.id, CONCURRENCY);
    // Every buyer opened checkout before the edit and holds the same admission.
    const admitted = { revision: product.revision, priceCents: product.priceCents };
    const stale = () => reserveCheckout({ vendorId: vendor.id, productId: product.id, expectedProductRevision: admitted.revision, amountCents: admitted.priceCents });

    const before = await runConcurrently(half, stale);
    report("checkout_before_price_edit", before);
    expectCleanFailures(before.results, [], CHECKOUT_RETRY);
    expect(before.results.every((result) => result.error === undefined)).toBe(true);

    // The merchant raises the price; the content revision moves exactly once.
    const edited = await db.product.updateMany({ where: { id: product.id, vendorId: vendor.id, revision: admitted.revision }, data: { priceCents: 2500, revision: { increment: 1 } } });
    expect(edited.count).toBe(1);

    const after = await runConcurrently(CONCURRENCY - half, async () => {
      // The stale admission is rejected before any stock or payment is written.
      const rejected = await stale().then(() => null, (error: unknown) => error);
      // A reload reads the new server revision and price, as the checkout page does.
      const current = await db.product.findFirstOrThrow({ where: { id: product.id, vendorId: vendor.id }, select: { revision: true, priceCents: true } });
      await reserveCheckout({ vendorId: vendor.id, productId: product.id, expectedProductRevision: current.revision, amountCents: current.priceCents });
      return rejected;
    });
    report("checkout_after_price_edit", after);
    expectCleanFailures(after.results, [], CHECKOUT_RETRY);
    expect(after.results.every((result) => result.error === undefined && result.value instanceof ProductChangedError)).toBe(true);

    expect(await db.product.findUniqueOrThrow({ where: { id: product.id } })).toMatchObject({ inventory: 0, revision: admitted.revision + 1 });
    expect(await db.paymentTransaction.count({ where: { vendorId: vendor.id, grossAmountCents: admitted.priceCents } })).toBe(half);
    expect(await db.paymentTransaction.count({ where: { vendorId: vendor.id, grossAmountCents: 2500 } })).toBe(CONCURRENCY - half);
    expect(await db.paymentTransaction.count({ where: { vendorId: vendor.id } })).toBe(CONCURRENCY);
  }, TEST_TIMEOUT_MS);

  async function pendingCheckout(label: string) {
    const db = getDb();
    const vendor = await createVendor(label);
    const product = await createProduct(vendor.id, 1);
    const payment = await reserveCheckout({ vendorId: vendor.id, productId: product.id, expectedProductRevision: product.revision, amountCents: product.priceCents });
    const order = await db.commerceOrder.findFirstOrThrow({ where: { vendorId: vendor.id, primaryPaymentTransactionId: payment.id } });
    // The amount comes from the server's pending payment, never from the caller.
    const event = { provider: "demo", eventId: `stress-event-${randomUUID()}`, eventType: "paid", vendorId: vendor.id,
      orderNumber: payment.orderNumber!, grossAmountCents: payment.grossAmountCents, currency: payment.currency };
    return { vendor, product, payment, order, event };
  }

  async function expectSinglePaidTransition(checkout: Awaited<ReturnType<typeof pendingCheckout>>) {
    const db = getDb();
    const { vendor, product, payment, order } = checkout;
    expect((await db.paymentTransaction.findUniqueOrThrow({ where: { id: payment.id } })).status).toBe("paid");
    expect(await db.paymentTransaction.count({ where: { vendorId: vendor.id } })).toBe(1);
    expect(await db.commerceOrder.findUniqueOrThrow({ where: { id: order.id } })).toMatchObject({ status: "paid", paidAmountCents: payment.grossAmountCents });
    expect(await db.commerceOrderEvent.count({ where: { vendorId: vendor.id, orderId: order.id, eventType: "payment.paid" } })).toBe(1);
    expect(await db.inventoryReservation.findUniqueOrThrow({ where: { paymentTransactionId: payment.id } })).toMatchObject({ status: "committed" });
    // Payment never moves stock a second time.
    expect((await db.product.findUniqueOrThrow({ where: { id: product.id } })).inventory).toBe(0);
  }

  it("the payment webhook route processes one event delivered by every caller exactly once", async () => {
    vi.stubEnv("PAYMENT_PROVIDER", "demo");
    const db = getDb();
    const checkout = await pendingCheckout("webhook-route");
    const deliver = () => paymentWebhookRoute(new Request("http://127.0.0.1:31041/api/webhooks/payments?provider=demo", {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(checkout.event),
    }));

    const run = await runConcurrently(CONCURRENCY, async () => {
      const response = await deliver();
      return { status: response.status, body: await response.json() as { duplicate?: boolean } };
    });
    const statuses: Record<string, number> = {};
    for (const result of run.results) if (result.value) statuses[result.value.status] = (statuses[result.value.status] ?? 0) + 1;
    report("payment_webhook_route_same_event", run, { httpStatuses: statuses });

    // 200 for the claim holder or an already-processed duplicate; 503 tells the
    // provider to redeliver while another request holds the claim. Never 500.
    expectCleanFailures(run.results, [], WEBHOOK_RETRY);
    expect(run.results.every((result) => result.value && [200, 503].includes(result.value.status))).toBe(true);
    expect(run.results.filter((result) => result.value?.status === 200 && !result.value.body.duplicate)).toHaveLength(1);
    // Serializable payment transactions opened across every delivery: the claim holder's only.
    expect(run.results.reduce((sum, result) => sum + result.attempts, 0)).toBeLessThanOrEqual(WEBHOOK_RETRY.attempts);
    expect(await db.webhookEvent.findUniqueOrThrow({ where: { provider_eventId: { provider: "demo", eventId: checkout.event.eventId } } }))
      .toMatchObject({ status: "processed", retryCount: 0 });
    const redelivered = await deliver();
    expect(redelivered.status).toBe(200);
    expect(await redelivered.json()).toMatchObject({ duplicate: true });
    await expectSinglePaidTransition(checkout);
  }, TEST_TIMEOUT_MS);

  it("payment processing without the route's event claim still records one paid transition", async () => {
    const checkout = await pendingCheckout("webhook-lib");
    const payload = () => PaymentWebhookPayload.parse(checkout.event);

    // No WebhookEvent claim: every caller enters the Serializable payment transaction.
    const run = await runConcurrently(CONCURRENCY, () => processPaymentWebhook(payload()));
    report("payment_webhook_unclaimed_same_event", run);

    // The webhook-retry worker redelivers anything that exhausted its budget.
    const replay = await processPaymentWebhook(payload());
    expect(replay.transaction.status).toBe("paid");

    expectCleanFailures(run.results, [], WEBHOOK_RETRY);
    expect(run.results.filter((result) => result.error === undefined).length).toBeGreaterThanOrEqual(1);
    await expectSinglePaidTransition(checkout);
  }, TEST_TIMEOUT_MS);

  async function notificationFixture(registrants: number) {
    const db = getDb();
    const vendor = await createVendor("notify");
    const suffix = randomUUID();
    const form = await db.registrationForm.create({ data: { vendorId: vendor.id, name: "Stress form", slug: `stress-form-${suffix}`, headline: "Stress", fields: [] } });
    const template = await db.messageTemplate.create({ data: { vendorId: vendor.id, name: "Reminder", channel: "email", trigger: "live_reminder", subject: "{{live_title}}", body: "Hello {{name}}\n{{unsubscribe_url}}", isActive: true } });
    const live = await db.live.create({ data: {
      vendorId: vendor.id, formId: form.id, title: "Stress live", slug: `stress-notify-${suffix}`,
      scheduledAt: new Date(Date.now() + 30 * 24 * 60 * 60_000), status: "scheduled",
    } });
    const rule = await db.liveNotificationRule.create({ data: { vendorId: vendor.id, liveId: live.id, messageTemplateId: template.id, trigger: "before_live", offsetMinutes: 60 } });
    const submissionIds: string[] = [];
    for (let index = 0; index < registrants; index += 1) {
      const submission = await db.formSubmission.create({ data: {
        formId: form.id, liveId: live.id, name: `Lead ${index}`, email: `lead-${index}-${suffix}@example.test`,
        verificationStatus: "VERIFIED", verifiedAt: new Date(),
      } });
      submissionIds.push(submission.id);
    }
    return { vendor, live, rule, submissionIds };
  }

  it("live notification materialization of one recipient by every caller writes one delivery", async () => {
    const db = getDb();
    const fixture = await notificationFixture(1);
    const input = { vendorId: fixture.vendor.id, liveId: fixture.live.id, ruleId: fixture.rule.id, submissionId: fixture.submissionIds[0]! };

    const run = await runConcurrently(CONCURRENCY, () => ensureLiveNotificationDelivery(input, new Date(), { scheduleFuture: true }));
    const statuses: Record<string, number> = {};
    for (const result of run.results) if (result.value) statuses[result.value.status] = (statuses[result.value.status] ?? 0) + 1;
    report("live_notification_same_recipient", run, { statuses });

    expectCleanFailures(run.results, [], NOTIFICATION_RETRY);
    expect(statuses.queued).toBe(1);
    expect(await db.emailDelivery.count({ where: { vendorId: fixture.vendor.id, sourceLiveId: fixture.live.id } })).toBe(1);
    expect(await db.emailDelivery.count({ where: { vendorId: fixture.vendor.id, status: "queued" } })).toBe(1);
  }, TEST_TIMEOUT_MS);

  it("live notification materialization of distinct recipients writes one delivery each", async () => {
    const db = getDb();
    const fixture = await notificationFixture(CONCURRENCY);

    const run = await runConcurrently(CONCURRENCY, (index) => ensureLiveNotificationDelivery({
      vendorId: fixture.vendor.id, liveId: fixture.live.id, ruleId: fixture.rule.id, submissionId: fixture.submissionIds[index]!,
    }, new Date(), { scheduleFuture: true }));
    const failed = run.results.filter((result) => result.error !== undefined);
    report("live_notification_distinct_recipients", run);

    expectCleanFailures(run.results, [], NOTIFICATION_RETRY);
    // A caller that exhausted its budget wrote nothing; the scheduled job is its retry path.
    const written = await db.emailDelivery.groupBy({ by: ["sourceFormSubmissionId"], where: { vendorId: fixture.vendor.id }, _count: { _all: true } });
    expect(written.every((row) => row._count._all === 1)).toBe(true);
    expect(written).toHaveLength(CONCURRENCY - failed.length);
    for (const result of failed) {
      expect(written.some((row) => row.sourceFormSubmissionId === fixture.submissionIds[result.index])).toBe(false);
    }
  }, TEST_TIMEOUT_MS);
});
