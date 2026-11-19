import { createCipheriv, createDecipheriv, createHash, randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// A-2 05: the PayUni pending-payment reconciler on the disposable PostgreSQL
// database. Checkouts, reservations, orders, commissions, automation rules,
// webhook events and the callback route are real. Synthetic: the PayUni query
// endpoint (a local fetch stub that answers with locally signed envelopes),
// `after()` (outside a request scope it throws, so post-commit work runs
// inline exactly like the callback tests), and monitoring. No provider is called.
const monitoring = vi.hoisted(() => ({ captureOperationalError: vi.fn() }));
vi.mock("@/lib/monitoring", async (original) => ({
  ...await original<typeof import("@/lib/monitoring")>(),
  captureOperationalError: monitoring.captureOperationalError,
}));
vi.mock("next/server", async (original) => ({
  ...await original<typeof import("next/server")>(),
  after: () => { throw new Error("`after` was called outside a request scope"); },
}));

import { POST as paymentWebhookRoute } from "@/app/api/webhooks/payments/route";
import { createCommerceOrderForCheckout } from "@/lib/commerce-orders";
import { getDb } from "@/lib/db";
import { createReservedPaymentTransaction } from "@/lib/inventory-reservations";
import { generatePaymentOrderNumber } from "@/lib/payment-order-number";
import {
  PAYMENT_RECONCILE_MAX_ATTEMPTS,
  paymentReconcileDelayMs,
  runPendingPaymentReconciliation,
} from "@/lib/payment-pending-reconciliation";
import { protectProductDeliveryConfig, validateProductDeliveryDraft } from "@/lib/product-delivery";

/**
 * The real client, except that one delegate method throws while `when` holds:
 * a database failure in the middle of the reconciler's own writes (#664 M-1).
 */
function dbFailingOn(model: "webhookEvent" | "paymentPendingReconciliation", method: string, when: (args: unknown) => boolean = () => true) {
  const calls = { failed: 0 };
  const target = db[model] as unknown as Record<string | symbol, unknown>;
  const delegate = new Proxy(target, {
    get(object, property) {
      const value = Reflect.get(object, property);
      if (property === method && typeof value === "function") {
        return async (args: unknown) => {
          if (when(args)) {
            calls.failed += 1;
            throw new Error("synthetic database failure");
          }
          return (value as (input: unknown) => Promise<unknown>).call(object, args);
        };
      }
      return typeof value === "function" ? value.bind(object) : value;
    },
  });
  const client = new Proxy(db, {
    get(object, property) {
      if (property === model) return delegate;
      const value = Reflect.get(object, property);
      return typeof value === "function" ? value.bind(object) : value;
    },
  });
  return { client: client as typeof db, calls };
}

const db = getDb();
const vendorIds: string[] = [];
const HASH_KEY = "12345678901234567890123456789012";
const HASH_IV = "1234567890123456";
const MERCHANT = "TESTMER";
const PRICE_CENTS = 2_000;
const MINUTE = 60_000;

type ProviderAnswer =
  | { kind: "paid"; tradeNo: string; amount?: number; extra?: Record<string, string> }
  | { kind: "status"; tradeNo: string; tradeStatus: string; paymentType?: string }
  | { kind: "rows"; rows: Array<{ tradeNo: string; tradeStatus: string }> }
  | { kind: "not_found" }
  | { kind: "network" }
  | { kind: "bad_signature" };

const provider = {
  answers: new Map<string, ProviderAnswer>(),
  calls: [] as string[],
  /** Runs inside the provider call, before the answer returns (a callback arriving mid-reconcile). */
  during: null as null | ((orderNumber: string) => void),
};

function encrypt(payload: Record<string, unknown>) {
  const cipher = createCipheriv("aes-256-gcm", Buffer.from(HASH_KEY), Buffer.from(HASH_IV), { authTagLength: 16 });
  const plaintext = new URLSearchParams(
    Object.entries(payload).map(([key, value]) => [key, typeof value === "string" ? value : JSON.stringify(value)]),
  ).toString();
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]).toString("base64");
  return Buffer.from(`${encrypted}:::${cipher.getAuthTag().toString("base64")}`).toString("hex");
}

function signedBody(payload: Record<string, unknown>, outer: Record<string, string> = {}) {
  const encryptInfo = encrypt(payload);
  const hashInfo = createHash("sha256").update(`${HASH_KEY}${encryptInfo}${HASH_IV}`).digest("hex").toUpperCase();
  return new URLSearchParams({ MerID: MERCHANT, Version: "2.0", ...outer, EncryptInfo: encryptInfo, HashInfo: hashInfo }).toString();
}

function requestedOrder(init: RequestInit | undefined) {
  const encryptInfo = (init?.body as URLSearchParams).get("EncryptInfo")!;
  const [encrypted, tag] = Buffer.from(encryptInfo, "hex").toString("utf8").split(":::");
  const decipher = createDecipheriv("aes-256-gcm", Buffer.from(HASH_KEY), Buffer.from(HASH_IV));
  decipher.setAuthTag(Buffer.from(tag!, "base64"));
  const plain = Buffer.concat([decipher.update(Buffer.from(encrypted!, "base64")), decipher.final()]).toString("utf8");
  return new URLSearchParams(plain).get("MerTradeNo")!;
}

async function payUniQueryStub(url: string | URL | Request, init?: RequestInit) {
  expect(String(url)).toBe("https://sandbox-api.payuni.com.tw/api/trade/query");
  const orderNumber = requestedOrder(init);
  provider.calls.push(orderNumber);
  provider.during?.(orderNumber);
  const answer = provider.answers.get(orderNumber) ?? { kind: "not_found" };
  if (answer.kind === "network") throw Object.assign(new Error("synthetic timeout"), { name: "TimeoutError" });
  if (answer.kind === "not_found") return new Response(signedBody({ Status: "QUERY03001" }));
  if (answer.kind === "bad_signature") {
    const encryptInfo = encrypt({ Status: "SUCCESS" });
    return new Response(new URLSearchParams({ MerID: MERCHANT, EncryptInfo: encryptInfo, HashInfo: "0".repeat(64) }).toString());
  }
  if (answer.kind === "rows") {
    const rows = answer.rows.map((entry) => ({ MerTradeNo: orderNumber, TradeNo: entry.tradeNo, TradeAmt: String(PRICE_CENTS / 100), TradeStatus: entry.tradeStatus, PaymentType: "1", DataSource: "A" }));
    return new Response(signedBody({ Status: "SUCCESS", Result: rows }));
  }
  const row = answer.kind === "paid"
    ? { MerTradeNo: orderNumber, TradeNo: answer.tradeNo, TradeAmt: String((answer.amount ?? PRICE_CENTS) / 100), RemainAmt: String((answer.amount ?? PRICE_CENTS) / 100), TradeStatus: "1", PaymentType: "1", DataSource: "A", ...answer.extra }
    : { MerTradeNo: orderNumber, TradeNo: answer.tradeNo, TradeAmt: String(PRICE_CENTS / 100), TradeStatus: answer.tradeStatus, PaymentType: answer.paymentType ?? "1", DataSource: "A" };
  return new Response(signedBody({ Status: "SUCCESS", Result: row }));
}

