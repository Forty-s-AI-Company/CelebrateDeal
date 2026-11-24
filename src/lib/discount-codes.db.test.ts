import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { POST as admitCheckout } from "@/app/api/payments/checkout/admission/route";
import { POST as previewDiscountCode } from "@/app/api/payments/checkout/discount-code/route";
import { POST as checkout } from "@/app/api/payments/checkout/route";
import { CHECKOUT_ADMISSION_COOKIE } from "@/lib/checkout-admission";
import { getDb } from "@/lib/db";
import { createDiscountCode, DISCOUNT_CODE_PRODUCT_OPTION_LIMIT, discountCodeProductOptions, parseDiscountCodeForm, updateDiscountCode } from "@/lib/discount-code-admin";
import { DISCOUNT_CODE_LOOKUP_LIMITS, DISCOUNT_CODE_LOOKUP_WINDOW_MS, resolveThrottledDiscountCodeQuote } from "@/lib/discount-code-lookup-throttle";
import { DiscountCodeUnavailableError, reserveDiscountCodeRedemption, resolveDiscountCodeQuote } from "@/lib/discount-codes";
import { releaseExpiredInventoryReservations } from "@/lib/inventory-reservations";
import { AUTOMATION_VOUCHER_COOKIE, createInteractionBearer, hashInteractionBearer } from "@/lib/live-interaction";
import { FLASH_SALE_COOKIE } from "@/lib/live-flash-sale";
import { PaymentWebhookPayload, processPaymentWebhook } from "@/lib/payment-webhooks";
import { encodeAttributionCookie } from "@/lib/team-funnel-attribution";

// External delivery is isolated; payment, order, inventory, commission and refund run for real.
vi.mock("@/lib/commerce-order-email", () => ({ ensureCommerceOrderPaidDelivery: vi.fn() }));
// The per-IP limiter is not under test (A4-03 owns it); without this, the
// default in-memory provider would cap these synthetic same-IP requests and
// the file would depend on CI's RATE_LIMIT_PROVIDER (review n-1). The
// vendor + product lookup throttle below is database-backed and stays real.
vi.mock("@/lib/rate-limit", () => ({ checkRateLimit: vi.fn(async () => null) }));
vi.mock("@/lib/taiwan-electronic-invoice", () => ({ reconcileElectronicInvoiceAfterPayment: vi.fn() }));

const ORIGIN = "http://127.0.0.1:31027";
const db = getDb();
const vendors: string[] = [];

beforeEach(() => {
  vi.stubEnv("CSRF_SECRET", "synthetic-discount-code-db-secret-over-thirty-two-bytes");
  vi.stubEnv("PAYMENT_PROVIDER", "demo");
  vi.stubEnv("NEXT_PUBLIC_APP_URL", ORIGIN);
});

afterEach(async () => {
  vi.restoreAllMocks();
  const ids = vendors.splice(0);
  // Redemptions restrict deleting their code/order/payment rows; drop them first.
  await db.discountCodeRedemption.deleteMany({ where: { vendorId: { in: ids } } });
  await db.vendor.deleteMany({ where: { id: { in: ids } } });
  vi.unstubAllEnvs();
});

async function vendorWithProducts(label: string) {
  const suffix = randomUUID();
  const vendor = await db.vendor.create({ data: { name: `Synthetic ${label}`, slug: suffix, email: `${suffix}@example.test`, passwordHash: "synthetic-only" } });
  vendors.push(vendor.id);
  const product = await db.product.create({ data: { vendorId: vendor.id, name: "Synthetic course box", slug: `p-${suffix}`, priceCents: 100_000, inventory: 20, fulfillmentTypeConfirmed: true } });
  const bump = await db.product.create({ data: { vendorId: vendor.id, name: "Synthetic bump", slug: `b-${suffix}`, priceCents: 30_000, inventory: 20, fulfillmentTypeConfirmed: true } });
  return { vendor, product, bump };
}

function form(values: Record<string, string | string[]>) {
  const data = new FormData();
  for (const [key, value] of Object.entries(values)) {
    for (const item of Array.isArray(value) ? value : [value]) data.append(key, item);
  }
  return data;
}

async function createCode(vendorId: string, values: Record<string, string | string[]> = {}) {
  const parsed = parseDiscountCodeForm(form({ code: "Save200", discountType: "fixed_amount", discountValue: "200", isActive: "on", ...values }), "Asia/Taipei");
  if (!parsed.ok) throw new Error(parsed.error);
  return createDiscountCode(db, vendorId, parsed.draft);
}

function post(path: string, body: unknown, cookie = "") {
  return new Request(`${ORIGIN}${path}`, {
    method: "POST",
    headers: { origin: ORIGIN, "content-type": "application/json", "x-celebratedeal-client": "web", ...(cookie ? { cookie } : {}) },
    body: JSON.stringify(body),
  });
}

const shipping = { recipientName: "Synthetic buyer", phone: "0912345678", countryCode: "TW", postalCode: "100", administrativeArea: "台北市", locality: "中正區", addressLine1: "合成測試路 1 號" };

