import { randomBytes, randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { assertLocalTestDatabase } from "../../scripts/local-database-safety";
import { createCommerceOrderForCheckout, reconcileCommerceOrderPaymentTransition, reconcileCommerceOrderRefund } from "./commerce-orders";
import { hashLiveViewerToken } from "./live-quota-admission";
import { listLivePurchaseBroadcasts, LivePurchaseBroadcastAccessDenied } from "./live-purchase-broadcasts";

let db: PrismaClient;
const vendorIds: string[] = [];
beforeAll(() => { assertLocalTestDatabase("DATABASE_URL", process.env.DATABASE_URL); db = new PrismaClient({ log: [] }); });
afterEach(async () => { await db.vendor.deleteMany({ where: { id: { in: vendorIds.splice(0) } } }); });
afterAll(async () => { await db.$disconnect(); });

async function fixture() {
  const suffix = randomUUID(), now = new Date();
  const vendor = await db.vendor.create({ data: { name: "Synthetic broadcast vendor", slug: `broadcast-${suffix}`, email: `${suffix}@example.test`, passwordHash: "synthetic-test-hash" } });
  vendorIds.push(vendor.id);
  const product = await db.product.create({ data: { vendorId: vendor.id, name: "本場合成商品", slug: `product-${suffix}`, priceCents: 1200, isActive: true, fulfillmentTypeConfirmed: true, fulfillmentType: "physical", commerceDomain: "merchant" } });
  const live = await db.live.create({ data: { vendorId: vendor.id, title: "Synthetic live", slug: `live-${suffix}`, scheduledAt: now, status: "published" } });
  await db.liveProduct.create({ data: { vendorId: vendor.id, liveId: live.id, productId: product.id } });
  const admissionToken = randomBytes(32).toString("base64url");
  await db.liveViewerSession.create({ data: { vendorId: vendor.id, liveId: live.id, tokenHash: hashLiveViewerToken(admissionToken), lastSeenAt: now, expiresAt: new Date(now.getTime() + 60_000) } });
  const input = { vendorId: vendor.id, liveId: live.id, admissionToken, now };
  async function checkout(sourceLiveId: string, selectedProduct = product, paid = true) {
    const identity = randomUUID();
    return db.$transaction(async tx => {
      const payment = await tx.paymentTransaction.create({ data: { vendorId: vendor.id, providerName: "synthetic", status: paid ? "paid" : "pending", grossAmountCents: 1200, netAmountCents: 1200, metadata: { productId: selectedProduct.id, sourceLiveId } } });
      const order = await createCommerceOrderForCheckout(tx, {
        vendorId: vendor.id, productId: selectedProduct.id, paymentTransactionId: payment.id,
        orderNumber: `BROADCAST-${identity}`, checkoutIdempotencyKey: identity, totalAmountCents: 1200, currency: "TWD", now,
        buyer: { name: "合成買家", email: `${identity}@example.test`, phone: "0912345678" },
        shipping: { recipientName: "合成買家", phone: "0912345678", countryCode: "TW", postalCode: "100", administrativeArea: "台北市", locality: "中正區", addressLine1: "合成測試路 1 號" },
      });
      if (paid) await reconcileCommerceOrderPaymentTransition(tx, { vendorId: vendor.id, paymentTransactionId: payment.id, eventIdentity: identity, transition: "paid", occurredAt: now });
      return { order, payment };
    });
  }
  return { vendor, product, live, input, checkout };
}

describe("live purchase broadcasts disposable PostgreSQL", () => {
  it("shows only this tenant's server-attributed paid purchase, not another live or product", async () => {
    const f = await fixture(); const accepted = await f.checkout(f.live.id);
    await f.checkout(`other-live-${randomUUID()}`);
    const otherProduct = await db.product.create({ data: { vendorId: f.vendor.id, name: "其他商品", slug: `other-${randomUUID()}`, priceCents: 1200, isActive: true, fulfillmentTypeConfirmed: true, fulfillmentType: "physical", commerceDomain: "merchant" } });
    await f.checkout(f.live.id, otherProduct); await f.checkout(f.live.id, f.product, false);
    const foreign = await fixture(); await foreign.checkout(foreign.live.id);
    const result = await listLivePurchaseBroadcasts(db, f.input);
    expect(result).toHaveLength(1); expect(result[0].productName).toBe("本場合成商品");
    expect(JSON.stringify(result)).not.toContain(accepted.order.id); expect(JSON.stringify(result)).not.toContain(accepted.payment.id);
  });
  it("removes purchases after an actual canonical partial refund transition", async () => {
    const f = await fixture(); const accepted = await f.checkout(f.live.id);
    expect(await listLivePurchaseBroadcasts(db, f.input)).toHaveLength(1);
    await db.$transaction(tx => reconcileCommerceOrderRefund(tx, { vendorId: f.vendor.id, orderId: accepted.order.id, paymentTransactionId: accepted.payment.id, providerName: "synthetic", eventIdentity: randomUUID(), amountCents: 100, occurredAt: f.input.now }));
    expect(await listLivePurchaseBroadcasts(db, f.input)).toEqual([]);
    expect(await db.commerceOrder.findUniqueOrThrow({ where: { id: accepted.order.id } })).toMatchObject({ status: "partially_refunded", refundedAmountCents: 100 });
  });
  it("never broadens visibility when the live has no visible products", async () => {
    const f = await fixture(); await f.checkout(f.live.id);
    await db.liveProduct.updateMany({ where: { vendorId: f.vendor.id, liveId: f.live.id }, data: { isVisible: false } });
    expect(await listLivePurchaseBroadcasts(db, f.input)).toEqual([]);
    await db.liveProduct.deleteMany({ where: { vendorId: f.vendor.id, liveId: f.live.id } });
    expect(await listLivePurchaseBroadcasts(db, f.input)).toEqual([]);
  });
  it("denies another viewer scope and an expired admission", async () => {
    const f = await fixture(), foreign = await fixture(); await f.checkout(f.live.id);
    await expect(listLivePurchaseBroadcasts(db, { ...foreign.input, admissionToken: f.input.admissionToken })).rejects.toBeInstanceOf(LivePurchaseBroadcastAccessDenied);
    await db.liveViewerSession.updateMany({ where: { tokenHash: hashLiveViewerToken(f.input.admissionToken) }, data: { expiresAt: f.input.now } });
    await expect(listLivePurchaseBroadcasts(db, f.input)).rejects.toBeInstanceOf(LivePurchaseBroadcastAccessDenied);
  });
  it("excludes explicitly marked test orders", async () => {
    const f = await fixture(); const accepted = await f.checkout(f.live.id);
    await db.commerceOrder.update({ where: { id: accepted.order.id }, data: { isTestOrder: true } });
    expect(await listLivePurchaseBroadcasts(db, f.input)).toEqual([]);
  });
  it("includes the 101st visible product without widening the live scope", async () => {
    const f = await fixture();
    const products = Array.from({ length: 100 }, (_, index) => ({
      id: `broadcast-product-${randomUUID()}`, vendorId: f.vendor.id,
      name: `合成商品 ${index + 2}`, slug: `broadcast-product-${randomUUID()}`,
      priceCents: 1200, isActive: true, fulfillmentTypeConfirmed: true,
      fulfillmentType: "physical" as const, commerceDomain: "merchant",
    }));
    await db.product.createMany({ data: products });
    await db.liveProduct.createMany({ data: products.map((product, index) => ({
      vendorId: f.vendor.id, liveId: f.live.id, productId: product.id, sortOrder: index + 1,
    })) });
    const last = await db.product.findUniqueOrThrow({ where: { id: products[99].id } });
    await f.checkout(f.live.id, last);
    const result = await listLivePurchaseBroadcasts(db, f.input);
    expect(result).toHaveLength(1);
    expect(result[0].productName).toBe("合成商品 101");
  });
});