/** The signed UPP Notify PayUni would have sent for a paid trade. */
function paidNotify(orderNumber: string, tradeNo: string) {
  const body = signedBody(
    { MerID: MERCHANT, Status: "SUCCESS", TradeStatus: "1", PaymentType: "1", MerTradeNo: orderNumber, TradeNo: tradeNo, TradeAmt: PRICE_CENTS / 100 },
    { Status: "SUCCESS" },
  );
  return paymentWebhookRoute(new Request("https://app.example.test/api/webhooks/payments?provider=payuni&source=notify", {
    method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body,
  }));
}

beforeEach(() => {
  vi.stubEnv("PAYUNI_ENV", "sandbox");
  vi.stubEnv("PAYUNI_SANDBOX_MERCHANT_ID", MERCHANT);
  vi.stubEnv("PAYUNI_SANDBOX_HASH_KEY", HASH_KEY);
  vi.stubEnv("PAYUNI_SANDBOX_HASH_IV", HASH_IV);
  vi.stubEnv("PAYMENT_PROVIDER", "payuni");
  vi.stubEnv("PAYMENT_RECONCILE_ENABLED", "true");
  vi.stubEnv("VERCEL_ENV", "");
  vi.stubEnv("CSRF_SECRET", "payment-reconcile-secret-longer-than-32-bytes");
  vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://payment-reconcile.example.test");
  vi.stubGlobal("fetch", vi.fn(payUniQueryStub));
  provider.answers.clear();
  provider.calls = [];
  provider.during = null;
  monitoring.captureOperationalError.mockClear();
});

afterEach(async () => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  const ids = vendorIds.splice(0);
  // The reconciler scans globally: a fixture that outlives its test must never be due again.
  await db.paymentTransaction.updateMany({ where: { vendorId: { in: ids }, status: { in: ["pending", "expired"] } }, data: { status: "failed" } });
  await db.webhookEvent.deleteMany({ where: { OR: [{ vendorId: { in: ids } }, { provider: "payuni", eventId: { contains: "RECON" } }] } });
  await db.auditLog.deleteMany({ where: { vendorId: { in: ids } } });
  for (const id of ids) {
    try {
      await db.vendor.delete({ where: { id } });
    } catch (error) {
      // Append-only commission ledger rows intentionally block vendor deletion; the
      // disposable database keeps those synthetic fixtures (same as settlement-carry-forward).
      if (!(error instanceof Error) || !/append-only|foreign key constraint|RESTRICT setting/i.test(error.message)) throw error;
    }
  }
});

async function tenant(label: string) {
  const key = randomUUID();
  const vendor = await db.vendor.create({
    data: { name: `補單 ${label}`, slug: `reconcile-${key}`, email: `vendor-${key}@example.test`, passwordHash: "synthetic-only" },
  });
  vendorIds.push(vendor.id);
  const product = await db.product.create({
    data: { vendorId: vendor.id, name: "補單商品", slug: `reconcile-product-${key}`, priceCents: PRICE_CENTS, currency: "TWD", inventory: 10, isActive: true, fulfillmentTypeConfirmed: true },
  });
  const affiliate = await db.affiliate.create({
    data: { vendorId: vendor.id, name: "合成推廣者", code: `RECON-${key.slice(0, 8).toUpperCase()}`, commissionRateBps: 1_000 },
  });
  await db.automationRule.create({
    data: {
      vendorId: vendor.id, name: "付款後貼標", trigger: "payment_paid",
      condition: { type: "order_amount_gte", amountCents: 1_000 } as Prisma.InputJsonValue,
      actions: [{ type: "add_customer_tag", tag: "已付款" }] as Prisma.InputJsonArray,
      isActive: true,
    },
  });
  return { vendor, product, affiliate };
}
type Tenant = Awaited<ReturnType<typeof tenant>>;

/** The checkout route's reservation (server price, referral frozen in the checkout metadata), aged past the minimum. */
async function checkout(t: Tenant, options: { ageMs?: number; productId?: string; paymentMode?: string; providerName?: string } = {}) {
  const orderNumber = generatePaymentOrderNumber();
  const checkoutIdempotencyKey = randomUUID();
  const productId = options.productId ?? t.product.id;
  const transaction = await createReservedPaymentTransaction({
    vendorId: t.vendor.id,
    productId,
    checkoutIdempotencyKey,
    transactionData: {
      vendorId: t.vendor.id, checkoutIdempotencyKey, providerName: options.providerName ?? "payuni", orderNumber,
      paymentMode: options.paymentMode ?? "platform", grossAmountCents: PRICE_CENTS, netAmountCents: PRICE_CENTS,
      currency: "TWD", status: "pending", metadata: { productId, referralCode: t.affiliate.code },
    },
    createCommerceOrder: async (tx, payment) => {
      await createCommerceOrderForCheckout(tx, {
        vendorId: t.vendor.id, productId, orderNumber, checkoutIdempotencyKey, paymentTransactionId: payment.id,
        totalAmountCents: PRICE_CENTS, currency: "TWD", buyer: { name: "合成買家", email: `buyer-${randomUUID()}@example.test`, phone: "0912345678" }, shipping: null,
      });
    },
  });
  await db.paymentTransaction.update({
    where: { id: transaction.id },
    data: { createdAt: new Date(Date.now() - (options.ageMs ?? 20 * MINUTE)) },
  });
  const order = await db.commerceOrder.findFirstOrThrow({ where: { vendorId: t.vendor.id, primaryPaymentTransactionId: transaction.id } });
  return { transactionId: transaction.id, orderNumber, orderId: order.id, tradeNo: `RECON-${randomUUID().slice(0, 12)}` };
}
type Checkout = Awaited<ReturnType<typeof checkout>>;

function reconcile(options: Parameters<typeof runPendingPaymentReconciliation>[0] = {}) {
  return runPendingPaymentReconciliation(options);
}

function reconciliationRow(c: Checkout) {
  return db.paymentPendingReconciliation.findFirst({ where: { paymentTransactionId: c.transactionId } });
}