async function admit(vendorId: string, productId: string, cookie = "", extra: Record<string, unknown> = {}) {
  const response = await admitCheckout(post("/api/payments/checkout/admission", { vendorId, productId, ...extra }, cookie));
  expect(response.status).toBe(200);
  const body = await response.json() as { admissionToken: string; idempotencyKey: string; offer?: unknown };
  const session = response.cookies.get(CHECKOUT_ADMISSION_COOKIE)!;
  return { ...body, cookie: [cookie, `${session.name}=${session.value}`].filter(Boolean).join("; ") };
}

async function buy(input: { vendorId: string; productId: string; email?: string; discountCode?: string; discountCodeToken?: string; expectedDiscountAmountCents?: number; orderBumpProductId?: string; cookie?: string }) {
  const admission = await admit(input.vendorId, input.productId, input.cookie);
  const response = await checkout(post("/api/payments/checkout", {
    vendorId: input.vendorId,
    productId: input.productId,
    admissionToken: admission.admissionToken,
    idempotencyKey: admission.idempotencyKey,
    buyer: { name: "Synthetic buyer", email: input.email ?? `${randomUUID()}@example.test`, phone: "0912345678" },
    shipping,
    ...(input.orderBumpProductId ? { orderBump: { productId: input.orderBumpProductId } } : {}),
    ...(input.discountCode !== undefined ? { discountCode: input.discountCode } : {}),
    ...(input.discountCodeToken !== undefined ? { discountCodeToken: input.discountCodeToken } : {}),
    ...(input.expectedDiscountAmountCents !== undefined ? { expectedDiscountAmountCents: input.expectedDiscountAmountCents } : {}),
  }, admission.cookie));
  return { response, admission, body: await response.clone().json() as Record<string, unknown> };
}

async function webhook(vendorId: string, orderNumber: string, eventType: "paid" | "failed" | "partially_refunded" | "refunded", amounts: { grossAmountCents?: number; refundAmountCents?: number } = {}) {
  await processPaymentWebhook(PaymentWebhookPayload.parse({
    provider: "demo", eventId: `${eventType}-${randomUUID()}`, eventType, vendorId, orderNumber, currency: "TWD", ...amounts,
  }));
}

async function codeRow(id: string) {
  return db.discountCode.findUniqueOrThrow({ where: { id } });
}

describe("A4-01 discount code checkout (real admission, checkout and payment pipeline)", () => {
  it("prices from the server record and snapshots the original price, code and discount on the order", async () => {
    const f = await vendorWithProducts("snapshot");
    const created = await createCode(f.vendor.id);
    const { response, body } = await buy({ vendorId: f.vendor.id, productId: f.product.id, discountCode: "save200", expectedDiscountAmountCents: 20_000, orderBumpProductId: f.bump.id });
    expect(response.status).toBe(200);
    // Primary NT$1,000 − NT$200 + bump NT$300 at full price.
    expect(body).toMatchObject({ amountCents: 110_000, currency: "TWD" });
    const payment = await db.paymentTransaction.findFirstOrThrow({ where: { vendorId: f.vendor.id } });
    expect(payment).toMatchObject({ grossAmountCents: 110_000, status: "pending" });
    expect(payment.metadata).toMatchObject({ discountAmountCents: 20_000, discountCode: { id: created.id, code: "Save200", normalizedCode: "SAVE200", discountAmountCents: 20_000 } });
    const order = await db.commerceOrder.findFirstOrThrow({ where: { vendorId: f.vendor.id } });
    expect(order).toMatchObject({ subtotalAmountCents: 130_000, totalAmountCents: 110_000 });
    expect(await db.discountCodeRedemption.findUniqueOrThrow({ where: { vendorId_orderId: { vendorId: f.vendor.id, orderId: order.id } } })).toMatchObject({
      discountCodeId: created.id, paymentTransactionId: payment.id, status: "reserved", codeSnapshot: "Save200", discountType: "fixed_amount",
      discountValue: 20_000, subtotalAmountCents: 130_000, discountAmountCents: 20_000, totalAmountCents: 110_000, currency: "TWD",
    });
    expect((await codeRow(created.id)).redemptionCount).toBe(1);

    await webhook(f.vendor.id, payment.orderNumber!, "paid", { grossAmountCents: 110_000 });
    expect(await db.discountCodeRedemption.findFirstOrThrow({ where: { orderId: order.id } })).toMatchObject({ status: "redeemed" });
    expect((await codeRow(created.id)).redemptionCount).toBe(1);
  });

  it("refuses an order when the shown discount no longer matches the server's", async () => {
    const f = await vendorWithProducts("expected");
    await createCode(f.vendor.id);
    const { response, body } = await buy({ vendorId: f.vendor.id, productId: f.product.id, discountCode: "SAVE200", expectedDiscountAmountCents: 30_000 });
    expect(response.status).toBe(409);
    expect(body).toMatchObject({ code: "DISCOUNT_CODE_CHANGED" });
    expect(await db.commerceOrder.count({ where: { vendorId: f.vendor.id } })).toBe(0);
  });

  it("refuses a quote made before a merchant edit (revision) inside the checkout transaction", async () => {
    const f = await vendorWithProducts("revision");
    const created = await createCode(f.vendor.id);
    const quote = await resolveDiscountCodeQuote(db, "SAVE200", { vendorId: f.vendor.id, productId: f.product.id, primaryPriceCents: 100_000, additionalAmountCents: 0, currency: "TWD", now: new Date() });
    if (!quote.ok) throw new Error("quote");
    const edited = parseDiscountCodeForm(form({ code: "Save200", discountType: "fixed_amount", discountValue: "500", isActive: "on" }), "Asia/Taipei");
    if (!edited.ok) throw new Error(edited.error);
    await updateDiscountCode(db, f.vendor.id, created.id, edited.draft);
    await expect(db.$transaction((tx) => reserveDiscountCodeRedemption(tx, {
      quote: quote.quote, orderId: "unused", paymentTransactionId: "unused", buyerKeyHash: "unused", now: new Date(),
    }))).rejects.toEqual(new DiscountCodeUnavailableError("changed"));
    expect((await codeRow(created.id)).redemptionCount).toBe(0);
  });
});

