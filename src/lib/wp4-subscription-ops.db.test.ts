import { afterEach, describe, expect, it } from "vitest";
import { getDb } from "./db";
import { ensureWp4SandboxFixture, WP4_SANDBOX_FIXTURE as fixed } from "./wp4-sandbox-fixture";
import { reserveWp4PayUniPaymentAttempt } from "./wp4-payuni-sandbox-payment-attempt";
import { readWp4SubscriptionState } from "./wp4-subscription-state";
import { PaymentWebhookPayload, processPaymentWebhook } from "./payment-webhooks";
const db = getDb(), source = "a".repeat(40);
afterEach(async () => {
 await db.vendor.deleteMany({ where: { id: fixed.vendorId } });
 await db.user.deleteMany({ where: { id: fixed.userId } });
 await db.billingPlan.deleteMany({ where: { id: fixed.planId } });
});
async function checkout() {
 await ensureWp4SandboxFixture(db);
 const subscription = await db.vendorSubscription.create({ data: { vendorId: fixed.vendorId, planId: fixed.planId, status: "pending_payment", paymentMode: "platform" } });
 const payment = await db.paymentTransaction.create({ data: { vendorId: fixed.vendorId, providerName: "payuni", providerTradeNo: "synthetic-trade", orderNumber: "synthetic-wp4-subscription", paymentMode: "platform", grossAmountCents: 100, netAmountCents: 100, currency: "TWD", status: "pending",
  metadata: { billingPurpose: "platform_subscription_checkout", billingPlanId: fixed.planId, platformSubscriptionId: subscription.id, wp4SourceCommit: source } } });
 return { subscription, payment };
}
describe("WP4 native subscription PostgreSQL operations", () => {
 it("keeps fixed fixtures private and preserves consumed inventory and paid invoices on replay", async () => {
  await ensureWp4SandboxFixture(db);
  await db.product.update({ where: { id: fixed.productId }, data: { inventory: 17 } });
  const paidAt = new Date("2026-10-06T00:00:00Z");
  await db.invoice.update({ where: { id: fixed.invoiceId }, data: { status: "paid", paidAt } });
  await ensureWp4SandboxFixture(db);
  expect((await db.billingPlan.findUniqueOrThrow({ where: { id: fixed.planId } })).isActive).toBe(false);
  expect((await db.product.findUniqueOrThrow({ where: { id: fixed.productId } })).inventory).toBe(17);
  expect(await db.invoice.findUniqueOrThrow({ where: { id: fixed.invoiceId } })).toMatchObject({ status: "paid", paidAt });
 });
 it("allows only one concurrent subscription form reservation and refuses replay", async () => {
  const f = await checkout();
  const results = await Promise.allSettled([reserveWp4PayUniPaymentAttempt(db, source, "platform_subscription"), reserveWp4PayUniPaymentAttempt(db, source, "platform_subscription")]);
  const successes = results.flatMap(r => r.status === "fulfilled" ? [r.value] : []);
  expect(successes.filter(r => r.status === "SUBMIT_ALLOWED")).toHaveLength(1);
  for (const result of results) if (result.status === "rejected") expect(result.reason).toMatchObject({ code: "P2034" });
  await expect(reserveWp4PayUniPaymentAttempt(db, source, "platform_subscription")).resolves.toEqual({ status: "ALREADY_RESERVED", reservationCreated: false });
  expect((await db.paymentTransaction.findUniqueOrThrow({ where: { id: f.payment.id } })).metadata).toMatchObject({ wp4PaymentSubmissionReserved: true });
 });
 it("proves native paid activation, exact full refund and duplicate callback idempotency without provider network", async () => {
  const f = await checkout();
  await processPaymentWebhook(PaymentWebhookPayload.parse({ provider: "payuni", eventId: "synthetic-subscription-paid", eventType: "paid", vendorId: fixed.vendorId, orderNumber: f.payment.orderNumber, providerTradeNo: f.payment.providerTradeNo, grossAmountCents: 100, netAmountCents: 100, currency: "TWD" }));
  await expect(readWp4SubscriptionState(db, source)).resolves.toEqual({ status: "ACTIVE_VERIFIED" });
  const refund = PaymentWebhookPayload.parse({ provider: "payuni", eventId: "synthetic-subscription-refunded", eventType: "refunded", vendorId: fixed.vendorId, orderNumber: f.payment.orderNumber, refundAmountCents: 100, currency: "TWD" });
  await processPaymentWebhook(refund); await processPaymentWebhook(refund);
  await expect(readWp4SubscriptionState(db, source)).resolves.toEqual({ status: "REFUNDED_VERIFIED" });
  expect(await db.refundRecord.count({ where: { paymentTransactionId: f.payment.id, status: "processed" } })).toBe(1);
 });
});
