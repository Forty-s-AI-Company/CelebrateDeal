import { afterEach, describe, expect, it } from "vitest";
import { getDb } from "./db";
import { ensureWp4SandboxFixture, WP4_SANDBOX_FIXTURE as fixed } from "./wp4-sandbox-fixture";
import { createReservedPaymentTransaction } from "./inventory-reservations";
import { createCommerceOrderForCheckout } from "./commerce-orders";
import { PaymentWebhookPayload, processPaymentWebhook } from "./payment-webhooks";
import { readWp4ExistingBuyerState, wp4HistoricalBuyerWhere, WP4_BUYER_CONTINUATION_SOURCE as source } from "./wp4-buyer-recovery";
import { retryWp4HistoricalBuyerCallback } from "./wp4-buyer-callback-retry";
const db = getDb();
afterEach(async () => {
 await db.webhookEvent.deleteMany({ where: { vendorId: fixed.vendorId } });
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