describe("A4-01 tenant isolation", () => {
  it("answers vendor A's code on vendor B's product exactly like an unknown code, at preview and at checkout", async () => {
    const a = await vendorWithProducts("tenant A");
    const b = await vendorWithProducts("tenant B");
    const codeA = await createCode(a.vendor.id, { code: "ONLYA1" });

    const preview = async (code: string) => previewDiscountCode(post("/api/payments/checkout/discount-code", { vendorId: b.vendor.id, productId: b.product.id, discountCode: code }));
    const foreign = await preview("onlya1");
    const unknown = await preview("NOSUCH1");
    expect(foreign.status).toBe(409);
    expect([foreign.status, await foreign.json()]).toEqual([unknown.status, await unknown.json()]);

    const crossed = await previewDiscountCode(post("/api/payments/checkout/discount-code", { vendorId: a.vendor.id, productId: b.product.id, discountCode: "ONLYA1" }));
    expect(crossed.status).toBe(404);

    const foreignCheckout = await buy({ vendorId: b.vendor.id, productId: b.product.id, discountCode: "ONLYA1" });
    const unknownCheckout = await buy({ vendorId: b.vendor.id, productId: b.product.id, discountCode: "NOSUCH1" });
    expect(foreignCheckout.response.status).toBe(409);
    expect([foreignCheckout.response.status, foreignCheckout.body]).toEqual([unknownCheckout.response.status, unknownCheckout.body]);
    expect(await db.commerceOrder.count({ where: { vendorId: { in: [a.vendor.id, b.vendor.id] } } })).toBe(0);
    expect((await codeRow(codeA.id)).redemptionCount).toBe(0);
  });

  it("never links another vendor's product to a code", async () => {
    const a = await vendorWithProducts("links A");
    const b = await vendorWithProducts("links B");
    await expect(createCode(a.vendor.id, { appliesTo: "selected", productIds: [b.product.id] })).rejects.toMatchObject({ code: "invalid_products" });
    await expect(db.discountCodeProduct.create({ data: { vendorId: a.vendor.id, discountCodeId: (await createCode(a.vendor.id, { code: "LINKA1" })).id, productId: b.product.id } }))
      .rejects.toMatchObject({ code: "P2003" });
    const codeB = await createCode(b.vendor.id, { code: "LINKB1" });
    await expect(updateDiscountCode(db, a.vendor.id, codeB.id, (() => {
      const parsed = parseDiscountCodeForm(form({ code: "LINKB1", discountType: "percentage", discountValue: "90", isActive: "on" }), "Asia/Taipei");
      if (!parsed.ok) throw new Error(parsed.error);
      return parsed.draft;
    })())).rejects.toMatchObject({ code: "not_found" });
    expect(await codeRow(codeB.id)).toMatchObject({ discountType: "fixed_amount", revision: 1 });
  });
});

