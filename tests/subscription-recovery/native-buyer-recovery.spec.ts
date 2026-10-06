import { randomUUID } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import { WP4_SANDBOX_FIXTURE as fixed } from "../../src/lib/wp4-sandbox-fixture";
import { createReservedPaymentTransaction } from "../../src/lib/inventory-reservations";
import { createCommerceOrderForCheckout } from "../../src/lib/commerce-orders";
import { wp4HistoricalBuyerWhere, WP4_BUYER_CONTINUATION_SOURCE } from "../../src/lib/wp4-buyer-recovery";
import { buildPayUniSandboxWebhookFixture } from "../../src/lib/payment-providers/payuni-fixtures";

test.use({ trace: "off", screenshot: "off", video: "off" });
const source = process.env.Q2_BROWSER_SOURCE_SHA!, job = "synthetic-q2-browser-job-secret";
async function ops(page: Page, name: string) {
 return page.evaluate(async ({ name, source, job }) => {
  const response = await fetch(`/api/admin/ops/payuni/${name}`, { method: "POST", headers: { authorization: `Bearer ${job}`, "x-celebratedeal-source-sha": source } });
  return { status: response.status, body: await response.json() };
 }, { name, source, job });
}
async function callback(page: Page, body: string) {
 return page.evaluate(async body => {
  const response = await fetch("/api/webhooks/payments?provider=payuni&source=notify", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body });
  return response.status;
 }, body);
}

test("browser recovers the exact historical buyer callback once and proves full refund without provider contact", async ({ page, baseURL }) => {
 const db = new PrismaClient(), suffix = randomUUID();
 const paidEvent = `q2-buyer-paid-${suffix}`, refundedEvent = `q2-buyer-refunded-${suffix}`;
 let externalRequests = 0;
 await page.route("**/*", async route => {
  if (new URL(route.request().url()).origin === baseURL) return route.continue();
  externalRequests++; return route.abort();
 });
 try {
  await page.goto("/login");
  expect(await page.evaluate(async () => (await fetch("/api/admin/ops/payuni/wp4-buyer-callback-retry", { method: "POST" })).status)).toBe(401);
  expect((await ops(page, "wp4-fixture")).status).toBe(200);
  await db.vendorSubscription.create({ data: { vendorId: fixed.vendorId, planId: fixed.planId, status: "active", paymentMode: "platform" } });
  const key = wp4HistoricalBuyerWhere().checkoutIdempotencyKey, orderNumber = `q2-buyer-${suffix}`, tradeNo = `q2-trade-${suffix}`;
  // Synthetic pre-existing historical checkout uses the canonical domain constructors.
  // This fixture is not evidence of an external payment or refund.
  const payment = await createReservedPaymentTransaction({ vendorId: fixed.vendorId, productId: fixed.productId, checkoutIdempotencyKey: key,
   transactionData: { vendorId: fixed.vendorId, providerName: "payuni", orderNumber, providerTradeNo: tradeNo, paymentMode: "platform", grossAmountCents: 100, netAmountCents: 100, currency: "TWD", status: "pending", checkoutIdempotencyKey: key,
    metadata: { billingPurpose: "buyer_order", productId: fixed.productId, wp4SourceCommit: WP4_BUYER_CONTINUATION_SOURCE, wp4PaymentSubmissionReserved: true } },
   createCommerceOrder: async (tx, transaction) => { await createCommerceOrderForCheckout(tx, { vendorId: fixed.vendorId, productId: fixed.productId, orderNumber, checkoutIdempotencyKey: key, paymentTransactionId: transaction.id, totalAmountCents: 100, currency: "TWD", buyer: { name: "Synthetic buyer", email: "synthetic-buyer@invalid.example" }, shipping: null }); },
  });
  const signed = (fixture: "paid" | "refunded", eventId: string) => buildPayUniSandboxWebhookFixture({ fixture, merchantId: "SYNTHETIC", hashKey: "0123456789abcdef0123456789abcdef", hashIv: "0123456789abcdef",
   overrides: { EventId: eventId, MerTradeNo: orderNumber, TradeNo: tradeNo, TradeAmt: 1, NetAmount: 1, GatewayFee: 0, PlatformFee: 0, ReferralCode: "", RefundAmount: 1, GatewayFeeRefund: 0, PlatformFeeRefund: 0 } });
  const paidBody = signed("paid", paidEvent), invalid = new URLSearchParams(paidBody); invalid.set("HashInfo", "INVALID_SYNTHETIC_SIGNATURE");
  expect(await callback(page, invalid.toString())).toBe(401);
  expect(await db.webhookEvent.count({ where: { eventId: paidEvent } })).toBe(0);
  await db.paymentTransaction.update({ where: { id: payment.id }, data: { grossAmountCents: 101 } });
  expect(await callback(page, paidBody)).toBe(500);
  expect(await db.webhookEvent.findUniqueOrThrow({ where: { provider_eventId: { provider: "payuni", eventId: paidEvent } } })).toMatchObject({ status: "failed", retryCount: 1, vendorId: null });
  await db.paymentTransaction.update({ where: { id: payment.id }, data: { grossAmountCents: 100 } });
  const retries = await Promise.all([ops(page, "wp4-buyer-callback-retry"), ops(page, "wp4-buyer-callback-retry")]);
  expect(retries.every(response => response.status === 200)).toBe(true);
  expect(retries.filter(response => response.body.status === "PROCESSED")).toHaveLength(1);
  expect(retries.reduce((total, response) => total + response.body.retryAttempts, 0)).toBe(1);
  expect((await ops(page, "wp4-buyer-existing-state")).body).toEqual({ status: "VERIFIED", paymentStatus: "PAID", orderPaid: true, inventoryCommitted: true, notificationQueued: true, refundReconciled: false });
  await page.reload();
  expect((await ops(page, "wp4-buyer-callback-retry")).body).toMatchObject({ status: "ALREADY_PROCESSED", retryAttempts: 0 });
  const refundedBody = signed("refunded", refundedEvent);
  expect(await callback(page, refundedBody)).toBe(200); expect(await callback(page, refundedBody)).toBe(200);
  expect((await ops(page, "wp4-buyer-existing-state")).body).toEqual({ status: "VERIFIED", paymentStatus: "REFUNDED", orderPaid: true, inventoryCommitted: true, notificationQueued: true, refundReconciled: true });
  expect(await db.refundRecord.count({ where: { paymentTransactionId: payment.id, status: "processed" } })).toBe(1);
  expect(await page.evaluate(async ({ source, job }) => (await fetch("/api/admin/ops/payuni/wp4-buyer-existing-state", { method: "POST", headers: { authorization: `Bearer ${job}`, "x-celebratedeal-source-sha": source, "content-type": "application/json" }, body: JSON.stringify({ transactionId: "foreign-transaction", amount: 1 }) })).status, { source, job })).toBe(404);
  expect(externalRequests).toBe(0);
 } finally {
  await db.webhookEvent.deleteMany({ where: { OR: [{ vendorId: fixed.vendorId }, { eventId: { in: [paidEvent, refundedEvent] } }] } });
  await db.vendor.deleteMany({ where: { id: fixed.vendorId } });
  await db.user.deleteMany({ where: { id: fixed.userId } });
  await db.billingPlan.deleteMany({ where: { id: fixed.planId } }); await db.$disconnect();
 }
});