/** Everything the paid pipeline decides, with tenant-specific identifiers replaced. */
async function outcome(t: Tenant, c: Checkout) {
  const transaction = await db.paymentTransaction.findUniqueOrThrow({ where: { id: c.transactionId } });
  const order = await db.commerceOrder.findUniqueOrThrow({ where: { id: c.orderId } });
  const orderEvents = await db.commerceOrderEvent.findMany({ where: { vendorId: t.vendor.id, orderId: c.orderId }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] });
  const reservation = await db.inventoryReservation.findUnique({ where: { paymentTransactionId: c.transactionId } });
  const product = await db.product.findUniqueOrThrow({ where: { id: t.product.id } });
  const commissions = await db.affiliateCommission.findMany({ where: { vendorId: t.vendor.id } });
  const ledger = await db.affiliateCommissionLedgerEntry.findMany({ where: { vendorId: t.vendor.id } });
  const logs = await db.automationExecutionLog.findMany({ where: { vendorId: t.vendor.id } });
  const tags = await db.customerTagAssignment.findMany({ where: { vendorId: t.vendor.id } });
  const emails = await db.emailDelivery.findMany({ where: { vendorId: t.vendor.id } });
  const events = await db.webhookEvent.findMany({ where: { vendorId: t.vendor.id } });
  const scrub = (value: unknown) => JSON.parse(JSON.stringify(value ?? null)
    .replaceAll(c.tradeNo, "<trade>").replaceAll(c.orderNumber, "<order>")
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gu, "<uuid>"));
  return scrub({
    transaction: {
      status: transaction.status, providerTradeNo: transaction.providerTradeNo, grossAmountCents: transaction.grossAmountCents,
      gatewayFeeCents: transaction.gatewayFeeCents, platformFeeCents: transaction.platformFeeCents, netAmountCents: transaction.netAmountCents,
      currency: transaction.currency, metadataKeys: Object.keys((transaction.metadata ?? {}) as object).sort(),
    },
    order: { status: order.status, paidAmountCents: order.paidAmountCents, refundedAmountCents: order.refundedAmountCents, paid: order.paidAt !== null },
    orderEvents: orderEvents.map((event) => ({ eventType: event.eventType, actorType: event.actorType, dedupKey: event.dedupKey.replace(c.transactionId, "<tx>").replace(c.orderId, "<order-id>") })),
    inventory: { reservation: reservation?.status ?? null, productInventory: product.inventory },
    commissions: commissions.map((row) => ({
      status: row.status, sourceType: row.sourceType, orderNumber: row.orderNumber, orderAmountCents: row.orderAmountCents,
      commissionRateBps: row.commissionRateBps, commissionAmountCents: row.commissionAmountCents, netReferenceAmountCents: row.netReferenceAmountCents,
    })),
    ledger: ledger.map((row) => ({ entryType: row.entryType, providerName: row.providerName, eventIdentity: row.eventIdentity, amountCents: row.amountCents })),
    automation: logs.map((row) => ({ status: row.status, conditionMatched: row.conditionMatched, eventId: row.eventId.replace(c.orderId, "<order-id>") })),
    tags: tags.map((row) => row.tag),
    emails: emails.map((row) => ({ trigger: row.trigger, status: row.status })).sort((a, b) => a.trigger.localeCompare(b.trigger)),
    webhookEvents: events.map((row) => ({ provider: row.provider, eventId: row.eventId, eventType: row.eventType, status: row.status })),
  });
}