describe("A4-01 guessing limit (review m-1, MJ-1, MN-1, MN-2)", () => {
  const preview = (vendorId: string, productId: string, code: string) =>
    previewDiscountCode(post("/api/payments/checkout/discount-code", { vendorId, productId, discountCode: code }));
  const windowStart = () => new Date(Math.floor(Date.now() / DISCOUNT_CODE_LOOKUP_WINDOW_MS) * DISCOUNT_CODE_LOOKUP_WINDOW_MS);
  const counter = async (vendorId: string, scopeKey: string) =>
    (await db.discountCodeLookupThrottle.findUnique({ where: { vendorId_scopeKey_windowStart: { vendorId, scopeKey, windowStart: windowStart() } } }))?.failureCount ?? 0;
  /** Puts a counter right below its cap, as a long stream of earlier wrong guesses would. */
  const prefill = (vendorId: string, scopeKey: string, failureCount: number) => db.discountCodeLookupThrottle.upsert({
    where: { vendorId_scopeKey_windowStart: { vendorId, scopeKey, windowStart: windowStart() } },
    create: { vendorId, scopeKey, windowStart: windowStart(), failureCount },
    update: { failureCount },
  });

  it("counts only codes that do not exist: hits, used-up and below-minimum codes leave the counters alone", async () => {
    const f = await vendorWithProducts("counts");
    await createCode(f.vendor.id);
    await createCode(f.vendor.id, { code: "USEDUP1", maxRedemptions: "1" });
    await createCode(f.vendor.id, { code: "BIGSPEND", minSubtotal: "50000" });
    expect((await buy({ vendorId: f.vendor.id, productId: f.product.id, discountCode: "USEDUP1" })).response.status).toBe(200);
    for (const code of ["SAVE200", "save200", "USEDUP1", "BIGSPEND"]) await preview(f.vendor.id, f.product.id, code);
    expect(await counter(f.vendor.id, `product:${f.product.id}`)).toBe(0);
    expect(await counter(f.vendor.id, "vendor")).toBe(0);
    expect((await preview(f.vendor.id, f.product.id, "NOSUCH1")).status).toBe(409);
    expect(await counter(f.vendor.id, `product:${f.product.id}`)).toBe(1);
    expect(await counter(f.vendor.id, "vendor")).toBe(1);
  });

  it("keeps a live stream's correct code working when many buyers type it at once next to a few typos (review MJ-1)", async () => {
    const f = await vendorWithProducts("live stream");
    await createCode(f.vendor.id, { code: "LIVE2026" });
    const correct = Array.from({ length: 100 }, (_, index) => preview(f.vendor.id, f.product.id, index % 2 ? "live2026" : "LIVE2026"));
    const wrong = ["LIVE2025", "LIVE2O26", "LIV2026", "LIVE20266", "LIVE-2026"].map((code) => preview(f.vendor.id, f.product.id, code));
    const [correctResponses, wrongResponses] = await Promise.all([Promise.all(correct), Promise.all(wrong)]);
    expect(correctResponses.map((response) => response.status)).toEqual(Array(100).fill(200));
    expect(wrongResponses.map((response) => response.status)).toEqual(Array(5).fill(409));
    // Only the five typos stay counted; every correct lookup was refunded.
    expect(await counter(f.vendor.id, `product:${f.product.id}`)).toBe(5);
    expect(await counter(f.vendor.id, "vendor")).toBe(5);
    // Buyers who previewed check out with their token.
    const token = (await correctResponses[0]!.json() as { token: string }).token;
    expect((await buy({ vendorId: f.vendor.id, productId: f.product.id, discountCode: "LIVE2026", discountCodeToken: token })).response.status).toBe(200);
  });

  it("locks a product once its cap is reached (even the right code, 429), while a preview token still checks out and token-less checkout stays throttled", async () => {
    const a = await vendorWithProducts("lock A");
    const b = await vendorWithProducts("lock B");
    await createCode(a.vendor.id);
    await createCode(b.vendor.id);
    const earlier = await preview(a.vendor.id, a.product.id, "SAVE200");
    const token = (await earlier.json() as { token: string }).token;

    await prefill(a.vendor.id, `product:${a.product.id}`, DISCOUNT_CODE_LOOKUP_LIMITS.product - 1);
    expect((await preview(a.vendor.id, a.product.id, "GUESS99")).status).toBe(409);
    const blocked = await preview(a.vendor.id, a.product.id, "SAVE200");
    expect(blocked.status).toBe(429);
    expect(await blocked.json()).toMatchObject({ code: "DISCOUNT_CODE_TRY_LATER" });
    expect(await counter(a.vendor.id, `product:${a.product.id}`)).toBe(DISCOUNT_CODE_LOOKUP_LIMITS.product);

    const tokenless = await buy({ vendorId: a.vendor.id, productId: a.product.id, discountCode: "SAVE200" });
    expect([tokenless.response.status, tokenless.body.code]).toEqual([429, "DISCOUNT_CODE_TRY_LATER"]);
    const forged = await buy({ vendorId: a.vendor.id, productId: a.product.id, discountCode: "SAVE200", discountCodeToken: `${token.slice(0, -2)}xx` });
    expect(forged.response.status).toBe(429);
    const otherCode = await buy({ vendorId: a.vendor.id, productId: a.product.id, discountCode: "OTHER10", discountCodeToken: token });
    expect(otherCode.response.status).toBe(429);
    const withToken = await buy({ vendorId: a.vendor.id, productId: a.product.id, discountCode: "save200", discountCodeToken: token, expectedDiscountAmountCents: 20_000 });
    expect([withToken.response.status, withToken.body.amountCents]).toEqual([200, 80_000]);
    // A token never moves the price: the server row does.
    expect((await db.paymentTransaction.findFirstOrThrow({ where: { vendorId: a.vendor.id } })).grossAmountCents).toBe(80_000);

    // Checkout without a code, another product of A and vendor B are unaffected.
    expect((await buy({ vendorId: a.vendor.id, productId: a.product.id })).response.status).toBe(200);
    expect((await preview(a.vendor.id, a.bump.id, "SAVE200")).status).toBe(200);
    expect((await preview(b.vendor.id, b.product.id, "SAVE200")).status).toBe(200);
  });

  it("refuses a preview token issued before the merchant edited the code", async () => {
    const f = await vendorWithProducts("token revision");
    const created = await createCode(f.vendor.id);
    const token = (await (await preview(f.vendor.id, f.product.id, "SAVE200")).json() as { token: string }).token;
    const edited = parseDiscountCodeForm(form({ code: "Save200", discountType: "fixed_amount", discountValue: "300", isActive: "on" }), "Asia/Taipei");
    if (!edited.ok) throw new Error(edited.error);
    await updateDiscountCode(db, f.vendor.id, created.id, edited.draft);
    const stale = await buy({ vendorId: f.vendor.id, productId: f.product.id, discountCode: "SAVE200", discountCodeToken: token });
    expect([stale.response.status, stale.body.code]).toEqual([409, "DISCOUNT_CODE_CHANGED"]);
    expect(await db.commerceOrder.count({ where: { vendorId: f.vendor.id } })).toBe(0);
  });

  it("applies the vendor-wide cap across products (review MN-2)", async () => {
    const f = await vendorWithProducts("vendor cap");
    await createCode(f.vendor.id);
    await prefill(f.vendor.id, "vendor", DISCOUNT_CODE_LOOKUP_LIMITS.vendor - 1);
    expect((await preview(f.vendor.id, f.product.id, "GUESS01")).status).toBe(409);
    expect((await preview(f.vendor.id, f.bump.id, "SAVE200")).status).toBe(429);
    // The refused product debit was given back.
    expect(await counter(f.vendor.id, `product:${f.bump.id}`)).toBe(0);
  });

  it("never reads the code table more often than the cap under concurrent wrong guesses (review MN-1)", async () => {
    const f = await vendorWithProducts("concurrent guesses");
    await createCode(f.vendor.id);
    const limits = { product: 5, vendor: 1_000 };
    let lookups = 0;
    // The real client for the counters; the code table read is counted on the way through.
    const counting = {
      $queryRaw: db.$queryRaw.bind(db),
      discountCodeLookupThrottle: db.discountCodeLookupThrottle,
      discountCode: { findUnique: (args: Parameters<typeof db.discountCode.findUnique>[0]) => { lookups += 1; return db.discountCode.findUnique(args); } },
    };
    const context = { vendorId: f.vendor.id, productId: f.product.id, primaryPriceCents: 100_000, additionalAmountCents: 0, currency: "TWD", now: new Date() };
    const results = await Promise.all(Array.from({ length: 30 }, (_, index) =>
      resolveThrottledDiscountCodeQuote(counting as never, `WRONG${String(index).padStart(2, "0")}`, context, limits)));
    expect(results.filter((result) => !result.ok && result.reason === "invalid")).toHaveLength(5);
    expect(results.filter((result) => !result.ok && result.reason === "throttled")).toHaveLength(25);
    expect(lookups).toBe(5);
    expect(await counter(f.vendor.id, `product:${f.product.id}`)).toBe(5);
    expect(await counter(f.vendor.id, "vendor")).toBe(5);
  });
});

