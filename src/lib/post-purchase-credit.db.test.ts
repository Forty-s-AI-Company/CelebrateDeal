import { createHash, randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { afterEach, describe, expect, it } from "vitest";
import { getDb } from "@/lib/db";
import { BUYER_SUPPORT_COOKIE_PREFIX, issueBuyerSupportGrant } from "@/lib/buyer-support-access";
import { createCommerceOrderForCheckout, reconcileCommerceOrderPaymentTransition, reconcileCommerceOrderRefund } from "@/lib/commerce-orders";
import { createReservedPaymentTransaction, failPendingCheckoutAndReleaseInventory,
  reacquireReleasedCheckoutInventory, releaseExpiredInventoryReservations } from "@/lib/inventory-reservations";
import { protectProductDeliveryConfig } from "@/lib/product-delivery";
import { issuePostPurchaseCheckoutToken } from "@/lib/post-purchase-upsell";
import { assertPostPurchaseCreditReplay, consumePostPurchaseCredit, PostPurchaseUnavailableError, resolvePostPurchaseCreditQuote } from "./post-purchase-credit";

const ownedVendors: string[] = [];
const buyer = { name: "合成買家", email: "post-purchase@example.test", phone: "0912345678" };
const shipping = { recipientName: buyer.name, phone: buyer.phone, countryCode: "TW", postalCode: "106",
  administrativeArea: "Taipei", locality: "Da-an", addressLine1: "Synthetic Road 1" };

afterEach(async () => {
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

async function upgrade(input: Fixture) {
  const db = getDb();
  const quote = await resolvePostPurchaseCreditQuote(db, input.cookies, { token: input.token, vendorId: input.vendor.id, productId: input.target.id });
  const target = await db.product.findUniqueOrThrow({ where: { id: input.target.id } });
  let targetOrderId = "";
  const idempotencyKey = randomUUID();
  const payment = await createReservedPaymentTransaction({ vendorId: input.vendor.id, productId: target.id,
    expectedProductRevision: target.revision, checkoutIdempotencyKey: idempotencyKey,
    transactionData: { vendorId: input.vendor.id, checkoutIdempotencyKey: idempotencyKey, providerName: "demo",
      orderNumber: `PPU-TARGET-${randomUUID()}`, grossAmountCents: quote.checkoutAmountCents, netAmountCents: quote.checkoutAmountCents,
      currency: quote.currency, status: "pending", metadata: { synthetic: true, productId: target.id } },
    createCommerceOrder: async (tx, created, reservations) => {
      const order = await createCommerceOrderForCheckout(tx, { vendorId: input.vendor.id, productId: target.id,
        orderNumber: created.orderNumber!, checkoutIdempotencyKey: idempotencyKey, paymentTransactionId: created.id,
        totalAmountCents: quote.checkoutAmountCents, discountAmountCents: quote.creditAmountCents + quote.offerDiscountCents,
        currency: quote.currency, buyer, shipping: null });
      await consumePostPurchaseCredit(tx, input.cookies, { token: input.token, quote, targetOrderId: order.id,
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
    const credit = await getDb().postPurchaseCredit.findUniqueOrThrow({ where: { vendorId_sourceOrderId: { vendorId: input.vendor.id, sourceOrderId: input.orderId } } });
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
