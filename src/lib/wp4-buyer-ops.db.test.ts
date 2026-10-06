import { afterEach, describe, expect, it, vi } from "vitest";
import { POST as paymentCallback } from "../app/api/webhooks/payments/route";
import { buildPayUniSandboxWebhookFixture } from "./payment-providers/payuni-fixtures";
import { getDb } from "./db";
import { ensureWp4SandboxFixture, WP4_SANDBOX_FIXTURE as fixed } from "./wp4-sandbox-fixture";
import { createReservedPaymentTransaction } from "./inventory-reservations";
import { createCommerceOrderForCheckout } from "./commerce-orders";
import { PaymentWebhookPayload, processPaymentWebhook } from "./payment-webhooks";
import { readWp4ExistingBuyerState, wp4HistoricalBuyerWhere, WP4_BUYER_CONTINUATION_SOURCE as source } from "./wp4-buyer-recovery";
import { retryWp4HistoricalBuyerCallback } from "./wp4-buyer-callback-retry";
const db = getDb();
afterEach(async () => {
 vi.unstubAllEnvs();
 await db.webhookEvent.deleteMany({ where: { OR: [{ vendorId: fixed.vendorId }, { eventId: { in: ["synthetic-buyer-route-paid", "synthetic-buyer-concurrent-paid"] } }] } });
 await db.vendor.deleteMany({ where: { id: fixed.vendorId } });
 await db.user.deleteMany({ where: { id: fixed.userId } });
 await db.billingPlan.deleteMany({ where: { id: fixed.planId } });
});
async function checkout() {
 await ensureWp4SandboxFixture(db);
 await db.vendorSubscription.create({ data: { vendorId: fixed.vendorId, planId: fixed.planId, status: "active", paymentMode: "platform" } });
 const key = wp4HistoricalBuyerWhere().checkoutIdempotencyKey;
 const payment = await createReservedPaymentTransaction({ vendorId: fixed.vendorId, productId: fixed.productId, checkoutIdempotencyKey: key,
  transactionData: { vendorId: fixed.vendorId, providerName: "payuni", orderNumber: "synthetic-historical-buyer", providerTradeNo: "synthetic-buyer-trade", paymentMode: "platform", grossAmountCents: 100, netAmountCents: 100, currency: "TWD", status: "pending", checkoutIdempotencyKey: key,
   metadata: { billingPurpose: "buyer_order", productId: fixed.productId, wp4SourceCommit: source, wp4PaymentSubmissionReserved: true } },
  createCommerceOrder: async (tx, transaction) => { await createCommerceOrderForCheckout(tx, { vendorId: fixed.vendorId, productId: fixed.productId, orderNumber: "synthetic-historical-buyer", checkoutIdempotencyKey: key, paymentTransactionId: transaction.id, totalAmountCents: 100, currency: "TWD", buyer: { name: "Synthetic buyer", email: "synthetic-buyer@invalid.example" }, shipping: null }); },
 });
 const payload = PaymentWebhookPayload.parse({ provider: "payuni", eventId: "synthetic-buyer-paid", eventType: "paid", vendorId: fixed.vendorId, orderNumber: payment.orderNumber, providerTradeNo: payment.providerTradeNo, grossAmountCents: 100, netAmountCents: 100, currency: "TWD" });
 return { payment, payload };
}
describe("fixed historical buyer PostgreSQL recovery", () => {
 it("permits one recovery dispatch under concurrent requests and rejects replay", async () => {
  const { payment, payload } = await checkout();
  const normalized = { ...payload };
  delete normalized.vendorId;
  delete normalized.currency;
  const event = await db.webhookEvent.create({ data: { provider: "payuni", eventId: "synthetic-buyer-concurrent-paid", eventType: "paid", status: "failed", retryCount: 1, maxRetries: 5,
   payload: { normalized: JSON.parse(JSON.stringify({ ...normalized, eventId: "synthetic-buyer-concurrent-paid" })) } } });
  const outcomes = await Promise.all([retryWp4HistoricalBuyerCallback(db), retryWp4HistoricalBuyerCallback(db)]);
  expect(outcomes.filter(outcome => outcome.status === "PROCESSED")).toHaveLength(1);
  expect(outcomes.reduce((total, outcome) => total + outcome.retryAttempts, 0)).toBe(1);
  expect(outcomes.every(outcome => ["PROCESSED", "RETRY_REJECTED", "ALREADY_PROCESSED"].includes(outcome.status))).toBe(true);
  expect(await db.webhookEvent.findUniqueOrThrow({ where: { id: event.id } })).toMatchObject({ status: "processed", retryCount: 2, vendorId: fixed.vendorId });
  await expect(retryWp4HistoricalBuyerCallback(db)).resolves.toEqual({ status: "ALREADY_PROCESSED", retryAttempts: 0, failureCode: "NONE" });
  const order = await db.commerceOrder.findFirstOrThrow({ where: { primaryPaymentTransactionId: payment.id } });
  expect(await db.commerceOrderEvent.count({ where: { orderId: order.id, eventType: "payment.paid" } })).toBe(1);
  await expect(readWp4ExistingBuyerState(db)).resolves.toMatchObject({ status: "VERIFIED", paymentStatus: "PAID" });
 });
 it("recovers a signature-verified real PayUni route first failure with missing tenant and currency", async () => {
  const { payment } = await checkout();
  vi.stubEnv("PAYMENT_PROVIDER", "payuni");
  vi.stubEnv("PAYUNI_ENV", "sandbox");
  vi.stubEnv("PAYUNI_SANDBOX_MERCHANT_ID", "SYNTHETIC");
  vi.stubEnv("PAYUNI_SANDBOX_HASH_KEY", "0123456789abcdef0123456789abcdef");
  vi.stubEnv("PAYUNI_SANDBOX_HASH_IV", "0123456789abcdef");
  // A recoverable local payment mismatch must fail after signature verification.
  await db.paymentTransaction.update({ where: { id: payment.id }, data: { grossAmountCents: 101 } });
  const body = buildPayUniSandboxWebhookFixture({ fixture: "paid", merchantId: "SYNTHETIC", hashKey: "0123456789abcdef0123456789abcdef", hashIv: "0123456789abcdef",
   overrides: { EventId: "synthetic-buyer-route-paid", MerTradeNo: payment.orderNumber!, TradeNo: payment.providerTradeNo!, TradeAmt: 1, NetAmount: 1, GatewayFee: 0, PlatformFee: 0, ReferralCode: "" } });
  const response = await paymentCallback(new Request("http://127.0.0.1:31041/api/webhooks/payments?provider=payuni&source=notify", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body }));
  expect(response.status).toBe(500);
  const event = await db.webhookEvent.findUniqueOrThrow({ where: { provider_eventId: { provider: "payuni", eventId: "synthetic-buyer-route-paid" } } });
  expect(event).toMatchObject({ status: "failed", retryCount: 1, vendorId: null });
  expect(event.payload).toMatchObject({ normalized: { orderNumber: payment.orderNumber, grossAmountCents: 100 } });
  expect((event.payload as { normalized: Record<string, unknown> }).normalized).not.toHaveProperty("currency");
  await db.paymentTransaction.update({ where: { id: payment.id }, data: { grossAmountCents: 100 } });
  await expect(retryWp4HistoricalBuyerCallback(db)).resolves.toEqual({ status: "PROCESSED", retryAttempts: 1, failureCode: "NONE" });
  await expect(retryWp4HistoricalBuyerCallback(db)).resolves.toEqual({ status: "ALREADY_PROCESSED", retryAttempts: 0, failureCode: "NONE" });
  await expect(readWp4ExistingBuyerState(db)).resolves.toMatchObject({ status: "VERIFIED", paymentStatus: "PAID" });
 });
 it("proves paid inventory/email/order and one full refund under duplicate callbacks", async () => {
  const { payment, payload } = await checkout(); await processPaymentWebhook(payload); await processPaymentWebhook(payload);
  await expect(readWp4ExistingBuyerState(db)).resolves.toMatchObject({ status: "VERIFIED", paymentStatus: "PAID", refundReconciled: false });
  const refund = PaymentWebhookPayload.parse({ provider: "payuni", eventId: "synthetic-buyer-refunded", eventType: "refunded", vendorId: fixed.vendorId, orderNumber: payment.orderNumber, refundAmountCents: 100, currency: "TWD" });
  await processPaymentWebhook(refund); await processPaymentWebhook(refund);
  await expect(readWp4ExistingBuyerState(db)).resolves.toMatchObject({ status: "VERIFIED", paymentStatus: "REFUNDED", refundReconciled: true });
  expect(await db.refundRecord.count({ where: { paymentTransactionId: payment.id, status: "processed" } })).toBe(1);
 });
 it("retries only the exact stored failed callback and refuses a second dispatch", async () => {
  const { payload } = await checkout();
  await db.webhookEvent.create({ data: { provider: "payuni", eventId: payload.eventId, eventType: "paid", vendorId: fixed.vendorId, status: "failed", retryCount: 0, maxRetries: 3, payload: { normalized: JSON.parse(JSON.stringify(payload)) } } });
  await expect(retryWp4HistoricalBuyerCallback(db)).resolves.toEqual({ status: "PROCESSED", retryAttempts: 1, failureCode: "NONE" });
  await expect(retryWp4HistoricalBuyerCallback(db)).resolves.toEqual({ status: "ALREADY_PROCESSED", retryAttempts: 0, failureCode: "NONE" });
  await expect(readWp4ExistingBuyerState(db)).resolves.toMatchObject({ status: "VERIFIED", paymentStatus: "PAID" });
 });
 it("rejects a mismatched normalized tenant before retry reservation", async () => {
  const { payment, payload } = await checkout();
  await db.webhookEvent.create({ data: { provider: "payuni", eventId: payload.eventId, eventType: "paid", vendorId: fixed.vendorId, status: "failed", retryCount: 0, maxRetries: 3, payload: { normalized: { ...JSON.parse(JSON.stringify(payload)), vendorId: "foreign-tenant" } } } });
  await expect(retryWp4HistoricalBuyerCallback(db)).resolves.toEqual({ status: "RETRY_REJECTED", retryAttempts: 0, failureCode: "UNKNOWN" });
  expect((await db.paymentTransaction.findUniqueOrThrow({ where: { id: payment.id } })).metadata).not.toHaveProperty("wp4CallbackRetryReserved");
 });
 it("ignores a payment whose source has changed even if all monetary fields match", async () => {
  const { payment } = await checkout();
  await db.paymentTransaction.update({ where: { id: payment.id }, data: { metadata: { billingPurpose: "buyer_order", productId: fixed.productId, wp4SourceCommit: "b".repeat(40), wp4PaymentSubmissionReserved: true } } });
  await expect(readWp4ExistingBuyerState(db)).resolves.toEqual({ status: "FIXTURE_UNAVAILABLE" });
  await expect(retryWp4HistoricalBuyerCallback(db)).resolves.toMatchObject({ status: "FIXTURE_UNAVAILABLE", retryAttempts: 0 });
 });
});