describe("A4-01 back office product options (review m-4)", () => {
  it("keeps a linked product beyond the 200 newest in the edit form", async () => {
    const f = await vendorWithProducts("options");
    // The fixture's product is the oldest; 200 newer priced products push it off the list.
    await db.product.createMany({ data: Array.from({ length: DISCOUNT_CODE_PRODUCT_OPTION_LIMIT }, (_, index) => ({
      vendorId: f.vendor.id, name: `Newer ${index}`, slug: `newer-${index}-${randomUUID()}`, priceCents: 1_000, inventory: 1,
      fulfillmentTypeConfirmed: true, createdAt: new Date(Date.now() + 60_000 + index),
    })) });
    const created = await createCode(f.vendor.id, { appliesTo: "selected", productIds: [f.product.id] });
    const linked = await db.discountCodeProduct.findMany({ where: { vendorId: f.vendor.id, discountCodeId: created.id }, select: { productId: true } });
    expect((await discountCodeProductOptions(db, f.vendor.id)).map((item) => item.id)).not.toContain(f.product.id);
    const options = await discountCodeProductOptions(db, f.vendor.id, linked.map((link) => link.productId));
    expect(options.map((item) => item.id)).toContain(f.product.id);
    expect(options).toHaveLength(DISCOUNT_CODE_PRODUCT_OPTION_LIMIT + 1);
  });

  it("never shows another vendor's product even when its id is passed as linked", async () => {
    const a = await vendorWithProducts("options A");
    const b = await vendorWithProducts("options B");
    const options = await discountCodeProductOptions(db, a.vendor.id, [b.product.id]);
    expect(options.map((item) => item.id)).not.toContain(b.product.id);
  });
});

