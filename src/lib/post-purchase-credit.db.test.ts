import { createHash, randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { getDb } from "@/lib/db";
import { BUYER_SUPPORT_COOKIE_PREFIX, issueBuyerSupportGrant } from "@/lib/buyer-support-access";
import { createCommerceOrderForCheckout, reconcileCommerceOrderPaymentTransition, reconcileCommerceOrderRefund } from "@/lib/commerce-orders";
import { createReservedPaymentTransaction, failPendingCheckoutAndReleaseInventory,
  reacquireReleasedCheckoutInventory, releaseExpiredInventoryReservations } from "@/lib/inventory-reservations";
import { protectProductDeliveryConfig } from "@/lib/product-delivery";
import { issuePostPurchaseCheckoutToken, verifyPostPurchaseCheckoutToken } from "@/lib/post-purchase-upsell";
import { PaymentWebhookPayload, processPaymentWebhook } from "@/lib/payment-webhooks";
import { POST_PURCHASE_CREDIT_WINDOW_MS, resolvePaidOrderPostPurchaseOffer } from "@/lib/post-purchase-upsell-access";
import { assertPostPurchaseCreditReplay, consumePostPurchaseCredit, PostPurchaseUnavailableError, resolvePostPurchaseCreditQuote,
  type PostPurchaseCreditQuote } from "./post-purchase-credit";
import { releasePostPurchaseCreditForTerminalPayment } from "./post-purchase-credit-release";
import { postPurchaseRecoveryAvailable, resumePostPurchaseCheckout } from "./post-purchase-checkout-recovery";
import { resolvePostPurchaseRecoveryEntry } from "./post-purchase-recovery-entry";

// The post-response hook is observed, not run: these tests cover which receipt
// the committed webhook hands to it. Sending is covered by email-delivery-immediate.
const immediate = vi.hoisted(() => ({ schedule: vi.fn(), serializationFailures: 0, teamStageRuns: 0 }));
vi.mock("@/lib/email-delivery-immediate", async (original) => ({
  ...await original<typeof import("@/lib/email-delivery-immediate")>(),
  scheduleImmediateEmailDispatch: immediate.schedule,
}));
// Lets one test abort the payment transaction with a serialization failure
// after the receipt row was written inside it; every other stage is unchanged.
vi.mock("@/lib/payment-webhook-errors", async (original) => {
  const actual = await original<typeof import("@/lib/payment-webhook-errors")>();
  return {
    ...actual,
    withPaymentWebhookStage: async <T,>(stage: Parameters<typeof actual.withPaymentWebhookStage>[0], action: () => T | Promise<T>) => {
      const result = await actual.withPaymentWebhookStage(stage, action);
      if (stage === "TEAM_ATTRIBUTION") {
        immediate.teamStageRuns += 1;
        if (immediate.serializationFailures > 0) {
          immediate.serializationFailures -= 1;
          throw new Prisma.PrismaClientKnownRequestError("synthetic serialization failure", { code: "P2034", clientVersion: "synthetic" });
        }
      }
      return result;
    },
  };
});

const ownedVendors: string[] = [];
const buyer = { name: "合成買家", email: "post-purchase@example.test", phone: "0912345678" };
const shipping = { recipientName: buyer.name, phone: buyer.phone, countryCode: "TW", postalCode: "106",
  administrativeArea: "Taipei", locality: "Da-an", addressLine1: "Synthetic Road 1" };

afterEach(async () => {
  immediate.schedule.mockReset();
  immediate.serializationFailures = 0;
  immediate.teamStageRuns = 0;
  const vendorId = { in: ownedVendors.splice(0) };
  // Restrictive money/grant foreign keys deliberately require child-first
  // cleanup of only this fixture's synthetic resources.
  await getDb().postPurchaseCredit.deleteMany({ where: { vendorId } });
  await getDb().vendor.deleteMany({ where: { id: vendorId } });
});

async function fixture(stock = 5) {
  const db = getDb();
  const suffix = randomUUID();
  const vendor = await db.vendor.create({ data: { name: "Post purchase fixture", slug: `ppu-${suffix}`,
    email: `${suffix}@example.test`, passwordHash: "synthetic" } });
  ownedVendors.push(vendor.id);
  const target = await db.product.create({ data: { vendorId: vendor.id, name: "Digital upgrade", slug: `upgrade-${suffix}`,
    priceCents: 20_000, inventory: stock, fulfillmentType: "digital", fulfillmentTypeConfirmed: true } });
  const allowlist = await db.vendorDeliveryUrlAllowlist.create({ data: { vendorId: vendor.id, hostname: "delivery.example.test",
    pathPrefix: "/upgrade", allowQuery: false, status: "active" } });
  const configId = randomUUID();
  const delivery = { fulfillmentType: "digital" as const, deliveryKind: "digital_link" as const, status: "active" as const,
    title: "Digital upgrade", destinationUrl: "https://delivery.example.test/upgrade", destinationHostname: "delivery.example.test",
    destinationPathPrefix: "/upgrade", instructions: "Synthetic access" };
  await db.productDeliveryConfig.create({ data: { id: configId, vendorId: vendor.id, productId: target.id,
    fulfillmentType: "digital", deliveryKind: "digital_link", status: "active", title: delivery.title,
    allowlistId: allowlist.id, ...protectProductDeliveryConfig(delivery, { vendorId: vendor.id, productId: target.id, configId, revision: 1 }) } });
  const source = await db.product.create({ data: { vendorId: vendor.id, name: "Purchased original", slug: `original-${suffix}`,
    priceCents: 10_000, inventory: 1, fulfillmentTypeConfirmed: true, upsellProductId: target.id, upsellDiscountCents: 500 } });
  let orderId = "";
  const payment = await createReservedPaymentTransaction({ vendorId: vendor.id, productId: source.id,
    expectedProductRevision: source.revision, checkoutIdempotencyKey: randomUUID(),
    transactionData: { vendorId: vendor.id, providerName: "demo", orderNumber: `PPU-SOURCE-${suffix}`, grossAmountCents: 10_000,
      netAmountCents: 10_000, currency: "TWD", status: "pending", metadata: { productId: source.id, synthetic: true } },
    createCommerceOrder: async (tx, created) => {
      const order = await createCommerceOrderForCheckout(tx, { vendorId: vendor.id, productId: source.id,
        orderNumber: created.orderNumber!, checkoutIdempotencyKey: randomUUID(), paymentTransactionId: created.id,
        totalAmountCents: 10_000, currency: "TWD", buyer, shipping });
      orderId = order.id;
    } });
  await db.$transaction(tx => reconcileCommerceOrderPaymentTransition(tx, { vendorId: vendor.id,
    paymentTransactionId: payment.id, transition: "paid", eventIdentity: randomUUID() }), { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  const cookie = await issueBuyerSupportGrant(db, { vendorId: vendor.id, orderId,
    request: new Request("http://127.0.0.1:31046/synthetic") });
  const cookies = { getAll: () => [{ name: cookie.name, value: cookie.value }] };
  const grant = await db.buyerSupportOrderGrant.findUniqueOrThrow({ where: { vendorId_orderId: { vendorId: vendor.id, orderId } } });
  const token = issuePostPurchaseCheckoutToken({ grantId: grant.id, orderId, vendorId: vendor.id,
    sourceProductId: source.id, productId: target.id, kind: "upsell", amountCents: 9_500 });
  return { vendor, source, target, orderId, grant, cookies, token };
}
type Fixture = Awaited<ReturnType<typeof fixture>>;

async function upgrade(input: Fixture, options: { providerName?: string; targetId?: string; token?: string; now?: Date;
  /** Bypass application checks with a precomputed quote so only the database trigger decides. */
  directInsertQuote?: PostPurchaseCreditQuote; } = {}) {
  const db = getDb();
  const token = options.token ?? input.token;
  const quote = options.directInsertQuote ?? await resolvePostPurchaseCreditQuote(db, input.cookies, { token, vendorId: input.vendor.id,
    productId: options.targetId ?? input.target.id, now: options.now });
  const target = await db.product.findUniqueOrThrow({ where: { id: options.targetId ?? input.target.id } });
  let targetOrderId = "";
  const idempotencyKey = randomUUID();
  const payment = await createReservedPaymentTransaction({ vendorId: input.vendor.id, productId: target.id,
    expectedProductRevision: target.revision, checkoutIdempotencyKey: idempotencyKey,
    transactionData: { vendorId: input.vendor.id, checkoutIdempotencyKey: idempotencyKey, providerName: options.providerName ?? "demo",
      orderNumber: `PPU-TARGET-${randomUUID()}`, grossAmountCents: quote.checkoutAmountCents, netAmountCents: quote.checkoutAmountCents,
      currency: quote.currency, status: "pending", metadata: { synthetic: true, productId: target.id } },
    createCommerceOrder: async (tx, created, reservations) => {
      const order = await createCommerceOrderForCheckout(tx, { vendorId: input.vendor.id, productId: target.id,
        orderNumber: created.orderNumber!, checkoutIdempotencyKey: idempotencyKey, paymentTransactionId: created.id,
        totalAmountCents: quote.checkoutAmountCents, discountAmountCents: quote.creditAmountCents + quote.offerDiscountCents,
        currency: quote.currency, buyer, shipping: null });
      if (options.directInsertQuote) await tx.postPurchaseCredit.create({ data: { ...quote, targetOrderId: order.id } });
      else await consumePostPurchaseCredit(tx, input.cookies, { token, quote, targetOrderId: order.id, now: options.now,
        reserved: reservations.find(item => item.productId === target.id) });
      targetOrderId = order.id;
    } });
  return { payment, targetOrderId };
}
async function refund(input: Fixture) {
  return getDb().$transaction(tx => reconcileCommerceOrderRefund(tx, { vendorId: input.vendor.id, orderId: input.orderId,
    providerName: "demo", eventIdentity: randomUUID(), amountCents: 1_000, occurredAt: new Date() }),
  { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}

describe("transactional post-purchase upgrade credit", () => {
  async function entryFixture() {
    const input = await fixture(); const result = await upgrade(input); const db = getDb();
    const targetCookie = await issueBuyerSupportGrant(db, { vendorId: input.vendor.id, orderId: result.targetOrderId,
      request: new Request("http://127.0.0.1:31046/synthetic") });
    const targetGrant = await db.buyerSupportOrderGrant.findUniqueOrThrow({ where: { vendorId_orderId: {
      vendorId: input.vendor.id, orderId: result.targetOrderId } } });
    const cookies = { getAll: () => [...input.cookies.getAll(), { name: targetCookie.name, value: targetCookie.value }] };
    return { input, result, db, cookies, targetCookie, targetGrant };
  }
  it("resolves an exact original order recovery key with current source and target grants", async () => {
    const context = await entryFixture();
    expect(await resolvePostPurchaseRecoveryEntry(context.db, context.cookies, context.targetGrant.id)).toEqual({
      vendorId: context.input.vendor.id, productId: context.input.target.id, idempotencyKey: context.result.payment.checkoutIdempotencyKey,
    });
  });
  it.each(["source", "target"] as const)("rejects recovery entry when the current %s grant is missing", async missing => {
    const context = await entryFixture();
    const cookies = { getAll: () => missing === "source" ? [{ name: context.targetCookie.name, value: context.targetCookie.value }] : context.input.cookies.getAll() };
    await expect(resolvePostPurchaseRecoveryEntry(context.db, cookies, context.targetGrant.id)).rejects.toThrow(PostPurchaseUnavailableError);
  });
  it("rejects recovery entry after the original source is refunded", async () => {
    const context = await entryFixture(); await refund(context.input);
    await expect(resolvePostPurchaseRecoveryEntry(context.db, context.cookies, context.targetGrant.id)).rejects.toThrow(PostPurchaseUnavailableError);
  });
  it("selects the named older order and never substitutes a newer order or tenant", async () => {
    const older = await entryFixture(); const newer = await entryFixture();
    const cookies = { getAll: () => [...older.cookies.getAll(), ...newer.cookies.getAll()] };
    expect(await resolvePostPurchaseRecoveryEntry(older.db, cookies, older.targetGrant.id)).toEqual({
      vendorId: older.input.vendor.id, productId: older.input.target.id, idempotencyKey: older.result.payment.checkoutIdempotencyKey,
    });
    await expect(resolvePostPurchaseRecoveryEntry(older.db, older.cookies, newer.targetGrant.id)).rejects.toThrow(PostPurchaseUnavailableError);
  });
  async function preparationFailure(reason: "provider_checkout_failed" | "checkout_metadata_failed" = "provider_checkout_failed") {
    const input = await fixture(1); const result = await upgrade(input); const db = getDb();
    await db.paymentTransaction.update({ where: { id: result.payment.id }, data: {
      metadata: { productId: input.target.id, postPurchaseCredit: { sourceOrderId: input.orderId }, postPurchaseSessionState: "unissued" },
    } });
    await failPendingCheckoutAndReleaseInventory({ vendorId: input.vendor.id, transactionId: result.payment.id, reason });
    const request = new Request("http://127.0.0.1:31046/api/payments/checkout/recovery", {
      headers: { cookie: input.cookies.getAll().map(cookie => `${cookie.name}=${cookie.value}`).join("; ") },
    });
    const identity = { vendorId: input.vendor.id, productId: input.target.id, idempotencyKey: result.payment.checkoutIdempotencyKey! };
    return { input, result, db, request, identity };
  }
  async function expiredManualSession() {
    const context = await preparationFailure();
    const session = { provider: "demo", mode: "manual", nextAction: "demo_checkout_transaction_created", externalRequired: false,
      formPayload: { transactionId: context.result.payment.id, orderNumber: context.result.payment.orderNumber! } };
    await context.db.paymentTransaction.update({ where: { id: context.result.payment.id }, data: { status: "pending",
      metadata: { productId: context.input.target.id, postPurchaseCredit: { sourceOrderId: context.input.orderId },
        postPurchaseSessionState: "issued", checkoutSession: session } } });
    await context.db.commerceOrder.update({ where: { id: context.result.targetOrderId }, data: { status: "pending_payment", failedAt: null } });
    await context.db.$transaction(tx => reacquireReleasedCheckoutInventory(tx, { vendorId: context.input.vendor.id,
      transactionId: context.result.payment.id, productId: context.input.target.id }), { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    await context.db.inventoryReservation.update({ where: { paymentTransactionId: context.result.payment.id }, data: { expiresAt: new Date(Date.now() - 1000) } });
    await releaseExpiredInventoryReservations(100);
    expect((await context.db.paymentTransaction.findUniqueOrThrow({ where: { id: context.result.payment.id } })).status).toBe("expired");
    return { ...context, session };
  }
  it("resumes an expired local manual session on the same order and unchanged payload", async () => {
    const context = await expiredManualSession();
    expect(await resumePostPurchaseCheckout(context.request, context.identity)).toBe(true);
    const payment = await context.db.paymentTransaction.findUniqueOrThrow({ where: { id: context.result.payment.id } });
    expect(payment).toMatchObject({ status: "pending", grossAmountCents: 9500, metadata: { checkoutSession: context.session } });
    expect((await context.db.product.findUniqueOrThrow({ where: { id: context.input.target.id } })).inventory).toBe(0);
    expect(await context.db.paymentTransaction.count({ where: { vendorId: context.input.vendor.id } })).toBe(2);
    expect(await context.db.postPurchaseCredit.count({ where: { vendorId: context.input.vendor.id } })).toBe(1);
    expect(await context.db.commerceOrderEvent.count({ where: { vendorId: context.input.vendor.id, orderId: context.result.targetOrderId,
      eventType: "payment.checkout_recovered" } })).toBe(1);
  });
  it("concurrent expired manual recovery reacquires its final unit once", async () => {
    const context = await expiredManualSession();
    expect((await Promise.all([resumePostPurchaseCheckout(context.request, context.identity),
      resumePostPurchaseCheckout(context.request, context.identity)])).sort()).toEqual([false, true]);
    expect((await context.db.product.findUniqueOrThrow({ where: { id: context.input.target.id } })).inventory).toBe(0);
  });
  it("rejects expired recovery when the saved manual session names another transaction", async () => {
    const context = await expiredManualSession();
    await context.db.paymentTransaction.update({ where: { id: context.result.payment.id }, data: { metadata: {
      productId: context.input.target.id, postPurchaseCredit: {}, postPurchaseSessionState: "issued",
      checkoutSession: { ...context.session, formPayload: { ...context.session.formPayload, transactionId: randomUUID() } },
    } } });
    await expect(resumePostPurchaseCheckout(context.request, context.identity)).rejects.toThrow(PostPurchaseUnavailableError);
    expect((await context.db.product.findUniqueOrThrow({ where: { id: context.input.target.id } })).inventory).toBe(1);
  });
  it("source refund rejects an expired manual recovery before changing the original transaction", async () => {
    const context = await expiredManualSession(); await refund(context.input);
    await expect(resumePostPurchaseCheckout(context.request, context.identity)).rejects.toThrow(PostPurchaseUnavailableError);
    expect((await context.db.paymentTransaction.findUniqueOrThrow({ where: { id: context.result.payment.id } })).status).toBe("expired");
    expect((await context.db.product.findUniqueOrThrow({ where: { id: context.input.target.id } })).inventory).toBe(1);
  });
  it("a late paid transition prevents expired recovery and never re-reserves paid stock", async () => {
    const context = await expiredManualSession();
    await context.db.$transaction(async tx => {
      await tx.paymentTransaction.update({ where: { id: context.result.payment.id }, data: { status: "paid" } });
      await reconcileCommerceOrderPaymentTransition(tx, { vendorId: context.input.vendor.id,
        paymentTransactionId: context.result.payment.id, transition: "paid", eventIdentity: randomUUID() });
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    await expect(resumePostPurchaseCheckout(context.request, context.identity)).rejects.toThrow(PostPurchaseUnavailableError);
    expect((await context.db.paymentTransaction.findUniqueOrThrow({ where: { id: context.result.payment.id } })).status).toBe("paid");
    expect(await context.db.postPurchaseCredit.count({ where: { vendorId: context.input.vendor.id } })).toBe(1);
  });
  it("does not treat a pending payment with an already paid order as an idempotent recovery", async () => {
    const context = await expiredManualSession();
    await resumePostPurchaseCheckout(context.request, context.identity);
    await context.db.$transaction(tx => reconcileCommerceOrderPaymentTransition(tx, { vendorId: context.input.vendor.id,
      paymentTransactionId: context.result.payment.id, transition: "paid", eventIdentity: randomUUID() }));
    await expect(resumePostPurchaseCheckout(context.request, context.identity)).rejects.toThrow(PostPurchaseUnavailableError);
    expect((await context.db.commerceOrder.findUniqueOrThrow({ where: { id: context.result.targetOrderId } })).status).toBe("paid");
    expect((await context.db.product.findUniqueOrThrow({ where: { id: context.input.target.id } })).inventory).toBe(0);
  });
  for (const reason of ["provider_checkout_failed", "checkout_metadata_failed"] as const) {
    it(`restores the same unissued ${reason} checkout at its immutable net price`, async () => {
      const context = await preparationFailure(reason);
      expect(await resumePostPurchaseCheckout(context.request, context.identity)).toBe(true);
      expect(await resumePostPurchaseCheckout(context.request, context.identity)).toBe(false);
      const payment = await context.db.paymentTransaction.findUniqueOrThrow({ where: { id: context.result.payment.id } });
      expect(payment).toMatchObject({ status: "pending", grossAmountCents: 9_500, orderNumber: context.result.payment.orderNumber,
        metadata: { postPurchaseSessionState: "issued", checkoutSession: { mode: "manual", provider: "demo" } } });
      expect(await context.db.commerceOrder.findUniqueOrThrow({ where: { id: context.result.targetOrderId } }))
        .toMatchObject({ status: "pending_payment", primaryPaymentTransactionId: payment.id, totalAmountCents: 9_500 });
      expect(await context.db.postPurchaseCredit.count({ where: { vendorId: context.input.vendor.id } })).toBe(1);
      expect(await context.db.paymentTransaction.count({ where: { vendorId: context.input.vendor.id } })).toBe(2);
    });
  }
  it("concurrent preparation recovery reserves stock once without creating another payment", async () => {
    const context = await preparationFailure();
    const outcomes = await Promise.all([resumePostPurchaseCheckout(context.request, context.identity),
      resumePostPurchaseCheckout(context.request, context.identity)]);
    expect(outcomes.sort()).toEqual([false, true]);
    expect((await context.db.product.findUniqueOrThrow({ where: { id: context.input.target.id } })).inventory).toBe(0);
    expect(await context.db.paymentTransaction.count({ where: { vendorId: context.input.vendor.id } })).toBe(2);
  });
  it("never re-prepares an already issued failed session", async () => {
    const context = await preparationFailure();
    await context.db.paymentTransaction.update({ where: { id: context.result.payment.id }, data: {
      metadata: { productId: context.input.target.id, postPurchaseCredit: {}, postPurchaseSessionState: "issued" },
    } });
    await expect(resumePostPurchaseCheckout(context.request, context.identity)).rejects.toThrow(PostPurchaseUnavailableError);
    expect((await context.db.product.findUniqueOrThrow({ where: { id: context.input.target.id } })).inventory).toBe(1);
  });
  it("a provider reference forbids unissued-session recovery even when local metadata says unissued", async () => {
    const context = await preparationFailure();
    await context.db.paymentTransaction.update({ where: { id: context.result.payment.id }, data: { providerTradeNo: "synthetic-provider-reference" } });
    await expect(resumePostPurchaseCheckout(context.request, context.identity)).rejects.toThrow(PostPurchaseUnavailableError);
    expect((await context.db.paymentTransaction.findUniqueOrThrow({ where: { id: context.result.payment.id } })).status).toBe("failed");
  });
  it("source refund prevents local session recovery without recreating credit or stock", async () => {
    const context = await preparationFailure(); await refund(context.input);
    await expect(resumePostPurchaseCheckout(context.request, context.identity)).rejects.toThrow(PostPurchaseUnavailableError);
    expect((await context.db.product.findUniqueOrThrow({ where: { id: context.input.target.id } })).inventory).toBe(1);
    expect(await context.db.postPurchaseCredit.count({ where: { vendorId: context.input.vendor.id } })).toBe(1);
  });
  for (const failure of ["provider_checkout_failed", "expired"] as const) {
    it(`reacquires the original ${failure} inventory once without replacing its credit or transaction`, async () => {
      const input = await fixture(1); const result = await upgrade(input);
      const now = new Date(Date.now() + 31 * 60_000);
      if (failure === "expired") await releaseExpiredInventoryReservations(100, now);
      else await failPendingCheckoutAndReleaseInventory({ vendorId: input.vendor.id, transactionId: result.payment.id, reason: failure });
      const db = getDb();
      const recoverStock = () => db.$transaction(async tx => {
        await assertPostPurchaseCreditReplay(tx, input.cookies, { vendorId: input.vendor.id,
          targetOrderId: result.targetOrderId, productId: input.target.id });
        return reacquireReleasedCheckoutInventory(tx, { vendorId: input.vendor.id,
          transactionId: result.payment.id, productId: input.target.id, now });
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
      expect(await recoverStock()).toBe(true);
      expect(await recoverStock()).toBe(false);
      expect((await db.product.findUniqueOrThrow({ where: { id: input.target.id } })).inventory).toBe(0);
      expect(await db.postPurchaseCredit.count({ where: { vendorId: input.vendor.id } })).toBe(1);
      expect(await db.paymentTransaction.count({ where: { vendorId: input.vendor.id } })).toBe(2);
      expect(await db.commerceOrder.findUniqueOrThrow({ where: { id: result.targetOrderId } }))
        .toMatchObject({ primaryPaymentTransactionId: result.payment.id, totalAmountCents: 9_500 });
    });
  }
  it("rolls recovery back when released stock has sold out", async () => {
    const input = await fixture(1); const result = await upgrade(input); const db = getDb();
    await failPendingCheckoutAndReleaseInventory({ vendorId: input.vendor.id, transactionId: result.payment.id, reason: "provider_checkout_failed" });
    await db.product.update({ where: { id: input.target.id }, data: { inventory: 0 } });
    await expect(db.$transaction(tx => reacquireReleasedCheckoutInventory(tx, { vendorId: input.vendor.id,
      transactionId: result.payment.id, productId: input.target.id }), { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }))
      .rejects.toThrow("Product inventory is unavailable.");
    expect((await db.inventoryReservation.findUniqueOrThrow({ where: { paymentTransactionId: result.payment.id } })).status).toBe("released");
    expect((await db.paymentTransaction.findUniqueOrThrow({ where: { id: result.payment.id } })).status).toBe("failed");
  });
  it("rejects another tenant before reacquiring inventory", async () => {
    const input = await fixture(1); const result = await upgrade(input); const db = getDb();
    await failPendingCheckoutAndReleaseInventory({ vendorId: input.vendor.id, transactionId: result.payment.id, reason: "provider_checkout_failed" });
    await expect(db.$transaction(tx => reacquireReleasedCheckoutInventory(tx, { vendorId: randomUUID(),
      transactionId: result.payment.id, productId: input.target.id }), { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }))
      .rejects.toThrow("Inventory reservation input is invalid.");
    expect((await db.product.findUniqueOrThrow({ where: { id: input.target.id } })).inventory).toBe(1);
  });
  it("a refunded source prevents recovery before any released stock is reacquired", async () => {
    const input = await fixture(1); const result = await upgrade(input); const db = getDb();
    await failPendingCheckoutAndReleaseInventory({ vendorId: input.vendor.id, transactionId: result.payment.id, reason: "provider_checkout_failed" });
    await refund(input);
    await expect(db.$transaction(async tx => {
      await assertPostPurchaseCreditReplay(tx, input.cookies, { vendorId: input.vendor.id,
        targetOrderId: result.targetOrderId, productId: input.target.id });
      return reacquireReleasedCheckoutInventory(tx, { vendorId: input.vendor.id,
        transactionId: result.payment.id, productId: input.target.id });
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable })).rejects.toThrow(PostPurchaseUnavailableError);
    expect((await db.product.findUniqueOrThrow({ where: { id: input.target.id } })).inventory).toBe(1);
  });
  it("resumes only the original pending target with the current buyer grant and immutable credit", async () => {
    const input = await fixture();
    const result = await upgrade(input);
    const credit = await assertPostPurchaseCreditReplay(getDb(), input.cookies, {
      vendorId: input.vendor.id, productId: input.target.id, targetOrderId: result.targetOrderId,
    });
    expect(credit.checkoutAmountCents).toBe(9500);
    expect(credit.sourceOrderId).toBe(input.orderId);
    expect(await getDb().postPurchaseCredit.count({ where: { vendorId: input.vendor.id } })).toBe(1);
    await expect(assertPostPurchaseCreditReplay(getDb(), { getAll: () => [] }, {
      vendorId: input.vendor.id, productId: input.target.id, targetOrderId: result.targetOrderId,
    })).rejects.toThrow(PostPurchaseUnavailableError);
  });
  it("rejects an existing checkout after its original grant is revoked", async () => {
    const input = await fixture(); const result = await upgrade(input);
    await getDb().buyerSupportOrderGrant.update({ where: { id: input.grant.id }, data: { revokedAt: new Date() } });
    await expect(assertPostPurchaseCreditReplay(getDb(), input.cookies, {
      vendorId: input.vendor.id, productId: input.target.id, targetOrderId: result.targetOrderId,
    })).rejects.toThrow(PostPurchaseUnavailableError);
  });
  it("rejects recovery after source refund without erasing the original payment amount", async () => {
    const input = await fixture(); const result = await upgrade(input);
    await refund(input);
    await expect(assertPostPurchaseCreditReplay(getDb(), input.cookies, {
      vendorId: input.vendor.id, productId: input.target.id, targetOrderId: result.targetOrderId,
    })).rejects.toThrow(PostPurchaseUnavailableError);
    expect((await getDb().paymentTransaction.findUniqueOrThrow({ where: { id: result.payment.id } })).grossAmountCents).toBe(9500);
    expect(await getDb().postPurchaseCredit.count({ where: { vendorId: input.vendor.id } })).toBe(1);
  });
  it("rejects a replay against a different target product or tenant", async () => {
    const input = await fixture(); const result = await upgrade(input);
    for (const override of [{ productId: input.source.id }, { vendorId: randomUUID() }]) {
      await expect(assertPostPurchaseCreditReplay(getDb(), input.cookies, {
        vendorId: input.vendor.id, productId: input.target.id, targetOrderId: result.targetOrderId, ...override,
      })).rejects.toThrow(PostPurchaseUnavailableError);
    }
  });
  it("consumes the settled source once while reserving the target's final unit and recording only real new money", async () => {
    const input = await fixture(1);
    const result = await upgrade(input);
    expect((await getDb().product.findUniqueOrThrow({ where: { id: input.target.id } })).inventory).toBe(0);
    expect(result.payment.grossAmountCents).toBe(9_500);
    const credit = await getDb().postPurchaseCredit.findFirstOrThrow({ where: { vendorId: input.vendor.id, sourceOrderId: input.orderId, releasedAt: null } });
    expect(credit).toMatchObject({ targetOrderId: result.targetOrderId, creditAmountCents: 10_000, offerDiscountCents: 500,
      targetPriceCents: 20_000, checkoutAmountCents: 9_500, invalidatedAt: null });
  });

  it("rolls back the losing concurrent reservation and target order instead of reusing source money", async () => {
    const input = await fixture();
    const results = await Promise.allSettled([upgrade(input), upgrade(input)]);
    expect(results.filter(result => result.status === "fulfilled")).toHaveLength(1);
    expect(results.filter(result => result.status === "rejected")).toHaveLength(1);
    expect(await getDb().postPurchaseCredit.count({ where: { vendorId: input.vendor.id } })).toBe(1);
    expect(await getDb().commerceOrder.count({ where: { vendorId: input.vendor.id } })).toBe(2);
    expect((await getDb().product.findUniqueOrThrow({ where: { id: input.target.id } })).inventory).toBe(4);
  });

  it("rejects a source refunded after token issuance before making any target payment", async () => {
    const input = await fixture(); await refund(input);
    await expect(upgrade(input)).rejects.toBeInstanceOf(PostPurchaseUnavailableError);
    expect(await getDb().commerceOrder.count({ where: { vendorId: input.vendor.id } })).toBe(1);
    expect(await getDb().postPurchaseCredit.count({ where: { vendorId: input.vendor.id } })).toBe(0);
  });

  it("revokes upgraded access on a partial source refund and does not restore it on paid replay", async () => {
    const input = await fixture(); const result = await upgrade(input);
    const paid = () => getDb().$transaction(tx => reconcileCommerceOrderPaymentTransition(tx, { vendorId: input.vendor.id,
      paymentTransactionId: result.payment.id, transition: "paid", eventIdentity: "upgrade-paid" }));
    await paid();
    expect((await getDb().commerceEntitlement.findFirstOrThrow({ where: { vendorId: input.vendor.id } })).status).toBe("granted");
    await refund(input); await paid();
    const entitlement = await getDb().commerceEntitlement.findFirstOrThrow({ where: { vendorId: input.vendor.id } });
    expect(entitlement).toMatchObject({ status: "revoked", accessEncryptedEnvelope: null });
    expect((await getDb().postPurchaseCredit.findFirstOrThrow({ where: { vendorId: input.vendor.id } })).invalidatedAt).not.toBeNull();
  });

  it("persists a late paid provider truth after source refund without granting invalidated upgrade access", async () => {
    const input = await fixture(); const result = await upgrade(input); await refund(input);
    await getDb().$transaction(tx => reconcileCommerceOrderPaymentTransition(tx, { vendorId: input.vendor.id,
      paymentTransactionId: result.payment.id, transition: "paid", eventIdentity: "late-upgrade-paid" }));
    expect((await getDb().commerceOrder.findUniqueOrThrow({ where: { id: result.targetOrderId } })).paidAmountCents).toBe(9_500);
    expect((await getDb().commerceEntitlement.findFirstOrThrow({ where: { vendorId: input.vendor.id } })).status).toBe("revoked");
  });

  it("rechecks revoked buyer grants before reservation", async () => {
    const input = await fixture();
    await getDb().buyerSupportOrderGrant.update({ where: { id: input.grant.id }, data: { revokedAt: new Date() } });
    await expect(upgrade(input)).rejects.toBeInstanceOf(PostPurchaseUnavailableError);
    expect(await getDb().postPurchaseCredit.count({ where: { vendorId: input.vendor.id } })).toBe(0);
  });

  it("refuses copied signed locators without the actual same-order cookie and foreign tenant paths", async () => {
    const input = await fixture();
    const wrongCookie = { getAll: () => [{ name: `${BUYER_SUPPORT_COOKIE_PREFIX}${input.grant.cookieKey}`, value: createHash("sha256").update("foreign synthetic").digest("base64url") }] };
    await expect(resolvePostPurchaseCreditQuote(getDb(), wrongCookie, { token: input.token, vendorId: input.vendor.id, productId: input.target.id })).rejects.toBeInstanceOf(PostPurchaseUnavailableError);
    await expect(resolvePostPurchaseCreditQuote(getDb(), input.cookies, { token: input.token, vendorId: "foreign-tenant", productId: input.target.id })).rejects.toBeInstanceOf(PostPurchaseUnavailableError);
    expect(await getDb().postPurchaseCredit.count({ where: { vendorId: input.vendor.id } })).toBe(0);
  });

  it("refuses price drift and enforces immutable credit money at the database boundary", async () => {
    const input = await fixture();
    await getDb().product.update({ where: { id: input.target.id }, data: { priceCents: 21_000, revision: { increment: 1 } } });
    await expect(upgrade(input)).rejects.toBeInstanceOf(PostPurchaseUnavailableError);
    await getDb().product.update({ where: { id: input.target.id }, data: { priceCents: 20_000, revision: { increment: 1 } } });
    await upgrade(input);
    const credit = await getDb().postPurchaseCredit.findFirstOrThrow({ where: { vendorId: input.vendor.id } });
    await expect(getDb().postPurchaseCredit.update({ where: { id: credit.id }, data: { checkoutAmountCents: 9_000 } })).rejects.toThrow();
    expect((await getDb().postPurchaseCredit.findUniqueOrThrow({ where: { id: credit.id } })).checkoutAmountCents).toBe(9_500);
  });
});

async function digitalProduct(vendorId: string, slug: string, priceCents: number) {
  const db = getDb();
  const product = await db.product.create({ data: { vendorId, name: `Digital ${slug}`, slug: `${slug}-${randomUUID()}`,
    priceCents, inventory: 5, fulfillmentType: "digital", fulfillmentTypeConfirmed: true } });
  const allowlist = await db.vendorDeliveryUrlAllowlist.create({ data: { vendorId, hostname: "delivery.example.test",
    pathPrefix: `/${slug}`, allowQuery: false, status: "active" } });
  const configId = randomUUID();
  const delivery = { fulfillmentType: "digital" as const, deliveryKind: "digital_link" as const, status: "active" as const,
    title: product.name, destinationUrl: `https://delivery.example.test/${slug}`, destinationHostname: "delivery.example.test",
    destinationPathPrefix: `/${slug}`, instructions: "Synthetic access" };
  await db.productDeliveryConfig.create({ data: { id: configId, vendorId, productId: product.id, fulfillmentType: "digital",
    deliveryKind: "digital_link", status: "active", title: delivery.title, allowlistId: allowlist.id,
    ...protectProductDeliveryConfig(delivery, { vendorId, productId: product.id, configId, revision: 1 }) } });
  return product;
}

function freshToken(input: Fixture, overrides: Partial<Parameters<typeof issuePostPurchaseCheckoutToken>[0]> = {}) {
  return issuePostPurchaseCheckoutToken({ grantId: input.grant.id, orderId: input.orderId, vendorId: input.vendor.id,
    sourceProductId: input.source.id, productId: input.target.id, kind: "upsell", amountCents: 9_500, ...overrides });
}

async function targetEntitlementStatus(vendorId: string, orderId: string) {
  return (await getDb().commerceEntitlement.findFirstOrThrow({ where: { vendorId, orderItem: { orderId } } })).status;
}

describe("provider-chargeable post-purchase offers", () => {
  it.each([
    ["a fractional TWD discount", { upsellDiscountCents: 550 }, 20_000],
    ["a difference above the PayUni maximum", {}, 10_000 + 500 + 20_000_000],
  ])("refuses %s before consuming the source credit", async (_label, sourceUpdate, targetPriceCents) => {
    const input = await fixture(); const db = getDb();
    await db.product.update({ where: { id: input.source.id }, data: sourceUpdate });
    await db.product.update({ where: { id: input.target.id }, data: { priceCents: targetPriceCents, revision: { increment: 1 } } });
    // Never shown: the paid-order offer itself is unavailable.
    expect(await resolvePaidOrderPostPurchaseOffer(db, { vendorId: input.vendor.id, orderId: input.orderId, kind: "upsell" })).toBeNull();
    await expect(upgrade(input)).rejects.toBeInstanceOf(PostPurchaseUnavailableError);
    expect(await db.postPurchaseCredit.count({ where: { vendorId: input.vendor.id } })).toBe(0);
    expect(await db.commerceOrder.count({ where: { vendorId: input.vendor.id } })).toBe(1);
    expect((await db.product.findUniqueOrThrow({ where: { id: input.target.id } })).inventory).toBe(5);
  });
});

describe("released post-purchase credit", () => {
  it("releases an unpaid PayUni failure, revokes its target and lets the source be quoted again", async () => {
    const input = await fixture(); const first = await upgrade(input, { providerName: "payuni" }); const db = getDb();
    await processPaymentWebhook(PaymentWebhookPayload.parse({ provider: "payuni", eventId: `ppu-failed-${randomUUID()}`,
      eventType: "failed", vendorId: input.vendor.id, orderNumber: first.payment.orderNumber, providerTradeNo: "synthetic-failed-trade" }));
    const released = await db.postPurchaseCredit.findUniqueOrThrow({ where: { vendorId_targetOrderId: { vendorId: input.vendor.id, targetOrderId: first.targetOrderId } } });
    expect(released.releasedAt).not.toBeNull();
    expect(released.invalidatedAt).toBeNull();
    expect((await db.commerceOrder.findUniqueOrThrow({ where: { id: first.targetOrderId } })).status).toBe("payment_failed");
    expect(await targetEntitlementStatus(input.vendor.id, first.targetOrderId)).toBe("revoked");
    expect(await postPurchaseRecoveryAvailable(db, { vendorId: input.vendor.id, orderId: first.targetOrderId })).toBe(false);
    await expect(assertPostPurchaseCreditReplay(db, input.cookies, { vendorId: input.vendor.id,
      targetOrderId: first.targetOrderId, productId: input.target.id })).rejects.toThrow(PostPurchaseUnavailableError);

    const second = await upgrade(input, { providerName: "payuni", token: freshToken(input) });
    expect(await db.postPurchaseCredit.count({ where: { vendorId: input.vendor.id } })).toBe(2);
    expect(await db.postPurchaseCredit.findFirstOrThrow({ where: { vendorId: input.vendor.id, sourceOrderId: input.orderId, releasedAt: null } }))
      .toMatchObject({ targetOrderId: second.targetOrderId, checkoutAmountCents: 9_500, creditAmountCents: 10_000 });
  });

  it("releases an expired unpaid PayUni reservation and allows a new quote", async () => {
    const input = await fixture(); const first = await upgrade(input, { providerName: "payuni" }); const db = getDb();
    await releaseExpiredInventoryReservations(100, new Date(Date.now() + 31 * 60_000));
    expect((await db.paymentTransaction.findUniqueOrThrow({ where: { id: first.payment.id } })).status).toBe("expired");
    expect((await db.postPurchaseCredit.findUniqueOrThrow({ where: { vendorId_targetOrderId: { vendorId: input.vendor.id,
      targetOrderId: first.targetOrderId } } })).releasedAt).not.toBeNull();
    expect(await resolvePaidOrderPostPurchaseOffer(db, { vendorId: input.vendor.id, orderId: input.orderId, kind: "upsell" }))
      .toMatchObject({ offer: { productId: input.target.id, amountCents: 9_500 } });
    await upgrade(input, { providerName: "payuni", token: freshToken(input) });
    expect(await db.postPurchaseCredit.count({ where: { vendorId: input.vendor.id, releasedAt: null } })).toBe(1);
  });

  it("never delivers a released credit on a late payment and never invalidates it on source refund", async () => {
    const input = await fixture(); const first = await upgrade(input, { providerName: "payuni" }); const db = getDb();
    await releaseExpiredInventoryReservations(100, new Date(Date.now() + 31 * 60_000));
    const released = await db.postPurchaseCredit.findUniqueOrThrow({ where: { vendorId_targetOrderId: { vendorId: input.vendor.id, targetOrderId: first.targetOrderId } } });
    expect(released.releasedAt).not.toBeNull();
    await db.$transaction(tx => reconcileCommerceOrderPaymentTransition(tx, { vendorId: input.vendor.id,
      paymentTransactionId: first.payment.id, transition: "paid", eventIdentity: "late-paid-after-release" }),
    { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    expect((await db.commerceOrder.findUniqueOrThrow({ where: { id: first.targetOrderId } })).paidAmountCents).toBe(9_500);
    expect(await targetEntitlementStatus(input.vendor.id, first.targetOrderId)).toBe("revoked");
    await expect(assertPostPurchaseCreditReplay(db, input.cookies, { vendorId: input.vendor.id,
      targetOrderId: first.targetOrderId, productId: input.target.id })).rejects.toThrow(PostPurchaseUnavailableError);
    // The release is permanent and the released row is immutable history.
    await expect(db.postPurchaseCredit.update({ where: { id: released.id }, data: { releasedAt: null } })).rejects.toThrow();
    await expect(db.postPurchaseCredit.update({ where: { id: released.id }, data: { invalidatedAt: new Date() } })).rejects.toThrow();

    const second = await upgrade(input, { providerName: "payuni", token: freshToken(input) });
    await refund(input);
    const credits = await db.postPurchaseCredit.findMany({ where: { vendorId: input.vendor.id } });
    expect(credits.find(credit => credit.id === released.id)).toMatchObject({ invalidatedAt: null, releasedAt: released.releasedAt });
    expect(credits.find(credit => credit.targetOrderId === second.targetOrderId)?.invalidatedAt).not.toBeNull();
  });

  it("refuses to release a credit whose target can still be paid", async () => {
    const input = await fixture(); const result = await upgrade(input, { providerName: "payuni" }); const db = getDb();
    expect(await db.$transaction(tx => releasePostPurchaseCreditForTerminalPayment(tx, { vendorId: input.vendor.id,
      paymentTransactionId: result.payment.id, now: new Date() }))).toBe(false);
    const credit = await db.postPurchaseCredit.findFirstOrThrow({ where: { vendorId: input.vendor.id } });
    await expect(db.postPurchaseCredit.update({ where: { id: credit.id }, data: { releasedAt: new Date() } })).rejects.toThrow();
    expect((await db.postPurchaseCredit.findUniqueOrThrow({ where: { id: credit.id } })).releasedAt).toBeNull();
    await expect(upgrade(input, { providerName: "payuni", token: freshToken(input) })).rejects.toBeInstanceOf(PostPurchaseUnavailableError);
  });

  it("keeps a locally resumable demo credit bound and offers its recovery", async () => {
    const input = await fixture(1); const result = await upgrade(input); const db = getDb();
    await db.paymentTransaction.update({ where: { id: result.payment.id }, data: {
      metadata: { productId: input.target.id, postPurchaseCredit: { sourceOrderId: input.orderId }, postPurchaseSessionState: "unissued" },
    } });
    await failPendingCheckoutAndReleaseInventory({ vendorId: input.vendor.id, transactionId: result.payment.id, reason: "provider_checkout_failed" });
    expect(await postPurchaseRecoveryAvailable(db, { vendorId: input.vendor.id, orderId: result.targetOrderId })).toBe(true);
    expect((await db.postPurchaseCredit.findFirstOrThrow({ where: { vendorId: input.vendor.id } })).releasedAt).toBeNull();
  });

  it("binds exactly one credit when upsell and downsell race for the same source", async () => {
    const input = await fixture(); const db = getDb();
    const downsell = await digitalProduct(input.vendor.id, "downsell", 15_000);
    await db.product.update({ where: { id: input.source.id }, data: { downsellProductId: downsell.id } });
    const downsellToken = freshToken(input, { productId: downsell.id, kind: "downsell", amountCents: 5_000 });
    const results = await Promise.allSettled([upgrade(input), upgrade(input, { targetId: downsell.id, token: downsellToken })]);
    expect(results.filter(result => result.status === "fulfilled")).toHaveLength(1);
    expect(await db.postPurchaseCredit.count({ where: { vendorId: input.vendor.id } })).toBe(1);
    expect(await db.commerceOrder.count({ where: { vendorId: input.vendor.id } })).toBe(2);
    const inventories = await db.product.findMany({ where: { id: { in: [input.target.id, downsell.id] } }, select: { inventory: true } });
    expect(inventories.map(product => product.inventory).sort()).toEqual([4, 5]);
  });
});

describe("post-purchase credit rejections and replay", () => {
  it("maps a database trigger rejection to the post-purchase unavailable refusal", async () => {
    const input = await fixture(); const db = getDb();
    // The application sees a still-valid grant at `now`; the trigger checks the
    // database clock, so only the trigger can reject this binding.
    await db.buyerSupportOrderGrant.update({ where: { id: input.grant.id }, data: {
      createdAt: new Date(Date.now() - 120_000), expiresAt: new Date(Date.now() - 30_000) } });
    await expect(upgrade(input, { now: new Date(Date.now() - 60_000) })).rejects.toBeInstanceOf(PostPurchaseUnavailableError);
    expect(await db.postPurchaseCredit.count({ where: { vendorId: input.vendor.id } })).toBe(0);
    expect(await db.commerceOrder.count({ where: { vendorId: input.vendor.id } })).toBe(1);
  });

  it("replays an already-bound pending order with an expired but authentic token", async () => {
    const input = await fixture(); const result = await upgrade(input);
    const past = new Date(Date.now() - 11 * 60_000);
    const expired = freshToken(input, { now: past });
    expect(verifyPostPurchaseCheckoutToken(expired)).toBeNull();
    await expect(assertPostPurchaseCreditReplay(getDb(), input.cookies, { vendorId: input.vendor.id,
      targetOrderId: result.targetOrderId, productId: input.target.id, token: expired })).resolves.toMatchObject({ targetOrderId: result.targetOrderId });
    // Signature and bindings are still enforced for an expired token.
    for (const token of [freshToken(input, { now: past, amountCents: 9_400 }), `${expired.slice(0, -2)}AA`]) {
      await expect(assertPostPurchaseCreditReplay(getDb(), input.cookies, { vendorId: input.vendor.id,
        targetOrderId: result.targetOrderId, productId: input.target.id, token })).rejects.toThrow(PostPurchaseUnavailableError);
    }
    // An expired token still cannot open a new quote.
    await expect(resolvePostPurchaseCreditQuote(getDb(), input.cookies, { token: expired, vendorId: input.vendor.id,
      productId: input.target.id })).rejects.toThrow(PostPurchaseUnavailableError);
  });
});

const MINUTE = 60_000;

async function paidTarget(input: Fixture, result: { payment: { id: string } }, eventIdentity: string = randomUUID()) {
  return getDb().$transaction(tx => reconcileCommerceOrderPaymentTransition(tx, { vendorId: input.vendor.id,
    paymentTransactionId: result.payment.id, transition: "paid", eventIdentity }),
  { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}

async function sourceShipping(input: Fixture) {
  return getDb().shippingFulfillment.findFirstOrThrow({ where: { vendorId: input.vendor.id, orderItem: { orderId: input.orderId } } });
}

async function manualReviewFlags(vendorId: string, orderId: string) {
  return getDb().commerceOrderEvent.findMany({ where: { vendorId, orderId, eventType: "post_purchase.manual_review_required" } });
}

describe("24-hour post-purchase credit window", () => {
  it("offers at 23h59 and refuses at 24h01 after the source paid time", async () => {
    const input = await fixture(); const db = getDb();
    const { paidAt } = await db.commerceOrder.findUniqueOrThrow({ where: { id: input.orderId } });
    const at = (offset: number) => resolvePaidOrderPostPurchaseOffer(db, { vendorId: input.vendor.id, orderId: input.orderId,
      kind: "upsell", now: new Date(paidAt!.getTime() + offset) });
    expect(POST_PURCHASE_CREDIT_WINDOW_MS).toBe(24 * 60 * MINUTE);
    expect(await at(POST_PURCHASE_CREDIT_WINDOW_MS - MINUTE)).toMatchObject({ offer: { productId: input.target.id } });
    expect(await at(POST_PURCHASE_CREDIT_WINDOW_MS + MINUTE)).toBeNull();
  });

  it("the database trigger accepts a 23h59 source and refuses a 24h01 source the application let through", async () => {
    const fresh = await fixture(); const db = getDb();
    await db.commerceOrder.update({ where: { id: fresh.orderId }, data: { paidAt: new Date(Date.now() - POST_PURCHASE_CREDIT_WINDOW_MS + MINUTE) } });
    await upgrade(fresh);
    expect(await db.postPurchaseCredit.count({ where: { vendorId: fresh.vendor.id } })).toBe(1);

    const stale = await fixture();
    await db.commerceOrder.update({ where: { id: stale.orderId }, data: { paidAt: new Date(Date.now() - POST_PURCHASE_CREDIT_WINDOW_MS - MINUTE) } });
    // The application clock is two minutes behind, so only the trigger sees the stale source.
    await expect(upgrade(stale, { now: new Date(Date.now() - 2 * MINUTE) })).rejects.toBeInstanceOf(PostPurchaseUnavailableError);
    expect(await db.postPurchaseCredit.count({ where: { vendorId: stale.vendor.id } })).toBe(0);
    expect(await db.commerceOrder.count({ where: { vendorId: stale.vendor.id } })).toBe(1);
  });
});

describe("shipped physical source", () => {
  it("is never offered and the trigger refuses a credit for it", async () => {
    const input = await fixture(); const db = getDb();
    const quote = await resolvePostPurchaseCreditQuote(db, input.cookies, { token: input.token, vendorId: input.vendor.id, productId: input.target.id });
    const shipping = await sourceShipping(input);
    await db.shippingFulfillment.update({ where: { id: shipping.id }, data: { status: "shipped", shippedAt: new Date() } });
    expect(await resolvePaidOrderPostPurchaseOffer(db, { vendorId: input.vendor.id, orderId: input.orderId, kind: "upsell" })).toBeNull();
    await expect(upgrade(input)).rejects.toBeInstanceOf(PostPurchaseUnavailableError);
    await expect(upgrade(input, { directInsertQuote: quote })).rejects.toThrow(/23514/u);
    expect(await db.postPurchaseCredit.count({ where: { vendorId: input.vendor.id } })).toBe(0);
  });
});

describe("replace semantics on target payment", () => {
  it("supersedes the credit exactly once and revokes the source delivery", async () => {
    const input = await fixture(); const result = await upgrade(input); const db = getDb();
    expect((await sourceShipping(input)).status).toBe("pending");
    await paidTarget(input, result, "target-paid");
    const credit = await db.postPurchaseCredit.findFirstOrThrow({ where: { vendorId: input.vendor.id } });
    expect(credit.supersededAt).not.toBeNull();
    expect(await targetEntitlementStatus(input.vendor.id, result.targetOrderId)).toBe("granted");
    expect((await sourceShipping(input)).status).toBe("cancelled");
    // Replayed and later paid events never move the supersede timestamp.
    await paidTarget(input, result, "target-paid");
    await paidTarget(input, result, "target-paid-again");
    expect((await db.postPurchaseCredit.findUniqueOrThrow({ where: { id: credit.id } })).supersededAt).toEqual(credit.supersededAt);
    await expect(db.postPurchaseCredit.update({ where: { id: credit.id }, data: { supersededAt: new Date() } })).rejects.toThrow();
    await expect(db.postPurchaseCredit.update({ where: { id: credit.id }, data: { supersededAt: null } })).rejects.toThrow();
    await expect(db.postPurchaseCredit.update({ where: { id: credit.id }, data: { releasedAt: new Date() } })).rejects.toThrow();
    // A superseded source can never be quoted again.
    await expect(upgrade(input, { token: freshToken(input) })).rejects.toBeInstanceOf(PostPurchaseUnavailableError);
    expect(await manualReviewFlags(input.vendor.id, result.targetOrderId)).toHaveLength(0);
  });

  it("refuses to supersede while the target is unpaid", async () => {
    const input = await fixture(); const result = await upgrade(input); const db = getDb();
    const credit = await db.postPurchaseCredit.findFirstOrThrow({ where: { vendorId: input.vendor.id, targetOrderId: result.targetOrderId } });
    await expect(db.postPurchaseCredit.update({ where: { id: credit.id }, data: { supersededAt: new Date() } })).rejects.toThrow();
    expect((await sourceShipping(input)).status).toBe("pending");
  });

  it("flags a paid target revoked by a later source refund, once, without auto-refunding", async () => {
    const input = await fixture(); const result = await upgrade(input); const db = getDb();
    await paidTarget(input, result);
    await refund(input); await refund(input);
    const credit = await db.postPurchaseCredit.findFirstOrThrow({ where: { vendorId: input.vendor.id } });
    expect(credit.supersededAt).not.toBeNull();
    expect(credit.invalidatedAt).not.toBeNull();
    expect(await targetEntitlementStatus(input.vendor.id, result.targetOrderId)).toBe("revoked");
    const flags = await manualReviewFlags(input.vendor.id, result.targetOrderId);
    expect(flags).toHaveLength(1);
    expect(flags[0]).toMatchObject({ actorType: "system", sanitizedData: { reason: "paid_target_revoked_by_source_refund",
      creditId: credit.id, paidAmountCents: 9_500, autoRefund: false } });
    expect(await db.commerceOrderRefund.count({ where: { vendorId: input.vendor.id, orderId: result.targetOrderId } })).toBe(0);
  });

  it("converges concurrent target payment and source refund to no delivery and one merchant flag", async () => {
    const input = await fixture(); const result = await upgrade(input); const db = getDb();
    const operations = [() => paidTarget(input, result, "concurrent-paid"), () => refund(input)];
    const outcomes = await Promise.allSettled(operations.map(operation => operation()));
    // A serialization loser is retried once, as the webhook and refund jobs do.
    for (const [index, outcome] of outcomes.entries()) if (outcome.status === "rejected") await operations[index]!();
    const credit = await db.postPurchaseCredit.findFirstOrThrow({ where: { vendorId: input.vendor.id } });
    expect(credit.invalidatedAt).not.toBeNull();
    expect((await db.commerceOrder.findUniqueOrThrow({ where: { id: result.targetOrderId } })).paidAmountCents).toBe(9_500);
    expect(await targetEntitlementStatus(input.vendor.id, result.targetOrderId)).toBe("revoked");
    expect(await manualReviewFlags(input.vendor.id, result.targetOrderId)).toHaveLength(1);
    expect(await db.postPurchaseCredit.count({ where: { vendorId: input.vendor.id } })).toBe(1);
  });

  it("flags a PayUni payment that lands after its credit was released", async () => {
    const input = await fixture(); const first = await upgrade(input, { providerName: "payuni" }); const db = getDb();
    await processPaymentWebhook(PaymentWebhookPayload.parse({ provider: "payuni", eventId: `ppu-failed-${randomUUID()}`,
      eventType: "failed", vendorId: input.vendor.id, orderNumber: first.payment.orderNumber, providerTradeNo: "synthetic-late-trade" }));
    await processPaymentWebhook(PaymentWebhookPayload.parse({ provider: "payuni", eventId: `ppu-paid-${randomUUID()}`,
      eventType: "paid", vendorId: input.vendor.id, orderNumber: first.payment.orderNumber, providerTradeNo: "synthetic-late-trade",
      grossAmountCents: 9_500, currency: "TWD" }));
    const credit = await db.postPurchaseCredit.findFirstOrThrow({ where: { vendorId: input.vendor.id } });
    expect(credit).toMatchObject({ supersededAt: null, invalidatedAt: null });
    expect(credit.releasedAt).not.toBeNull();
    expect((await db.commerceOrder.findUniqueOrThrow({ where: { id: first.targetOrderId } })).status).toBe("paid");
    expect(await targetEntitlementStatus(input.vendor.id, first.targetOrderId)).toBe("revoked");
    // The source keeps its own delivery because nothing replaced it.
    expect((await sourceShipping(input)).status).toBe("pending");
    const flags = await manualReviewFlags(input.vendor.id, first.targetOrderId);
    expect(flags).toHaveLength(1);
    expect(flags[0]?.sanitizedData).toMatchObject({ reason: "paid_after_credit_released", creditId: credit.id, paidAmountCents: 9_500, autoRefund: false });
    expect(await db.commerceOrderRefund.count({ where: { vendorId: input.vendor.id } })).toBe(0);
  });
});

describe("paid receipt for post-purchase targets", () => {
  it("sends no paid receipt for a target paid after its credit was released", async () => {
    const input = await fixture(); const first = await upgrade(input, { providerName: "payuni" }); const db = getDb();
    await processPaymentWebhook(PaymentWebhookPayload.parse({ provider: "payuni", eventId: `ppu-failed-${randomUUID()}`,
      eventType: "failed", vendorId: input.vendor.id, orderNumber: first.payment.orderNumber, providerTradeNo: "synthetic-mail-trade" }));
    await processPaymentWebhook(PaymentWebhookPayload.parse({ provider: "payuni", eventId: `ppu-paid-${randomUUID()}`,
      eventType: "paid", vendorId: input.vendor.id, orderNumber: first.payment.orderNumber, providerTradeNo: "synthetic-mail-trade",
      grossAmountCents: 9_500, currency: "TWD" }));
    expect((await db.commerceOrder.findUniqueOrThrow({ where: { id: first.targetOrderId } })).status).toBe("paid");
    expect(await manualReviewFlags(input.vendor.id, first.targetOrderId)).toHaveLength(1);
    expect(await db.emailDelivery.count({ where: { vendorId: input.vendor.id, idempotencyKey: `order-paid:v1:${first.targetOrderId}` } })).toBe(0);
    expect(immediate.schedule.mock.calls.flatMap(([ids]) => ids).filter(Boolean)).toEqual([]);
  });

  it("still sends the paid receipt for a normally superseding PayUni target", async () => {
    const input = await fixture(); const result = await upgrade(input, { providerName: "payuni" }); const db = getDb();
    const committedAtSchedule = recordCommittedAtSchedule();
    await processPaymentWebhook(PaymentWebhookPayload.parse({ provider: "payuni", eventId: `ppu-paid-${randomUUID()}`,
      eventType: "paid", vendorId: input.vendor.id, orderNumber: result.payment.orderNumber, providerTradeNo: "synthetic-paid-trade",
      grossAmountCents: 9_500, currency: "TWD" }));
    expect((await db.postPurchaseCredit.findFirstOrThrow({ where: { vendorId: input.vendor.id } })).supersededAt).not.toBeNull();
    expect(await db.emailDelivery.count({ where: { vendorId: input.vendor.id, idempotencyKey: `order-paid:v1:${result.targetOrderId}` } })).toBe(1);
    // Handed to the post-response hook once, only after the payment transaction committed.
    expect(immediate.schedule.mock.calls.flatMap(([ids]) => ids).filter(Boolean)).toEqual([`order_paid_${result.targetOrderId}`]);
    // Read outside the payment transaction at the moment of scheduling: the row was already committed.
    await expect(Promise.all(committedAtSchedule)).resolves.toEqual([{ id: `order_paid_${result.targetOrderId}`, committed: true }]);
    // A replayed provider callback finds the existing receipt and schedules nothing new.
    immediate.schedule.mockClear();
    await processPaymentWebhook(PaymentWebhookPayload.parse({ provider: "payuni", eventId: `ppu-paid-${randomUUID()}`,
      eventType: "paid", vendorId: input.vendor.id, orderNumber: result.payment.orderNumber, providerTradeNo: "synthetic-paid-trade",
      grossAmountCents: 9_500, currency: "TWD" }));
    expect(immediate.schedule.mock.calls.flatMap(([ids]) => ids).filter(Boolean)).toEqual([]);
  });

  it("schedules the receipt once, from the committed retry, when a serialization failure rolls back the first attempt", async () => {
    const input = await fixture(); const result = await upgrade(input, { providerName: "payuni" }); const db = getDb();
    const committedAtSchedule = recordCommittedAtSchedule();
    immediate.serializationFailures = 1;

    await processPaymentWebhook(PaymentWebhookPayload.parse({ provider: "payuni", eventId: `ppu-paid-${randomUUID()}`,
      eventType: "paid", vendorId: input.vendor.id, orderNumber: result.payment.orderNumber, providerTradeNo: "synthetic-retry-trade",
      grossAmountCents: 9_500, currency: "TWD" }));

    // The first attempt wrote the receipt row and was rolled back; the retry wrote it again and committed.
    expect(immediate.teamStageRuns).toBe(2);
    expect(await db.emailDelivery.count({ where: { vendorId: input.vendor.id, idempotencyKey: `order-paid:v1:${result.targetOrderId}` } })).toBe(1);
    expect(immediate.schedule).toHaveBeenCalledTimes(1);
    expect(immediate.schedule.mock.calls.flatMap(([ids]) => ids).filter(Boolean)).toEqual([`order_paid_${result.targetOrderId}`]);
    await expect(Promise.all(committedAtSchedule)).resolves.toEqual([{ id: `order_paid_${result.targetOrderId}`, committed: true }]);
  });
});

/**
 * Makes the scheduler spy start a read through the shared (non-transaction)
 * client synchronously when called. A row created by a still-open payment
 * transaction would not be visible to that read.
 */
function recordCommittedAtSchedule() {
  const checks: Array<Promise<{ id: string; committed: boolean }>> = [];
  immediate.schedule.mockImplementation((ids: Array<string | null | undefined>) => {
    for (const id of ids) {
      if (!id) continue;
      checks.push(getDb().emailDelivery.count({ where: { id } }).then((count) => ({ id, committed: count === 1 })));
    }
    return true;
  });
  return checks;
}

async function failedPreparation() {
  const input = await fixture(1); const result = await upgrade(input); const db = getDb();
  await db.paymentTransaction.update({ where: { id: result.payment.id }, data: {
    metadata: { productId: input.target.id, postPurchaseCredit: { sourceOrderId: input.orderId }, postPurchaseSessionState: "unissued" },
  } });
  await failPendingCheckoutAndReleaseInventory({ vendorId: input.vendor.id, transactionId: result.payment.id, reason: "provider_checkout_failed" });
  const request = new Request("http://127.0.0.1:31046/api/payments/checkout/recovery", {
    headers: { cookie: input.cookies.getAll().map(cookie => `${cookie.name}=${cookie.value}`).join("; ") },
  });
  const identity = { vendorId: input.vendor.id, productId: input.target.id, idempotencyKey: result.payment.checkoutIdempotencyKey! };
  expect(await postPurchaseRecoveryAvailable(db, { vendorId: input.vendor.id, orderId: result.targetOrderId })).toBe(true);
  return { input, result, db, request, identity };
}

async function targetCredit(context: { input: Fixture; result: { targetOrderId: string } }) {
  return getDb().postPurchaseCredit.findUniqueOrThrow({ where: { vendorId_targetOrderId: {
    vendorId: context.input.vendor.id, targetOrderId: context.result.targetOrderId } } });
}

describe("lapsed source on the resume path", () => {
  it("refuses resume and releases the credit once the source is older than 24 hours", async () => {
    const context = await failedPreparation();
    await context.db.commerceOrder.update({ where: { id: context.input.orderId }, data: {
      paidAt: new Date(Date.now() - POST_PURCHASE_CREDIT_WINDOW_MS - MINUTE) } });
    await expect(resumePostPurchaseCheckout(context.request, context.identity)).rejects.toThrow(PostPurchaseUnavailableError);
    expect((await targetCredit(context)).releasedAt).not.toBeNull();
    expect((await context.db.paymentTransaction.findUniqueOrThrow({ where: { id: context.result.payment.id } })).status).toBe("failed");
    expect((await context.db.product.findUniqueOrThrow({ where: { id: context.input.target.id } })).inventory).toBe(1);
    expect(await postPurchaseRecoveryAvailable(context.db, { vendorId: context.input.vendor.id, orderId: context.result.targetOrderId })).toBe(false);
  });

  it("refuses recovery and releases the credit once the source has shipped", async () => {
    const context = await failedPreparation();
    const shipping = await sourceShipping(context.input);
    await context.db.shippingFulfillment.update({ where: { id: shipping.id }, data: { status: "shipped", shippedAt: new Date() } });
    // The result-page check releases as soon as it sees the lapse ...
    expect(await postPurchaseRecoveryAvailable(context.db, { vendorId: context.input.vendor.id, orderId: context.result.targetOrderId })).toBe(false);
    expect((await targetCredit(context)).releasedAt).not.toBeNull();
    // ... and resume can never re-open it.
    await expect(resumePostPurchaseCheckout(context.request, context.identity)).rejects.toThrow(PostPurchaseUnavailableError);
    expect((await context.db.paymentTransaction.findUniqueOrThrow({ where: { id: context.result.payment.id } })).status).toBe("failed");
    expect((await sourceShipping(context.input)).status).toBe("shipped");
  });

  it("keeps the result page available when the lapsed-credit release conflicts", async () => {
    const context = await failedPreparation();
    const shipping = await sourceShipping(context.input);
    await context.db.shippingFulfillment.update({ where: { id: shipping.id }, data: { status: "shipped", shippedAt: new Date() } });
    const conflicting = {
      commerceOrder: context.db.commerceOrder,
      $transaction: () => Promise.reject(new Prisma.PrismaClientKnownRequestError("synthetic serialization conflict", { code: "P2034", clientVersion: "test" })),
    } as unknown as Parameters<typeof postPurchaseRecoveryAvailable>[0];
    expect(await postPurchaseRecoveryAvailable(conflicting, { vendorId: context.input.vendor.id, orderId: context.result.targetOrderId })).toBe(false);
    // The credit stays bound until the next render or resume releases it.
    expect((await targetCredit(context)).releasedAt).toBeNull();
    expect(await postPurchaseRecoveryAvailable(context.db, { vendorId: context.input.vendor.id, orderId: context.result.targetOrderId })).toBe(false);
    expect((await targetCredit(context)).releasedAt).not.toBeNull();
  });

  it("releases a lapsed credit through resume alone, before any result-page check", async () => {
    const context = await failedPreparation();
    const shipping = await sourceShipping(context.input);
    await context.db.shippingFulfillment.update({ where: { id: shipping.id }, data: { status: "shipped", shippedAt: new Date() } });
    await expect(resumePostPurchaseCheckout(context.request, context.identity)).rejects.toThrow(PostPurchaseUnavailableError);
    expect((await targetCredit(context)).releasedAt).not.toBeNull();
  });
});

describe("supersede and target-refund merchant signals", () => {
  it("leaves an already-shipped source shipment as-is, flags it and records the supersede", async () => {
    const input = await fixture(); const result = await upgrade(input); const db = getDb();
    const shipping = await sourceShipping(input);
    // The merchant ships the source between credit consume and target payment.
    await db.shippingFulfillment.update({ where: { id: shipping.id }, data: { status: "shipped", shippedAt: new Date() } });
    await paidTarget(input, result);
    const credit = await targetCredit({ input, result });
    expect(credit.supersededAt).not.toBeNull();
    expect((await sourceShipping(input)).status).toBe("shipped");
    const flags = await manualReviewFlags(input.vendor.id, input.orderId);
    expect(flags).toHaveLength(1);
    expect(flags[0]?.sanitizedData).toMatchObject({ reason: "superseded_source_already_shipped", creditId: credit.id,
      targetOrderId: result.targetOrderId, creditAmountCents: 10_000, autoRefund: false });
    expect(await db.commerceOrderEvent.count({ where: { vendorId: input.vendor.id, orderId: input.orderId, eventType: "post_purchase.superseded" } })).toBe(1);
  });

  it("writes post_purchase.superseded on the source timeline when delivery is revoked", async () => {
    const input = await fixture(); const result = await upgrade(input); const db = getDb();
    await paidTarget(input, result); await paidTarget(input, result);
    const events = await db.commerceOrderEvent.findMany({ where: { vendorId: input.vendor.id, orderId: input.orderId, eventType: "post_purchase.superseded" } });
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ actorType: "system", sanitizedData: {
      creditId: (await targetCredit({ input, result })).id, targetOrderId: result.targetOrderId, kind: "upsell" } });
    expect((await sourceShipping(input)).status).toBe("cancelled");
    expect(await manualReviewFlags(input.vendor.id, input.orderId)).toHaveLength(0);
  });

  it("flags both orders when a superseded target is refunded, without restoring or refunding", async () => {
    const input = await fixture(); const result = await upgrade(input); const db = getDb();
    await paidTarget(input, result);
    await db.$transaction(tx => reconcileCommerceOrderRefund(tx, { vendorId: input.vendor.id, orderId: result.targetOrderId,
      providerName: "demo", eventIdentity: randomUUID(), amountCents: 9_500, occurredAt: new Date() }),
    { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    const credit = await targetCredit({ input, result });
    for (const orderId of [result.targetOrderId, input.orderId]) {
      const flags = await manualReviewFlags(input.vendor.id, orderId);
      expect(flags).toHaveLength(1);
      expect(flags[0]?.sanitizedData).toMatchObject({ reason: "superseded_target_refunded", creditId: credit.id,
        sourceOrderId: input.orderId, targetOrderId: result.targetOrderId, creditAmountCents: 10_000,
        targetRefundedAmountCents: 9_500, autoRefund: false });
    }
    expect((await sourceShipping(input)).status).toBe("cancelled");
    expect(await db.commerceOrderRefund.count({ where: { vendorId: input.vendor.id, orderId: input.orderId } })).toBe(0);
    expect((await db.commerceOrder.findUniqueOrThrow({ where: { id: input.orderId } })).refundedAmountCents).toBe(0);
  });
});