describe("PayUni pending-payment reconciler (A-2 05)", () => {
  it("settles a lost paid Notify through the webhook pipeline: payment, order, stock, commission and automation", async () => {
    const t = await tenant("A");
    const c = await checkout(t);
    provider.answers.set(c.orderNumber, { kind: "paid", tradeNo: c.tradeNo });

    const summary = await reconcile();

    expect(summary).toMatchObject({ candidates: 1, examined: 1, paid: 1, errors: 0, manualReview: 0 });
    expect(provider.calls).toEqual([c.orderNumber]);
    const state = await outcome(t, c);
    expect(state.transaction).toMatchObject({ status: "paid", providerTradeNo: "<trade>", grossAmountCents: PRICE_CENTS });
    expect(state.order).toMatchObject({ status: "paid", paidAmountCents: PRICE_CENTS, paid: true });
    expect(state.inventory).toEqual({ reservation: "committed", productInventory: 9 });
    expect(state.commissions).toEqual([expect.objectContaining({ status: "pending", orderAmountCents: PRICE_CENTS, commissionRateBps: 1_000, commissionAmountCents: 200 })]);
    expect(state.ledger).toEqual([{ entryType: "accrual", providerName: "payuni", eventIdentity: "<trade>:1", amountCents: 200 }]);
    expect(state.automation).toEqual([expect.objectContaining({ status: "completed", conditionMatched: true })]);
    expect(state.tags).toEqual(["已付款"]);
    expect(state.webhookEvents).toEqual([{ provider: "payuni", eventId: "<trade>:1", eventType: "paid", status: "processed" }]);
    await expect(reconciliationRow(c)).resolves.toMatchObject({ vendorId: t.vendor.id, status: "settled", attempts: 1, lastOutcome: "paid_applied", resolvedAt: expect.any(Date) });
    expect(await db.auditLog.count({ where: { vendorId: t.vendor.id, action: "payment_reconcile_applied", actorLabel: "job:payment-reconcile" } })).toBe(1);

    // The late Notify for the same trade state is a duplicate of the reconciled event.
    const late = await paidNotify(c.orderNumber, c.tradeNo);
    expect(late.status).toBe(200);
    await expect(late.json()).resolves.toMatchObject({ ok: true, duplicate: true });
    expect(await outcome(t, c)).toEqual(state);
    // Settled: the next run neither scans nor queries it again.
    expect(await reconcile({ now: new Date(Date.now() + 24 * 60 * MINUTE) })).toMatchObject({ candidates: 0 });
    expect(provider.calls).toHaveLength(1);
  });

  it("produces the same commission, stock, order and automation outcome as the callback path", async () => {
    const viaCallback = await tenant("callback");
    const viaReconciler = await tenant("reconciler");
    const callbackCheckout = await checkout(viaCallback);
    const reconcilerCheckout = await checkout(viaReconciler);
    provider.answers.set(reconcilerCheckout.orderNumber, { kind: "paid", tradeNo: reconcilerCheckout.tradeNo });
    // Only the reconciler's order is lost; the callback tenant's Notify arrives.
    expect((await paidNotify(callbackCheckout.orderNumber, callbackCheckout.tradeNo)).status).toBe(200);

    await reconcile();

    const callbackOutcome = await outcome(viaCallback, callbackCheckout);
    const reconcilerOutcome = await outcome(viaReconciler, reconcilerCheckout);
    expect(reconcilerOutcome).toEqual(callbackOutcome);
    expect(reconcilerOutcome).toMatchSnapshot();
  });

  it("applies a callback and a reconciler run that arrive together exactly once", async () => {
    const t = await tenant("race");
    for (let round = 0; round < 3; round += 1) {
      const c = await checkout(t);
      provider.answers.set(c.orderNumber, { kind: "paid", tradeNo: c.tradeNo });
      // Round 0/1: both start together. Round 2: the Notify arrives while the reconciler waits for PayUni.
      let notify: Promise<Response> | null = null;
      if (round === 2) provider.during = (orderNumber) => { if (orderNumber === c.orderNumber) notify = paidNotify(c.orderNumber, c.tradeNo); };
      const [callbackResponse, summary] = round === 2
        ? [null, await reconcile()]
        : await Promise.all([paidNotify(c.orderNumber, c.tradeNo), reconcile()]);
      const settledResponse = callbackResponse ?? await notify!;
      expect([200, 503]).toContain(settledResponse.status);
      expect(summary.errors).toBe(0);
      provider.during = null;
      // A 503 (claim held by the reconciler) is redelivered by PayUni and then sees the processed event.
      if (settledResponse.status === 503) expect((await paidNotify(c.orderNumber, c.tradeNo)).status).toBe(200);

      const state = await outcome(t, c);
      expect(state.transaction.status).toBe("paid");
      expect(state.order).toMatchObject({ status: "paid", paidAmountCents: PRICE_CENTS });
      expect(state.orderEvents.filter((event: { eventType: string }) => event.eventType === "payment.paid")).toHaveLength(1);
      expect(state.webhookEvents.filter((event: { eventId: string }) => event.eventId === "<trade>:1")).toEqual([
        expect.objectContaining({ status: "processed" }),
      ]);
    }
    // Three paid orders, three commissions and accruals, three units sold: never doubled.
    expect(await db.affiliateCommission.count({ where: { vendorId: t.vendor.id } })).toBe(3);
    expect(await db.affiliateCommissionLedgerEntry.count({ where: { vendorId: t.vendor.id } })).toBe(3);
    expect((await db.product.findUniqueOrThrow({ where: { id: t.product.id } })).inventory).toBe(7);
    expect(await db.automationExecutionLog.count({ where: { vendorId: t.vendor.id, status: "completed" } })).toBe(3);
  });

  it("binds every write to the payment's own vendor and leaves another tenant untouched", async () => {
    const a = await tenant("A");
    const b = await tenant("B");
    const paidA = await checkout(a);
    const pendingB = await checkout(b);
    provider.answers.set(paidA.orderNumber, { kind: "paid", tradeNo: paidA.tradeNo });
    provider.answers.set(pendingB.orderNumber, { kind: "not_found" });

    const summary = await reconcile();

    expect(summary).toMatchObject({ candidates: 2, paid: 1, notFound: 1 });
    expect((await outcome(a, paidA)).transaction.status).toBe("paid");
    const stateB = await outcome(b, pendingB);
    expect(stateB.transaction.status).toBe("pending");
    expect(stateB.commissions).toEqual([]);
    expect(stateB.webhookEvents).toEqual([]);
    expect(stateB.inventory).toEqual({ reservation: "reserved", productInventory: 9 });
    await expect(reconciliationRow(paidA)).resolves.toMatchObject({ vendorId: a.vendor.id, status: "settled" });
    await expect(reconciliationRow(pendingB)).resolves.toMatchObject({ vendorId: b.vendor.id, status: "active", lastOutcome: "not_found" });
    expect(await db.affiliateCommission.count({ where: { vendorId: b.vendor.id } })).toBe(0);
    const event = await db.webhookEvent.findFirstOrThrow({ where: { provider: "payuni", eventId: `${paidA.tradeNo}:1` } });
    expect(event.vendorId).toBe(a.vendor.id);
    // A reconciliation row can only name a payment of its own vendor (composite foreign key).
    await expect(db.paymentPendingReconciliation.create({
      data: { vendorId: b.vendor.id, paymentTransactionId: paidA.transactionId, providerName: "payuni", nextQueryAt: new Date() },
    })).rejects.toMatchObject({ code: "P2003" });
  });

  it("settles a suspended vendor's payment like the callback does: booked, fulfillment held", async () => {
    const t = await tenant("suspended");
    const product = await db.product.create({
      data: { vendorId: t.vendor.id, name: "合成數位商品", slug: `digital-${randomUUID()}`, priceCents: PRICE_CENTS, currency: "TWD", inventory: 5, isActive: true, commerceDomain: "merchant", fulfillmentType: "digital", fulfillmentTypeConfirmed: true },
    });
    const delivery = validateProductDeliveryDraft({
      fulfillmentType: "digital", isActive: true, title: "合成下載", destinationUrl: "https://delivery.example.com/buyer/content",
      instructions: "付款後從訂單頁取得內容。", hostConfirmed: true,
    })!;
    const allowlist = await db.vendorDeliveryUrlAllowlist.create({
      data: { vendorId: t.vendor.id, hostname: delivery.destinationHostname!, pathPrefix: delivery.destinationPathPrefix!, allowQuery: false, status: "active" },
    });
    const configId = randomUUID();
    await db.productDeliveryConfig.create({
      data: {
        id: configId, vendorId: t.vendor.id, productId: product.id, allowlistId: allowlist.id, revision: 1, status: "active", fulfillmentType: "digital",
        deliveryKind: delivery.deliveryKind, title: delivery.title,
        ...protectProductDeliveryConfig(delivery, { vendorId: t.vendor.id, productId: product.id, configId, revision: 1 }),
        activatedAt: new Date(),
      },
    });
    const c = await checkout(t, { productId: product.id });
    await db.vendor.update({ where: { id: t.vendor.id }, data: { suspendedAt: new Date(), suspendedReason: "合成：補單凍結測試" } });
    provider.answers.set(c.orderNumber, { kind: "paid", tradeNo: c.tradeNo });

    expect(await reconcile()).toMatchObject({ paid: 1, errors: 0 });

    const order = await db.commerceOrder.findUniqueOrThrow({
      where: { id: c.orderId },
      include: { items: { include: { entitlement: true } }, events: { where: { eventType: "payment.paid" } } },
    });
    expect(order.status).toBe("paid");
    expect(order.items[0]?.entitlement).toMatchObject({ status: "pending", grantedAt: null });
    expect(order.events[0]?.sanitizedData).toMatchObject({ fulfillmentHeld: "vendor_suspended" });
    expect(await db.affiliateCommission.count({ where: { vendorId: t.vendor.id } })).toBe(1);
    // The suspended vendor's payment_paid automation does not run (same as a callback).
    expect(await db.automationExecutionLog.count({ where: { vendorId: t.vendor.id } })).toBe(0);
  });

  it("refuses a provider amount that differs from the server record, holds the payment and alerts", async () => {
    const t = await tenant("mismatch");
    const c = await checkout(t);
    provider.answers.set(c.orderNumber, { kind: "paid", tradeNo: c.tradeNo, amount: PRICE_CENTS + 100 });

    expect(await reconcile()).toMatchObject({ manualReview: 1, paid: 0 });

    const transaction = await db.paymentTransaction.findUniqueOrThrow({ where: { id: c.transactionId } });
    expect(transaction).toMatchObject({ status: "pending", grossAmountCents: PRICE_CENTS });
    // The hold is merged into the checkout snapshot; no other key is rewritten.
    expect(transaction.metadata).toEqual({
      productId: t.product.id, referralCode: t.affiliate.code,
      paymentManualReconciliation: { reason: "reconcile_amount_mismatch", webhookEventId: expect.any(String) },
    });
    expect(await db.affiliateCommission.count({ where: { vendorId: t.vendor.id } })).toBe(0);
    await expect(reconciliationRow(c)).resolves.toMatchObject({ status: "needs_manual_review", lastOutcome: "amount_mismatch" });
    const manual = await db.webhookEvent.findFirstOrThrow({ where: { vendorId: t.vendor.id } });
    expect(manual).toMatchObject({ eventId: `manual:reconcile:${c.orderNumber}:amount_mismatch`, status: "needs_manual_reconciliation", eventType: "manual_reconciliation" });
    expect(manual.payload).toMatchObject({ reconciliation: { expectedAmountCents: PRICE_CENTS, reportedAmountCents: PRICE_CENTS + 100, matchedTransaction: c.transactionId } });
    expect(monitoring.captureOperationalError).toHaveBeenCalledWith(expect.any(Error), expect.objectContaining({
      source: "payment_reconcile", operation: "manual_review", status: "amount_mismatch",
    }), expect.objectContaining({ level: "error" }));
    // Held: inventory expiry keeps the stock, and the reconciler stops asking.
    expect(await reconcile({ now: new Date(Date.now() + 24 * 60 * MINUTE) })).toMatchObject({ candidates: 0 });
  });

  it("applies a provider failure through the pipeline and stops on an expired trade without changing state", async () => {
    const t = await tenant("failed");
    const failed = await checkout(t);
    const expired = await checkout(t);
    provider.answers.set(failed.orderNumber, { kind: "status", tradeNo: failed.tradeNo, tradeStatus: "2" });
    provider.answers.set(expired.orderNumber, { kind: "status", tradeNo: expired.tradeNo, tradeStatus: "4" });

    expect(await reconcile()).toMatchObject({ failed: 1, expired: 1, errors: 0 });

    const failedState = await outcome(t, failed);
    expect(failedState.transaction.status).toBe("failed");
    expect(failedState.inventory.reservation).toBe("released");
    expect(failedState.webhookEvents).toEqual(expect.arrayContaining([{ provider: "payuni", eventId: "<trade>:2", eventType: "failed", status: "processed" }]));
    await expect(reconciliationRow(failed)).resolves.toMatchObject({ status: "settled", lastOutcome: "failed_applied" });
    const expiredTransaction = await db.paymentTransaction.findUniqueOrThrow({ where: { id: expired.transactionId } });
    expect(expiredTransaction.status).toBe("pending");
    await expect(reconciliationRow(expired)).resolves.toMatchObject({ status: "closed", lastOutcome: "provider_expired" });
    expect(await db.affiliateCommission.count({ where: { vendorId: t.vendor.id } })).toBe(0);
  });

  it("accepts a late paid on a payment whose local reservation already expired", async () => {
    const t = await tenant("late");
    const c = await checkout(t);
    await db.inventoryReservation.updateMany({ where: { paymentTransactionId: c.transactionId }, data: { status: "released", releasedAt: new Date(), releaseReason: "expired" } });
    await db.product.update({ where: { id: t.product.id }, data: { inventory: { increment: 1 } } });
    await db.paymentTransaction.update({ where: { id: c.transactionId }, data: { status: "expired" } });
    provider.answers.set(c.orderNumber, { kind: "paid", tradeNo: c.tradeNo });

    expect(await reconcile()).toMatchObject({ paid: 1 });

    const state = await outcome(t, c);
    expect(state.transaction.status).toBe("paid");
    expect(state.inventory).toEqual({ reservation: "committed", productInventory: 9 });
  });

  it("scans only PayUni platform payments inside the age window that are not held", async () => {
    const t = await tenant("window");
    const tooNew = await checkout(t, { ageMs: 5 * MINUTE });
    const tooOld = await checkout(t, { ageMs: 4 * 24 * 60 * MINUTE });
    const byo = await checkout(t, { paymentMode: "byo" });
    const demo = await checkout(t, { providerName: "demo" });
    const held = await checkout(t);
    await db.paymentTransaction.update({
      where: { id: held.transactionId },
      data: { metadata: { productId: t.product.id, paymentManualReconciliation: { reason: "trade_status_unknown", webhookEventId: "synthetic" } } },
    });
    const due = await checkout(t);

    expect(await reconcile()).toMatchObject({ candidates: 1, notFound: 1 });
    expect(provider.calls).toEqual([due.orderNumber]);
    for (const skipped of [tooNew, tooOld, byo, demo, held]) await expect(reconciliationRow(skipped)).resolves.toBeNull();
  });

  it("backs off, retries errors, closes an absent trade at the limit and sends exhausted errors to a human", async () => {
    const t = await tenant("backoff");
    const absent = await checkout(t);
    const broken = await checkout(t);
    provider.answers.set(broken.orderNumber, { kind: "network" });

    expect(await reconcile()).toMatchObject({ notFound: 1, queryErrors: 1 });
    const first = await reconciliationRow(absent);
    expect(first).toMatchObject({ status: "active", attempts: 1, lastOutcome: "not_found" });
    expect(first!.nextQueryAt.getTime() - first!.lastQueriedAt!.getTime()).toBe(paymentReconcileDelayMs(1));
    await expect(reconciliationRow(broken)).resolves.toMatchObject({ status: "active", attempts: 1, lastOutcome: "query_error_network" });

    // Not due yet: nothing is queried.
    expect(await reconcile()).toMatchObject({ candidates: 0 });
    expect(provider.calls).toHaveLength(2);

    // Due again after the back-off: the second query, with a longer wait.
    const later = new Date(Date.now() + paymentReconcileDelayMs(1) + MINUTE);
    expect(await reconcile({ now: later })).toMatchObject({ candidates: 2 });
    const second = await reconciliationRow(absent);
    expect(second).toMatchObject({ attempts: 2 });
    expect(second!.nextQueryAt.getTime() - later.getTime()).toBe(paymentReconcileDelayMs(2));

    // The last allowed query.
    await db.paymentPendingReconciliation.updateMany({
      where: { paymentTransactionId: { in: [absent.transactionId, broken.transactionId] } },
      data: { attempts: PAYMENT_RECONCILE_MAX_ATTEMPTS - 1, nextQueryAt: new Date(Date.now() - MINUTE) },
    });
    expect(await reconcile()).toMatchObject({ closed: 1, manualReview: 1 });
    await expect(reconciliationRow(absent)).resolves.toMatchObject({ status: "closed", attempts: PAYMENT_RECONCILE_MAX_ATTEMPTS, lastOutcome: "not_found" });
    await expect(reconciliationRow(broken)).resolves.toMatchObject({ status: "needs_manual_review", lastOutcome: "query_attempts_exhausted" });
    await expect(db.webhookEvent.findFirstOrThrow({ where: { vendorId: t.vendor.id } })).resolves.toMatchObject({
      eventId: `manual:reconcile:${broken.orderNumber}:query_attempts_exhausted`, status: "needs_manual_reconciliation",
    });
    // No captured money was reported, so the pending payment is not held.
    expect((await db.paymentTransaction.findUniqueOrThrow({ where: { id: broken.transactionId } })).metadata).not.toHaveProperty("paymentManualReconciliation");
    expect(await reconcile({ now: new Date(Date.now() + 24 * 60 * MINUTE) })).toMatchObject({ candidates: 0 });
  });

  it("alerts at error level on a response that fails the signature check and keeps retrying", async () => {
    const t = await tenant("signature");
    const c = await checkout(t);
    provider.answers.set(c.orderNumber, { kind: "bad_signature" });

    expect(await reconcile()).toMatchObject({ queryErrors: 1 });

    await expect(reconciliationRow(c)).resolves.toMatchObject({ status: "active", lastOutcome: "query_error_authentication" });
    expect((await db.paymentTransaction.findUniqueOrThrow({ where: { id: c.transactionId } })).status).toBe("pending");
    expect(monitoring.captureOperationalError).toHaveBeenCalledWith(expect.any(Error), expect.objectContaining({
      source: "payment_reconcile", operation: "query", status: "authentication",
    }), expect.objectContaining({ level: "error" }));
  });

  it("caps each run, shares it round-robin across vendors and stops at its deadline", async () => {
    const busy = await tenant("busy");
    const quietB = await tenant("quiet-b");
    const quietC = await tenant("quiet-c");
    const busyCheckouts = [];
    for (let index = 0; index < 4; index += 1) busyCheckouts.push(await checkout(busy, { ageMs: (30 + index) * MINUTE }));
    const b = await checkout(quietB, { ageMs: 20 * MINUTE });
    const c = await checkout(quietC, { ageMs: 16 * MINUTE });

    expect(await reconcile({ limit: 3 })).toMatchObject({ candidates: 3, examined: 3 });
    // Each vendor's earliest payment before any vendor's second.
    expect(new Set(provider.calls)).toEqual(new Set([busyCheckouts[3]!.orderNumber, b.orderNumber, c.orderNumber]));

    // A run whose clock is already past its deadline after the first payment starts no other.
    provider.calls = [];
    // Calls: the run's start, the check before the first payment, the check before the second.
    let tick = 0;
    const clock = () => (tick++ < 2 ? 0 : 60_000);
    expect(await reconcile({ clock, now: new Date() })).toMatchObject({ candidates: 3, examined: 1 });
    expect(provider.calls).toHaveLength(1);
  });

  it("lets only one of two overlapping runs query a payment, on the first claim and on a later one", async () => {
    const t = await tenant("overlap");
    const c = await checkout(t);

    // Both runs must see the payment as due before either claims it: each run's
    // scan waits at a two-party barrier, so the overlap is certain on any
    // scheduler (CI ran the second scan only after the first run had finished).
    const overlapping = () => {
      let arrived = 0;
      let release!: () => void;
      const bothScanned = new Promise<void>((resolve) => { release = resolve; });
      const client = new Proxy(db, {
        get(object, property) {
          const value = Reflect.get(object, property);
          if (property === "$queryRaw") {
            return async (...args: Parameters<typeof db.$queryRaw>) => {
              const rows = await db.$queryRaw(...args);
              arrived += 1;
              if (arrived === 2) release();
              await bothScanned;
              return rows;
            };
          }
          return typeof value === "function" ? value.bind(object) : value;
        },
      });
      return client as typeof db;
    };

    // First claim: both runs try to create the reconciliation row.
    const firstRound = overlapping();
    const [first, second] = await Promise.all([reconcile({ db: firstRound }), reconcile({ db: firstRound })]);
    expect([first.candidates, second.candidates]).toEqual([1, 1]);
    expect(first.notFound + second.notFound).toBe(1);
    expect(first.claimedElsewhere + second.claimedElsewhere).toBe(1);
    expect(provider.calls).toEqual([c.orderNumber]);
    await expect(reconciliationRow(c)).resolves.toMatchObject({ attempts: 1 });

    // A later claim: both runs try the conditional update of the same due row.
    const later = new Date(Date.now() + paymentReconcileDelayMs(1) + MINUTE);
    const secondRound = overlapping();
    const [third, fourth] = await Promise.all([reconcile({ db: secondRound, now: later }), reconcile({ db: secondRound, now: later })]);
    expect([third.candidates, fourth.candidates]).toEqual([1, 1]);
    expect(third.notFound + fourth.notFound).toBe(1);
    expect(third.claimedElsewhere + fourth.claimedElsewhere).toBe(1);
    expect(provider.calls).toEqual([c.orderNumber, c.orderNumber]);
    await expect(reconciliationRow(c)).resolves.toMatchObject({ attempts: 2 });
  });

  it("does nothing when PayUni is not configured on the deployment", async () => {
    const t = await tenant("unconfigured");
    await checkout(t);
    vi.stubEnv("PAYUNI_ENV", "");

    expect(await reconcile()).toMatchObject({ skipped: "provider_unavailable", candidates: 0 });
    expect(provider.calls).toEqual([]);
  });

  it.each(["", "false", "1", "yes"])("stays off unless PAYMENT_RECONCILE_ENABLED is true (%j)", async (value) => {
    const t = await tenant("disabled");
    const c = await checkout(t);
    vi.stubEnv("PAYMENT_RECONCILE_ENABLED", value);

    expect(await reconcile()).toMatchObject({ skipped: "disabled", candidates: 0 });
    expect(provider.calls).toEqual([]);
    await expect(reconciliationRow(c)).resolves.toBeNull();
  });

  it("keeps the row active and unheld when recording the manual review fails, and completes it next run", async () => {
    const t = await tenant("record-failure");
    const c = await checkout(t);
    provider.answers.set(c.orderNumber, { kind: "paid", tradeNo: c.tradeNo, amount: PRICE_CENTS + 100 });
    const failing = dbFailingOn("webhookEvent", "create");

    expect(await reconcile({ db: failing.client })).toMatchObject({ errors: 1, manualReview: 0 });

    expect(failing.calls.failed).toBe(1);
    await expect(reconciliationRow(c)).resolves.toMatchObject({ status: "active", attempts: 1 });
    expect((await db.paymentTransaction.findUniqueOrThrow({ where: { id: c.transactionId } })).metadata).not.toHaveProperty("paymentManualReconciliation");
    expect(await db.webhookEvent.count({ where: { vendorId: t.vendor.id } })).toBe(0);

    // Next due run, database healthy: the whole manual review completes.
    expect(await reconcile({ now: new Date(Date.now() + paymentReconcileDelayMs(1) + MINUTE) })).toMatchObject({ manualReview: 1, errors: 0 });
    await expect(reconciliationRow(c)).resolves.toMatchObject({ status: "needs_manual_review", attempts: 2, lastOutcome: "amount_mismatch" });
    expect((await db.paymentTransaction.findUniqueOrThrow({ where: { id: c.transactionId } })).metadata).toMatchObject({ paymentManualReconciliation: { reason: "reconcile_amount_mismatch" } });
    expect(await db.webhookEvent.count({ where: { vendorId: t.vendor.id, status: "needs_manual_reconciliation" } })).toBe(1);
  });

  it("finishes its own manual review when only the final status write failed", async () => {
    const t = await tenant("finish-failure");
    const c = await checkout(t);
    provider.answers.set(c.orderNumber, { kind: "paid", tradeNo: c.tradeNo, amount: PRICE_CENTS + 100 });
    const failing = dbFailingOn("paymentPendingReconciliation", "updateMany",
      (args) => (args as { data?: { status?: string } }).data?.status === "needs_manual_review");

    expect(await reconcile({ db: failing.client })).toMatchObject({ errors: 1 });
    // Event and hold are already recorded: the payment is in the human queue.
    await expect(reconciliationRow(c)).resolves.toMatchObject({ status: "active" });
    expect(await db.webhookEvent.count({ where: { vendorId: t.vendor.id, status: "needs_manual_reconciliation" } })).toBe(1);

    expect(await reconcile({ now: new Date(Date.now() + paymentReconcileDelayMs(1) + MINUTE) })).toMatchObject({ manualReview: 1 });
    await expect(reconciliationRow(c)).resolves.toMatchObject({ status: "needs_manual_review", lastOutcome: "amount_mismatch" });
    // No second query and no second event.
    expect(provider.calls).toEqual([c.orderNumber]);
    expect(await db.webhookEvent.count({ where: { vendorId: t.vendor.id } })).toBe(1);
  });

  it("sends a human an order PayUni reported before and no longer finds, and warns once per run about not-found orders", async () => {
    const t = await tenant("vanished");
    const seen = await checkout(t);
    const never = await checkout(t);
    provider.answers.set(seen.orderNumber, { kind: "status", tradeNo: seen.tradeNo, tradeStatus: "0" });

    expect(await reconcile()).toMatchObject({ pending: 1, notFound: 1 });
    await expect(reconciliationRow(seen)).resolves.toMatchObject({ providerTradeSeen: true, lastOutcome: "provider_pending" });
    expect(monitoring.captureOperationalError).toHaveBeenCalledWith(expect.any(Error), expect.objectContaining({
      source: "payment_reconcile", operation: "not_found_summary", status: 1,
    }), expect.objectContaining({ level: "warning" }));

    provider.answers.set(seen.orderNumber, { kind: "not_found" });
    await db.paymentPendingReconciliation.updateMany({
      where: { paymentTransactionId: { in: [seen.transactionId, never.transactionId] } },
      data: { attempts: PAYMENT_RECONCILE_MAX_ATTEMPTS - 1, nextQueryAt: new Date(Date.now() - MINUTE) },
    });
    monitoring.captureOperationalError.mockClear();

    expect(await reconcile()).toMatchObject({ closed: 1, notFoundClosed: 1, manualReview: 1 });
    await expect(reconciliationRow(never)).resolves.toMatchObject({ status: "closed", lastOutcome: "not_found" });
    await expect(reconciliationRow(seen)).resolves.toMatchObject({ status: "needs_manual_review", lastOutcome: "not_found_after_trade_seen" });
    await expect(db.webhookEvent.findFirstOrThrow({ where: { vendorId: t.vendor.id } })).resolves.toMatchObject({
      eventId: `manual:reconcile:${seen.orderNumber}:not_found_after_trade_seen`, status: "needs_manual_reconciliation",
    });
    expect(monitoring.captureOperationalError).toHaveBeenCalledWith(expect.any(Error), expect.objectContaining({
      operation: "not_found_summary", status: 1,
    }), expect.anything());
  });

  it("sends a human a payment whose provider event stays claimed by someone else through the last query", async () => {
    const t = await tenant("stuck-event");
    const c = await checkout(t);
    provider.answers.set(c.orderNumber, { kind: "paid", tradeNo: c.tradeNo });
    await db.webhookEvent.create({
      data: { provider: "payuni", eventId: `${c.tradeNo}:1`, eventType: "paid", status: "retrying", payload: {} },
    });

    expect(await reconcile()).toMatchObject({ inProgress: 1 });
    await expect(reconciliationRow(c)).resolves.toMatchObject({ status: "active", lastOutcome: "event_in_progress" });

    await db.paymentPendingReconciliation.updateMany({
      where: { paymentTransactionId: c.transactionId },
      data: { attempts: PAYMENT_RECONCILE_MAX_ATTEMPTS - 1, nextQueryAt: new Date(Date.now() - MINUTE) },
    });
    expect(await reconcile()).toMatchObject({ manualReview: 1, inProgress: 0 });
    await expect(reconciliationRow(c)).resolves.toMatchObject({ status: "needs_manual_review", lastOutcome: "event_in_progress_exhausted" });
    expect((await db.paymentTransaction.findUniqueOrThrow({ where: { id: c.transactionId } })).status).toBe("pending");
  });

  it("sends a human a row still active after its payment left the scan window, unless PayUni never had the order", async () => {
    const t = await tenant("window-expired");
    const neverFound = await checkout(t);
    const broken = await checkout(t);
    const seenThenLost = await checkout(t);
    provider.answers.set(broken.orderNumber, { kind: "network" });
    expect(await reconcile()).toMatchObject({ notFound: 2, queryErrors: 1 });
    await db.paymentPendingReconciliation.updateMany({ where: { paymentTransactionId: seenThenLost.transactionId }, data: { providerTradeSeen: true } });
    // The job stopped running; three days pass.
    await db.paymentTransaction.updateMany({
      where: { id: { in: [neverFound.transactionId, broken.transactionId, seenThenLost.transactionId] } },
      data: { createdAt: new Date(Date.now() - 4 * 24 * 60 * MINUTE) },
    });

    expect(await reconcile()).toMatchObject({ windowExpired: 2, manualReview: 2, closed: 1, notFoundClosed: 1, candidates: 0 });

    // #664 m-7: never seen at PayUni and last answered "not found": no money, closed without a human.
    await expect(reconciliationRow(neverFound)).resolves.toMatchObject({ status: "closed", lastOutcome: "not_found" });
    for (const c of [broken, seenThenLost]) {
      await expect(reconciliationRow(c)).resolves.toMatchObject({ status: "needs_manual_review", lastOutcome: "window_expired" });
    }
    expect((await db.webhookEvent.findMany({ where: { vendorId: t.vendor.id }, orderBy: { eventId: "asc" } })).map((event) => [event.eventId, event.status])).toEqual(
      [broken, seenThenLost].map((c) => [`manual:reconcile:${c.orderNumber}:window_expired`, "needs_manual_reconciliation"])
        .sort(([left], [right]) => left!.localeCompare(right!)),
    );
    expect(provider.calls).toHaveLength(3);
    expect(await reconcile()).toMatchObject({ windowExpired: 0, closed: 0 });
  });

  it.each([
    { reason: "refunded_at_provider", answer: (c: Checkout): ProviderAnswer => ({ kind: "paid", tradeNo: c.tradeNo, extra: { RefundStatus: "2", RefundAmt: "5" } }) },
    { reason: "multiple_trades", answer: (c: Checkout): ProviderAnswer => ({ kind: "rows", rows: [{ tradeNo: `${c.tradeNo}-A`, tradeStatus: "2" }, { tradeNo: c.tradeNo, tradeStatus: "1" }] }) },
  ])("keeps a $reason reconciliation event open after a later paid Notify", async ({ reason, answer }) => {
    const t = await tenant(`kept-${reason}`);
    const c = await checkout(t);
    provider.answers.set(c.orderNumber, answer(c));
    expect(await reconcile()).toMatchObject({ manualReview: 1 });
    const manualEventId = `manual:reconcile:${c.orderNumber}:${reason}`;
    await expect(db.webhookEvent.findFirstOrThrow({ where: { eventId: manualEventId } })).resolves.toMatchObject({ status: "needs_manual_reconciliation" });

    expect((await paidNotify(c.orderNumber, c.tradeNo)).status).toBe(200);

    // #664 M-2: a paid event does not explain a refund or a second trade; a human still has to look.
    await expect(db.webhookEvent.findFirstOrThrow({ where: { eventId: manualEventId } })).resolves.toMatchObject({
      status: "needs_manual_reconciliation", processedAt: null,
    });
  });

  it("holds two trades on one order number only when one of them collected", async () => {
    const t = await tenant("multiple");
    const uncollected = await checkout(t);
    const collected = await checkout(t);
    provider.answers.set(uncollected.orderNumber, { kind: "rows", rows: [{ tradeNo: `${uncollected.tradeNo}-A`, tradeStatus: "2" }, { tradeNo: `${uncollected.tradeNo}-B`, tradeStatus: "3" }] });
    provider.answers.set(collected.orderNumber, { kind: "rows", rows: [{ tradeNo: `${collected.tradeNo}-A`, tradeStatus: "2" }, { tradeNo: `${collected.tradeNo}-B`, tradeStatus: "1" }] });

    expect(await reconcile()).toMatchObject({ manualReview: 2 });

    for (const c of [uncollected, collected]) await expect(reconciliationRow(c)).resolves.toMatchObject({ status: "needs_manual_review", lastOutcome: "multiple_trades" });
    expect((await db.paymentTransaction.findUniqueOrThrow({ where: { id: uncollected.transactionId } })).metadata).not.toHaveProperty("paymentManualReconciliation");
    expect((await db.paymentTransaction.findUniqueOrThrow({ where: { id: collected.transactionId } })).metadata).toMatchObject({ paymentManualReconciliation: { reason: "reconcile_multiple_trades" } });
  });

  it("closes its manual reconciliation event when the payment is later settled by a verified paid callback", async () => {
    const t = await tenant("resolved");
    const c = await checkout(t);
    provider.answers.set(c.orderNumber, { kind: "network" });
    await reconcile();
    await db.paymentPendingReconciliation.updateMany({
      where: { paymentTransactionId: c.transactionId },
      data: { attempts: PAYMENT_RECONCILE_MAX_ATTEMPTS - 1, nextQueryAt: new Date(Date.now() - MINUTE) },
    });
    expect(await reconcile()).toMatchObject({ manualReview: 1 });
    const manualEventId = `manual:reconcile:${c.orderNumber}:query_attempts_exhausted`;
    await expect(db.webhookEvent.findFirstOrThrow({ where: { eventId: manualEventId } })).resolves.toMatchObject({ status: "needs_manual_reconciliation" });

    expect((await paidNotify(c.orderNumber, c.tradeNo)).status).toBe(200);

    expect((await db.paymentTransaction.findUniqueOrThrow({ where: { id: c.transactionId } })).status).toBe("paid");
    await expect(db.webhookEvent.findFirstOrThrow({ where: { eventId: manualEventId } })).resolves.toMatchObject({
      status: "manual_reconciliation_resolved", processedAt: expect.any(Date),
    });
  });
});