describe("A4-01 usage limits under concurrency", () => {
  it("never exceeds the total limit when buyers check out at the same time", async () => {
    const f = await vendorWithProducts("total limit");
    const created = await createCode(f.vendor.id, { maxRedemptions: "2" });
    const results = await Promise.all(Array.from({ length: 6 }, () => buy({ vendorId: f.vendor.id, productId: f.product.id, discountCode: "SAVE200" })));
    const statuses = results.map((result) => result.response.status).sort();
    expect(statuses.filter((status) => status === 200)).toHaveLength(2);
    for (const result of results.filter((item) => item.response.status !== 200)) {
      expect(result.response.status).toBe(409);
      expect(result.body).toMatchObject({ code: "DISCOUNT_CODE_USAGE_LIMIT" });
    }
    expect((await codeRow(created.id)).redemptionCount).toBe(2);
    expect(await db.discountCodeRedemption.count({ where: { discountCodeId: created.id } })).toBe(2);
    expect(await db.commerceOrder.count({ where: { vendorId: f.vendor.id } })).toBe(2);
  });

  it("never exceeds the per-buyer limit for one e-mail, ignoring its case", async () => {
    const f = await vendorWithProducts("buyer limit");
    const created = await createCode(f.vendor.id, { maxRedemptionsPerBuyer: "1" });
    const results = await Promise.all(["Same@Example.test", "same@example.test", " SAME@example.TEST"].map((email) =>
      buy({ vendorId: f.vendor.id, productId: f.product.id, discountCode: "SAVE200", email: email.trim() })));
    expect(results.filter((result) => result.response.status === 200)).toHaveLength(1);
    // Answered like the total limit, so the response never confirms the e-mail used it (review m-2).
    expect(results.filter((result) => result.body.code === "DISCOUNT_CODE_USAGE_LIMIT")).toHaveLength(2);
    expect((await codeRow(created.id)).redemptionCount).toBe(1);
    // A different buyer can still use it.
    expect((await buy({ vendorId: f.vendor.id, productId: f.product.id, discountCode: "SAVE200" })).response.status).toBe(200);
  });
});

describe("A4-01 release, late payment and refunds", () => {
  it("gives the use back when the payment fails, so the next buyer can use the last one", async () => {
    const f = await vendorWithProducts("failed");
    const created = await createCode(f.vendor.id, { maxRedemptions: "1" });
    expect((await buy({ vendorId: f.vendor.id, productId: f.product.id, discountCode: "SAVE200" })).response.status).toBe(200);
    expect((await buy({ vendorId: f.vendor.id, productId: f.product.id, discountCode: "SAVE200" })).body).toMatchObject({ code: "DISCOUNT_CODE_USAGE_LIMIT" });
    const payment = await db.paymentTransaction.findFirstOrThrow({ where: { vendorId: f.vendor.id } });
    await webhook(f.vendor.id, payment.orderNumber!, "failed");
    expect(await db.discountCodeRedemption.findFirstOrThrow({ where: { paymentTransactionId: payment.id } })).toMatchObject({ status: "released", releaseReason: "payment_failed" });
    expect((await codeRow(created.id)).redemptionCount).toBe(0);
    expect((await buy({ vendorId: f.vendor.id, productId: f.product.id, discountCode: "SAVE200" })).response.status).toBe(200);
    expect((await codeRow(created.id)).redemptionCount).toBe(1);
  });

  it("releases an expired unpaid order and re-counts a late paid callback even past the limit", async () => {
    const f = await vendorWithProducts("expired");
    const created = await createCode(f.vendor.id, { maxRedemptions: "1" });
    expect((await buy({ vendorId: f.vendor.id, productId: f.product.id, discountCode: "SAVE200" })).response.status).toBe(200);
    const first = await db.paymentTransaction.findFirstOrThrow({ where: { vendorId: f.vendor.id } });
    await releaseExpiredInventoryReservations(100, new Date(Date.now() + 2 * 60 * 60 * 1000));
    expect(await db.discountCodeRedemption.findFirstOrThrow({ where: { paymentTransactionId: first.id } })).toMatchObject({ status: "released", releaseReason: "payment_expired" });
    expect((await codeRow(created.id)).redemptionCount).toBe(0);
    expect((await buy({ vendorId: f.vendor.id, productId: f.product.id, discountCode: "SAVE200" })).response.status).toBe(200);
    expect((await codeRow(created.id)).redemptionCount).toBe(1);

    // PayUni may still collect the expired order: the buyer paid the discounted price, so it counts.
    await webhook(f.vendor.id, first.orderNumber!, "paid", { grossAmountCents: 80_000 });
    expect(await db.discountCodeRedemption.findFirstOrThrow({ where: { paymentTransactionId: first.id } })).toMatchObject({ status: "redeemed" });
    expect((await codeRow(created.id)).redemptionCount).toBe(2);
  });

  it("re-counts a payment that arrives after a failure, even past the per-buyer limit (review m-3)", async () => {
    const f = await vendorWithProducts("failed then paid");
    const created = await createCode(f.vendor.id, { maxRedemptionsPerBuyer: "1" });
    const email = "again@example.test";
    expect((await buy({ vendorId: f.vendor.id, productId: f.product.id, discountCode: "SAVE200", email })).response.status).toBe(200);
    const first = await db.paymentTransaction.findFirstOrThrow({ where: { vendorId: f.vendor.id } });
    await webhook(f.vendor.id, first.orderNumber!, "failed");
    expect(await db.discountCodeRedemption.findFirstOrThrow({ where: { paymentTransactionId: first.id } })).toMatchObject({ status: "released" });

    // The released use lets the same buyer check out again.
    expect((await buy({ vendorId: f.vendor.id, productId: f.product.id, discountCode: "SAVE200", email })).response.status).toBe(200);
    // PayUni then reports the first, failed trade as paid: money was collected at the discounted price.
    await webhook(f.vendor.id, first.orderNumber!, "paid", { grossAmountCents: 80_000 });
    expect(await db.commerceOrder.findFirstOrThrow({ where: { primaryPaymentTransactionId: first.id } })).toMatchObject({ status: "paid" });
    expect(await db.discountCodeRedemption.findFirstOrThrow({ where: { paymentTransactionId: first.id } })).toMatchObject({ status: "redeemed" });
    const buyerUses = await db.discountCodeRedemption.count({ where: { discountCodeId: created.id, status: { in: ["reserved", "redeemed"] } } });
    expect(buyerUses).toBe(2);
    expect((await codeRow(created.id)).redemptionCount).toBe(2);
  });

  it("computes commission on the discounted amount and keeps the use through partial and full refunds", async () => {
    const f = await vendorWithProducts("commission");
    // The append-only commission ledger blocks deleting this vendor; the
    // disposable test database keeps it (as merchant-affiliate-policy.db.test.ts does).
    vendors.splice(vendors.indexOf(f.vendor.id), 1);
    const created = await createCode(f.vendor.id, { discountType: "percentage", discountValue: "25" });
    const affiliate = await db.affiliate.create({ data: { vendorId: f.vendor.id, name: "Synthetic promoter", code: `PROMO${randomUUID().slice(0, 8).toUpperCase()}`, commissionRateBps: 1_000 } });
    const visitorId = randomUUID();
    const click = await db.affiliateClick.create({ data: { vendorId: f.vendor.id, affiliateId: affiliate.id, referralCode: affiliate.code, visitorId, landingPath: "/" } });
    const attribution = `celebratedeal_attribution=${encodeAttributionCookie({ clickId: click.id, visitorId, issuedAt: Date.now() })}; celebratedeal_visitor=${visitorId}`;
    const { response } = await buy({ vendorId: f.vendor.id, productId: f.product.id, discountCode: "SAVE200", cookie: attribution });
    expect(response.status).toBe(200);
    const payment = await db.paymentTransaction.findFirstOrThrow({ where: { vendorId: f.vendor.id } });
    expect(payment.grossAmountCents).toBe(75_000);
    await webhook(f.vendor.id, payment.orderNumber!, "paid", { grossAmountCents: 75_000 });

    const commission = await db.affiliateCommission.findFirstOrThrow({ where: { vendorId: f.vendor.id, affiliateId: affiliate.id } });
    // 10% of the NT$750 actually paid, not of the NT$1,000 list price.
    expect(commission).toMatchObject({ orderAmountCents: 75_000, commissionBaseAmountCents: 75_000, commissionAmountCents: 7_500 });

    await webhook(f.vendor.id, payment.orderNumber!, "partially_refunded", { refundAmountCents: 30_000 });
    const afterPartial = await db.affiliateCommissionLedgerEntry.aggregate({ where: { affiliateCommissionId: commission.id }, _sum: { amountCents: true } });
    // The same proportional rule as any other order: 30,000 / 75,000 of 7,500.
    expect(afterPartial._sum.amountCents).toBe(4_500);
    await webhook(f.vendor.id, payment.orderNumber!, "refunded", { refundAmountCents: 45_000 });
    const afterFull = await db.affiliateCommissionLedgerEntry.aggregate({ where: { affiliateCommissionId: commission.id }, _sum: { amountCents: true } });
    expect(afterFull._sum.amountCents).toBe(0);
    expect((await db.affiliateCommission.findUniqueOrThrow({ where: { id: commission.id } })).status).toBe("void");

    // Refunds never give the use back.
    expect(await db.discountCodeRedemption.findFirstOrThrow({ where: { paymentTransactionId: payment.id } })).toMatchObject({ status: "redeemed" });
    expect((await codeRow(created.id)).redemptionCount).toBe(1);
  });
});

describe("A4-01 one promotion per order", () => {
  it("uses the typed code and leaves an automation voucher unused", async () => {
    const f = await vendorWithProducts("voucher");
    await createCode(f.vendor.id);
    const bearer = createInteractionBearer();
    const grant = await db.automationVoucherGrant.create({ data: {
      vendorId: f.vendor.id, customerKeyHash: "synthetic", productId: f.product.id, claimTokenHash: hashInteractionBearer(bearer),
      discountType: "fixed", discountValue: 50_000, expiresAt: new Date(Date.now() + 60 * 60 * 1000),
    } });
    const voucherCookie = `${AUTOMATION_VOUCHER_COOKIE}=${bearer}`;
    const withCode = await buy({ vendorId: f.vendor.id, productId: f.product.id, discountCode: "SAVE200", cookie: voucherCookie });
    expect(withCode.body).toMatchObject({ amountCents: 80_000 });
    expect((await db.automationVoucherGrant.findUniqueOrThrow({ where: { id: grant.id } })).usedOrderId).toBeNull();
    // Without a code the voucher still applies on a later order.
    const withoutCode = await buy({ vendorId: f.vendor.id, productId: f.product.id, cookie: voucherCookie });
    expect(withoutCode.body).toMatchObject({ amountCents: 50_000 });
    expect((await db.automationVoucherGrant.findUniqueOrThrow({ where: { id: grant.id } })).usedOrderId).not.toBeNull();
  });

  it("refuses a code together with a flash sale and writes nothing", async () => {
    const f = await vendorWithProducts("flash sale");
    const created = await createCode(f.vendor.id);
    const live = await db.live.create({ data: { vendorId: f.vendor.id, title: "Synthetic live", slug: randomUUID(), scheduledAt: new Date(), status: "live" } });
    await db.liveProduct.create({ data: { vendorId: f.vendor.id, liveId: live.id, productId: f.product.id } });
    const run = await db.liveInteractionRun.create({ data: {
      vendorId: f.vendor.id, liveId: live.id, source: "manual", eventType: "flash_sale", title: "Sale",
      startsAt: new Date(Date.now() - 1000), endsAt: new Date(Date.now() + 60_000),
      configuration: { kind: "flash_sale", durationSec: 60, productId: f.product.id, salePriceCents: 60_000, originalPriceCents: 100_000, stockLimit: 1 },
    } });
    const bearer = createInteractionBearer();
    await db.liveInteractionResponse.create({ data: {
      vendorId: f.vendor.id, liveId: live.id, runId: run.id, productId: f.product.id, eventType: "flash_sale", participantHash: randomUUID(),
      value: "buy", claimTokenHash: hashInteractionBearer(bearer), expiresAt: run.endsAt,
    } });
    const saleCookie = `${FLASH_SALE_COOKIE}=${bearer}`;
    const admission = await admit(f.vendor.id, f.product.id, saleCookie, { flashSaleRunId: run.id });
    expect(admission.offer).toMatchObject({ priceCents: 60_000 });
    const response = await checkout(post("/api/payments/checkout", {
      vendorId: f.vendor.id, productId: f.product.id, admissionToken: admission.admissionToken, idempotencyKey: admission.idempotencyKey,
      buyer: { name: "Synthetic buyer", email: "sale@example.test", phone: "0912345678" }, shipping, discountCode: "SAVE200",
    }, admission.cookie));
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ code: "DISCOUNT_CODE_NOT_COMBINABLE" });
    expect(await db.commerceOrder.count({ where: { vendorId: f.vendor.id } })).toBe(0);
    expect((await codeRow(created.id)).redemptionCount).toBe(0);
  });

  it("replays the stored order only for the same code", async () => {
    const f = await vendorWithProducts("replay");
    await createCode(f.vendor.id);
    await createCode(f.vendor.id, { code: "OTHER10", discountValue: "100" });
    const first = await buy({ vendorId: f.vendor.id, productId: f.product.id, discountCode: "SAVE200", email: "replay@example.test" });
    expect(first.response.status).toBe(200);
    const replay = (body: Record<string, unknown>) => checkout(post("/api/payments/checkout", {
      vendorId: f.vendor.id, productId: f.product.id, admissionToken: first.admission.admissionToken, idempotencyKey: first.admission.idempotencyKey,
      buyer: { name: "Synthetic buyer", email: "replay@example.test", phone: "0912345678" }, shipping, ...body,
    }, first.admission.cookie));
    expect((await replay({ discountCode: "other10" })).status).toBe(409);
    const same = await replay({ discountCode: "save200" });
    expect(same.status).toBe(200);
    expect(await same.json()).toMatchObject({ amountCents: 80_000 });
    // A recovered form does not resend the code; it still gets the stored order.
    expect((await replay({})).status).toBe(200);
    expect(await db.commerceOrder.count({ where: { vendorId: f.vendor.id } })).toBe(1);
  });
});
