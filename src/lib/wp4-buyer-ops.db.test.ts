import { afterEach, describe, expect, it, vi } from "vitest";
import { POST as paymentCallback } from "../app/api/webhooks/payments/route";
import { buildPayUniSandboxWebhookFixture } from "./payment-providers/payuni-fixtures";
import { getDb } from "./db";
import { ensureWp4SandboxFixture, WP4_SANDBOX_FIXTURE as fixed } from "./wp4-sandbox-fixture";
import { createReservedPaymentTransaction, releaseExpiredInventoryReservations } from "./inventory-reservations";
import { retryWebhookEvent } from "./webhook-retry";
import { createCommerceOrderForCheckout } from "./commerce-orders";
import { PaymentWebhookPayload, processPaymentWebhook } from "./payment-webhooks";
import { readWp4ExistingBuyerState, wp4HistoricalBuyerWhere, WP4_BUYER_CONTINUATION_SOURCE as source } from "./wp4-buyer-recovery";
import { retryQ1OriginalBuyerCallback, retryWp4HistoricalBuyerCallback, retryQ1OriginalAfterSchemaRepair } from "./wp4-buyer-callback-retry";
const db = getDb();
const raceVendorId = "wp4_synthetic_slug_race_vendor";
afterEach(async () => {
 vi.unstubAllEnvs();
 await db.webhookEvent.deleteMany({ where: { OR: [{ vendorId: fixed.vendorId }, { eventId: { startsWith: "manual:synthetic-buyer-" } }, { eventId: { in: ["synthetic-buyer-trade:1", "synthetic-buyer-route-paid", "synthetic-buyer-concurrent:1", "synthetic-buyer-trade:2", "synthetic-buyer-legacy-trade", "synthetic-buyer-close-1"] } }] } });
 await db.vendor.deleteMany({ where: { id: { in: [fixed.vendorId, raceVendorId] } } });
 await db.user.deleteMany({ where: { id: fixed.userId } });
 await db.billingPlan.deleteMany({ where: { id: fixed.planId } });
});
async function checkout(paymentSource = source) {
 await ensureWp4SandboxFixture(db);
 await db.vendorSubscription.create({ data: { vendorId: fixed.vendorId, planId: fixed.planId, status: "active", paymentMode: "platform" } });
 const key = wp4HistoricalBuyerWhere(paymentSource).checkoutIdempotencyKey;
 const payment = await createReservedPaymentTransaction({ vendorId: fixed.vendorId, productId: fixed.productId, checkoutIdempotencyKey: key,
  transactionData: { vendorId: fixed.vendorId, providerName: "payuni", orderNumber: "synthetic-historical-buyer", providerTradeNo: "synthetic-buyer-trade", paymentMode: "platform", grossAmountCents: 100, netAmountCents: 100, currency: "TWD", status: "pending", checkoutIdempotencyKey: key,
   metadata: { billingPurpose: "buyer_order", productId: fixed.productId, wp4SourceCommit: paymentSource, wp4PaymentSubmissionReserved: true } },
  createCommerceOrder: async (tx, transaction) => { await createCommerceOrderForCheckout(tx, { vendorId: fixed.vendorId, productId: fixed.productId, orderNumber: "synthetic-historical-buyer", checkoutIdempotencyKey: key, paymentTransactionId: transaction.id, totalAmountCents: 100, currency: "TWD", buyer: { name: "Synthetic buyer", email: "synthetic-buyer@invalid.example" }, shipping: null }); },
 });
 const payload = PaymentWebhookPayload.parse({ provider: "payuni", eventId: "synthetic-buyer-trade:1", eventType: "paid", vendorId: fixed.vendorId, orderNumber: payment.orderNumber, providerTradeNo: payment.providerTradeNo, grossAmountCents: 100, netAmountCents: 100, currency: "TWD" });
 return { payment, payload };
}
async function verifyOriginalCallbackRecovery(retryCount: number) {
  const { payment, payload } = await checkout("9acfe8d2dba62430e950cff2c0387841ab91f44b");
  const normalized = { ...payload }; delete normalized.vendorId;
  await db.webhookEvent.create({ data: { provider: "payuni", eventId: payload.eventId, eventType: "paid",
   status: "failed", retryCount, maxRetries: 5, payload: { normalized: JSON.parse(JSON.stringify(normalized)) } } });
  await expect(retryWp4HistoricalBuyerCallback(db)).resolves.toMatchObject({ status: "FIXTURE_UNAVAILABLE", retryAttempts: 0 });
  const outcomes = await Promise.all([retryQ1OriginalBuyerCallback(db), retryQ1OriginalBuyerCallback(db)]);
  expect(outcomes.filter(outcome => outcome.status === "PROCESSED")).toHaveLength(1);
  expect(outcomes.reduce((total, outcome) => total + outcome.retryAttempts, 0)).toBe(1);
  await expect(retryQ1OriginalBuyerCallback(db)).resolves.toMatchObject({ status: "ALREADY_PROCESSED", retryAttempts: 0 });
  expect(await db.paymentTransaction.count({ where: { vendorId: fixed.vendorId } })).toBe(1);
  expect(await db.paymentTransaction.findUniqueOrThrow({ where: { id: payment.id } })).toMatchObject({
   status: "paid", providerTradeNo: payment.providerTradeNo,
   metadata: { wp4PaymentSubmissionReserved: true, wp4CallbackRetryReserved: true },
  });
}
describe("fixed historical buyer PostgreSQL recovery", () => {
 it("recovers the original after schema repair once under contention without resetting the earlier marker", async () => {
  const { payment, payload } = await checkout("9acfe8d2dba62430e950cff2c0387841ab91f44b");
  const normalized = { ...payload }; delete normalized.vendorId;
  const event = await db.webhookEvent.create({ data: { provider: "payuni", eventId: payload.eventId, eventType: "paid",
   status: "failed", retryCount: 3, maxRetries: 5, payload: { normalized: JSON.parse(JSON.stringify(normalized)) } } });
  await db.paymentTransaction.update({ where: { id: payment.id }, data: {
   metadata: { ...(payment.metadata as Record<string, string | boolean>), wp4CallbackRetryReserved: true },
  } });
  await db.auditLog.create({ data: { vendorId: fixed.vendorId, actorLabel: "wp4_sandbox_fixed_callback_retry",
   action: "webhook_retry_failed", targetType: "WebhookEvent", targetId: event.id,
   before: { retryCount: 3 }, after: { status: "failed", errorCode: "processing_failed" } } });
  try {
   const outcomes = await Promise.all([retryQ1OriginalAfterSchemaRepair(db), retryQ1OriginalAfterSchemaRepair(db)]);
   expect(outcomes.filter(outcome => outcome.status === "PROCESSED")).toHaveLength(1);
   expect(outcomes.reduce((sum, outcome) => sum + outcome.retryAttempts, 0)).toBe(1);
   await expect(retryQ1OriginalAfterSchemaRepair(db)).resolves.toMatchObject({ status: "ALREADY_PROCESSED", retryAttempts: 0 });
   expect(await db.paymentTransaction.count({ where: { vendorId: fixed.vendorId } })).toBe(1);
   expect(await db.paymentTransaction.findUniqueOrThrow({ where: { id: payment.id } })).toMatchObject({ status: "paid",
    providerTradeNo: payment.providerTradeNo, metadata: { wp4CallbackRetryReserved: true, q1SchemaRecoveryReserved: true } });
   expect(await db.webhookEvent.findUniqueOrThrow({ where: { id: event.id } })).toMatchObject({ status: "processed", retryCount: 4, maxRetries: 5 });
   const audits = await db.auditLog.findMany({ where: { targetType: "WebhookEvent", targetId: event.id }, select: { actorLabel: true, action: true } });
   expect(audits.map(row => row.actorLabel).sort()).toEqual(["q1_sandbox_schema_recovery", "webhook:payuni", "wp4_sandbox_fixed_callback_retry"]);
   expect(audits.filter(row => row.action === "payment_webhook_paid")).toEqual([{ actorLabel: "webhook:payuni", action: "payment_webhook_paid" }]);
  } finally {
   await db.auditLog.deleteMany({ where: { targetType: "WebhookEvent", targetId: event.id } });
  }
 });
 it("recovers only the catalog-owned Q1 original callback once without another payment", () => verifyOriginalCallbackRecovery(1));
 it.each([2, 4])("recovers the original callback with remaining provider retry budget %i", retryCount => verifyOriginalCallbackRecovery(retryCount));
 it("permits one recovery dispatch under concurrent requests and rejects replay", async () => {
  const { payment, payload } = await checkout();
  const normalized = { ...payload };
  delete normalized.vendorId;
  delete normalized.currency;
  const event = await db.webhookEvent.create({ data: { provider: "payuni", eventId: "synthetic-buyer-concurrent:1", eventType: "paid", status: "failed", retryCount: 1, maxRetries: 5,
   payload: { normalized: JSON.parse(JSON.stringify({ ...normalized, eventId: "synthetic-buyer-concurrent:1" })) } } });
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
   overrides: { MerTradeNo: payment.orderNumber!, TradeNo: payment.providerTradeNo!, TradeAmt: 1, NetAmount: 1, GatewayFee: 0, PlatformFee: 0, ReferralCode: "" } });
  const response = await paymentCallback(new Request("http://127.0.0.1:31041/api/webhooks/payments?provider=payuni&source=notify", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body }));
  expect(response.status).toBe(500);
  const event = await db.webhookEvent.findUniqueOrThrow({ where: { provider_eventId: { provider: "payuni", eventId: `${payment.providerTradeNo}:1` } } });
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
 it.each([{ vendorSlug: "foreign-synthetic-tenant" }, { providerTradeNo: "foreign-synthetic-trade" }])("rejects a signed payload's conflicting tenant or trade before reservation or retry: %s", async conflict => {
  const { payment, payload } = await checkout();
  const normalized = { ...payload }; delete normalized.vendorId;
  const event = await db.webhookEvent.create({ data: { provider: "payuni", eventId: payload.eventId, eventType: "paid", status: "failed", retryCount: 1, maxRetries: 5,
   payload: { normalized: JSON.parse(JSON.stringify({ ...normalized, ...conflict })) } } });
  await expect(retryWp4HistoricalBuyerCallback(db)).resolves.toEqual({ status: "RETRY_REJECTED", retryAttempts: 0, failureCode: "UNKNOWN" });
  expect((await db.paymentTransaction.findUniqueOrThrow({ where: { id: payment.id } })).metadata).not.toHaveProperty("wp4CallbackRetryReserved");
  expect(await db.webhookEvent.findUniqueOrThrow({ where: { id: event.id } })).toMatchObject({ status: "failed", retryCount: 1, vendorId: null, updatedAt: event.updatedAt });
  expect(await db.paymentTransaction.count({ where: { vendorId: fixed.vendorId } })).toBe(1);
 });
 it("fails closed when a slug is reassigned after reservation and before dispatch", async () => {
  const { payment, payload } = await checkout();
  const normalized = { ...payload, vendorSlug: fixed.vendorSlug }; delete normalized.vendorId;
  const event = await db.webhookEvent.create({ data: { provider: "payuni", eventId: payload.eventId, eventType: "paid", status: "failed", retryCount: 1, maxRetries: 5,
   payload: { normalized: JSON.parse(JSON.stringify(normalized)) } } });
  let reassigned = false;
  // Pause only at the real committed reservation boundary; processing remains real PostgreSQL.
  const transaction = new Proxy(db.$transaction, { async apply(target, _receiver, args) {
   const result: unknown = await Reflect.apply(target, db, args);
   if (typeof result === "object" && result !== null && "status" in result && result.status === "RESERVED") {
    await db.vendor.update({ where: { id: fixed.vendorId }, data: { slug: `${fixed.vendorSlug}-renamed` } });
    await db.vendor.create({ data: { id: raceVendorId, name: "Synthetic race vendor", slug: fixed.vendorSlug,
     email: "synthetic-race-vendor@invalid.example", passwordHash: "synthetic-login-disabled" } });
    reassigned = true;
   }
   return result;
  } });
  await expect(retryWp4HistoricalBuyerCallback({ $transaction: transaction })).resolves.toEqual({ status: "RETRY_FAILED", retryAttempts: 1, failureCode: "scope_mismatch" });
  expect(reassigned).toBe(true);
  expect(await db.paymentTransaction.count({ where: { vendorId: raceVendorId } })).toBe(0);
  expect(await db.paymentTransaction.findUniqueOrThrow({ where: { id: payment.id } })).toMatchObject({ status: "pending", metadata: { wp4CallbackRetryReserved: true } });
  expect(await db.webhookEvent.findUniqueOrThrow({ where: { id: event.id } })).toMatchObject({ status: "failed", retryCount: 2, vendorId: null });
  const order = await db.commerceOrder.findFirstOrThrow({ where: { primaryPaymentTransactionId: payment.id } });
  expect(await db.commerceOrderEvent.count({ where: { orderId: order.id, eventType: "payment.paid" } })).toBe(0);
  expect(await db.commerceOrderEvent.count({ where: { orderId: order.id, eventType: "email.queued" } })).toBe(0);
  await expect(retryWp4HistoricalBuyerCallback(db)).resolves.toMatchObject({ status: "RETRY_REJECTED", retryAttempts: 0 });
 });
 it("rejects a changed reserved payment identity inside the processing transaction", async () => {
  const { payment, payload } = await checkout();
  await expect(processPaymentWebhook(payload, undefined, { vendorId: fixed.vendorId, paymentTransactionId: "synthetic-wrong-payment",
   providerName: "payuni", orderNumber: payment.orderNumber! })).rejects.toThrow();
  expect(await db.paymentTransaction.findUniqueOrThrow({ where: { id: payment.id } })).toMatchObject({ status: "pending" });
  const order = await db.commerceOrder.findFirstOrThrow({ where: { primaryPaymentTransactionId: payment.id } });
  expect(await db.commerceOrderEvent.count({ where: { orderId: order.id, eventType: "payment.paid" } })).toBe(0);
  expect(await db.paymentTransaction.count({ where: { vendorId: fixed.vendorId } })).toBe(1);
 });
 it("ignores a payment whose source has changed even if all monetary fields match", async () => {
  const { payment } = await checkout();
  await db.paymentTransaction.update({ where: { id: payment.id }, data: { metadata: { billingPurpose: "buyer_order", productId: fixed.productId, wp4SourceCommit: "b".repeat(40), wp4PaymentSubmissionReserved: true } } });
  await expect(readWp4ExistingBuyerState(db)).resolves.toEqual({ status: "FIXTURE_UNAVAILABLE" });
  await expect(retryWp4HistoricalBuyerCallback(db)).resolves.toMatchObject({ status: "FIXTURE_UNAVAILABLE", retryAttempts: 0 });
 });
});

// F-037: documented UPP 2.0 callbacks through the real route and PostgreSQL.
describe("PayUni UPP 2.0 callback outcomes on a pending buyer checkout", () => {
 function stubPayUni() {
  vi.stubEnv("PAYMENT_PROVIDER", "payuni");
  vi.stubEnv("PAYUNI_ENV", "sandbox");
  vi.stubEnv("PAYUNI_SANDBOX_MERCHANT_ID", "SYNTHETIC");
  vi.stubEnv("PAYUNI_SANDBOX_HASH_KEY", "0123456789abcdef0123456789abcdef");
  vi.stubEnv("PAYUNI_SANDBOX_HASH_IV", "0123456789abcdef");
 }
 function callback(source: "notify" | "return", overrides: Record<string, string | number>, orderNumber: string, tradeNo: string, outerStatus?: string | null) {
  const signed = new URLSearchParams(buildPayUniSandboxWebhookFixture({ fixture: "paid", merchantId: "SYNTHETIC", hashKey: "0123456789abcdef0123456789abcdef", hashIv: "0123456789abcdef",
   overrides: { MerTradeNo: orderNumber, TradeNo: tradeNo, TradeAmt: 1, ...overrides } }));
  // The outer Status is unsigned: a payer's browser can alter or drop it.
  if (outerStatus === null) signed.delete("Status");
  else if (outerStatus !== undefined) signed.set("Status", outerStatus);
  const body = signed.toString();
  return paymentCallback(new Request(`http://127.0.0.1:31041/api/webhooks/payments?provider=payuni&source=${source}`, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body }));
 }

 async function notActionableAudit(after: Date) {
  const rows = await db.auditLog.findMany({ where: { action: "payment_webhook_not_actionable", createdAt: { gte: after } }, orderBy: { createdAt: "desc" }, take: 1 });
  return rows[0]?.after as Record<string, unknown> | undefined;
 }

 it.each([
  ["issued number TradeStatus 0", "0"],
  ["awaiting confirmation TradeStatus 8", "8"],
 ])("acknowledges %s without any event, payment change or commission", async (_label, tradeStatus) => {
  const { payment } = await checkout();
  stubPayUni();
  const response = await callback("notify", { TradeStatus: tradeStatus }, payment.orderNumber!, payment.providerTradeNo!);
  expect(response.status).toBe(200);
  expect(await db.webhookEvent.count({ where: { provider: "payuni", eventId: { startsWith: `${payment.providerTradeNo}:` } } })).toBe(0);
  expect(await db.paymentTransaction.findUniqueOrThrow({ where: { id: payment.id } })).toMatchObject({ status: "pending" });
  expect(await db.affiliateCommission.count({ where: { vendorId: fixed.vendorId } })).toBe(0);
  expect(await notActionableAudit(payment.createdAt)).toMatchObject({ reason: "trade_pending", orderNumber: payment.orderNumber,
   providerTradeNo: payment.providerTradeNo, tradeStatus, paymentType: "1", manualReconciliation: false });
 });

 it.each([
  ["paid ATM PaymentType 2", { PaymentType: "2" }, "payment_type_not_allowed"],
  ["paid CVS PaymentType 3", { PaymentType: "3" }, "payment_type_not_allowed"],
  ["paid trade with provider status UNKNOWN", { Status: "UNKNOWN" }, "provider_status_not_success"],
 ])("records %s for manual reconciliation and holds the payment from expiry (R448-01)", async (_label, overrides: Record<string, string>, reason) => {
  const { payment } = await checkout();
  stubPayUni();
  const response = await callback("notify", overrides, payment.orderNumber!, payment.providerTradeNo!);
  expect(response.status).toBe(200);
  // Return of the same callback converges on the same reconciliation event.
  expect((await callback("return", overrides, payment.orderNumber!, payment.providerTradeNo!)).headers.get("location"))
   .toBe("http://127.0.0.1:31041/checkout/result?payment=review");
  const events = await db.webhookEvent.findMany({ where: { provider: "payuni", eventId: `manual:${payment.providerTradeNo}:1:${overrides.PaymentType ?? "1"}` } });
  // The real payment key stays free for a later verified paid callback (RR-01).
  expect(await db.webhookEvent.count({ where: { provider: "payuni", eventId: `${payment.providerTradeNo}:1` } })).toBe(0);
  expect(events).toHaveLength(1);
  expect(events[0]).toMatchObject({ status: "needs_manual_reconciliation", eventType: "manual_reconciliation", vendorId: fixed.vendorId });
  expect(events[0]!.payload).toMatchObject({ reconciliation: { reason, orderNumber: payment.orderNumber, tradeStatus: "1", matchedTransaction: payment.id } });
  const held = await db.paymentTransaction.findUniqueOrThrow({ where: { id: payment.id } });
  expect(held).toMatchObject({ status: "pending", metadata: { paymentManualReconciliation: { reason, webhookEventId: events[0]!.id } } });
  expect(await db.affiliateCommission.count({ where: { vendorId: fixed.vendorId } })).toBe(0);
  expect(await notActionableAudit(payment.createdAt)).toMatchObject({ reason, orderNumber: payment.orderNumber,
   providerTradeNo: payment.providerTradeNo, tradeStatus: "1", manualReconciliation: true });
  // Neither the expiry job nor the retry job releases or replays the held collection.
  const expiry = await releaseExpiredInventoryReservations(100, new Date(Date.now() + 1000 * 60 * 60 * 24));
  expect(expiry.held).toBeGreaterThanOrEqual(1);
  expect(await db.paymentTransaction.findUniqueOrThrow({ where: { id: payment.id } })).toMatchObject({ status: "pending" });
  expect(await db.inventoryReservation.count({ where: { paymentTransactionId: payment.id, status: "reserved" } })).toBe(1);
  await expect(retryWebhookEvent(events[0]!.id)).resolves.toMatchObject({ status: "claimed_elsewhere" });
 });

 it("holds a stored legacy PayUni paid decision for manual reconciliation instead of replaying it (R448-02)", async () => {
  const { payment, payload } = await checkout();
  const event = await db.webhookEvent.create({ data: { provider: "payuni", eventId: "synthetic-buyer-legacy-trade", eventType: "paid", status: "failed",
   retryCount: 1, maxRetries: 5, payload: { normalized: JSON.parse(JSON.stringify({ ...payload, eventId: "synthetic-buyer-legacy-trade" })) } } });
  await expect(retryWebhookEvent(event.id)).resolves.toMatchObject({ status: "needs_manual_reconciliation" });
  expect(await db.webhookEvent.findUniqueOrThrow({ where: { id: event.id } })).toMatchObject({ status: "needs_manual_reconciliation", nextRetryAt: null, retryCount: 1 });
  expect(await db.paymentTransaction.findUniqueOrThrow({ where: { id: payment.id } })).toMatchObject({ status: "pending" });
  const order = await db.commerceOrder.findFirstOrThrow({ where: { primaryPaymentTransactionId: payment.id } });
  expect(await db.commerceOrderEvent.count({ where: { orderId: order.id, eventType: "payment.paid" } })).toBe(0);
 });

 it("records a failed attempt and a later paid result of one trade as two events and pays once", async () => {
  const { payment } = await checkout();
  stubPayUni();
  expect((await callback("notify", { TradeStatus: "2" }, payment.orderNumber!, payment.providerTradeNo!)).status).toBe(200);
  expect(await db.paymentTransaction.findUniqueOrThrow({ where: { id: payment.id } })).toMatchObject({ status: "failed" });
  expect((await callback("notify", {}, payment.orderNumber!, payment.providerTradeNo!)).status).toBe(200);
  // ReturnURL repeats the same signed paid result: one event, no second payment.
  expect((await callback("return", {}, payment.orderNumber!, payment.providerTradeNo!)).status).toBe(303);
  const events = await db.webhookEvent.findMany({ where: { provider: "payuni", eventId: { startsWith: `${payment.providerTradeNo}:` } }, orderBy: { eventId: "asc" } });
  expect(events.map(event => [event.eventId, event.eventType, event.status])).toEqual([
   [`${payment.providerTradeNo}:1`, "paid", "processed"],
   [`${payment.providerTradeNo}:2`, "failed", "processed"],
  ]);
  const paid = await db.paymentTransaction.findUniqueOrThrow({ where: { id: payment.id } });
  // No provider net amount: the server applies the D-30 contract rate (F-040). On NT$1 the
  // taxed fee is NT$0.0294, which rounds to NT$0 at whole-dollar precision.
  expect(paid).toMatchObject({ status: "paid", grossAmountCents: 100, gatewayFeeCents: 0, netAmountCents: 100 });
  expect(paid.metadata).toMatchObject({ feeSource: "contract_rate", gatewayFeePolicy: { feeBps: 280, taxBps: 500, roundingUnitCents: 100 } });
  const order = await db.commerceOrder.findFirstOrThrow({ where: { primaryPaymentTransactionId: payment.id } });
  expect(await db.commerceOrderEvent.count({ where: { orderId: order.id, eventType: "payment.paid" } })).toBe(1);
 });

 // 待 Sandbox 確認: synthetic legacy refund notice shape on the paid TradeNo.
 function refundNotice(orderNumber: string, tradeNo: string, overrides: Record<string, string | number>) {
  return paymentCallback(new Request("http://127.0.0.1:31041/api/webhooks/payments?provider=payuni&source=notify", {
   method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" },
   body: buildPayUniSandboxWebhookFixture({ fixture: "refunded", merchantId: "SYNTHETIC", hashKey: "0123456789abcdef0123456789abcdef", hashIv: "0123456789abcdef",
    overrides: { MerTradeNo: orderNumber, TradeNo: tradeNo, TradeAmt: 1, RefundAmount: 1, GatewayFeeRefund: 0, EventId: "", CloseNo: "", ...overrides } }) }));
 }

 it("holds same-amount refund notices without a provider serial for manual reconciliation and books nothing (PR #454 A-1/A-2)", async () => {
  const { payment } = await checkout();
  stubPayUni();
  const tradeNo = payment.providerTradeNo!;
  expect((await callback("notify", {}, payment.orderNumber!, tradeNo)).status).toBe(200);
  for (let attempt = 0; attempt < 2; attempt += 1) {
   const response = await refundNotice(payment.orderNumber!, tradeNo, {});
   expect(response.status).toBe(200);
   await expect(response.json()).resolves.toMatchObject({ actionable: false, code: "manual_reconciliation" });
  }
  const manual = await db.webhookEvent.findMany({ where: { provider: "payuni", eventId: { startsWith: `manual:${tradeNo}:` } } });
  expect(manual.map(event => [event.eventId, event.status, event.vendorId])).toEqual([[`manual:${tradeNo}:legacy_refund:none`, "needs_manual_reconciliation", fixed.vendorId]]);
  expect(await db.refundRecord.count({ where: { paymentTransactionId: payment.id } })).toBe(0);
  expect(await db.paymentTransaction.findUniqueOrThrow({ where: { id: payment.id } })).toMatchObject({ status: "paid", refundedAmountCents: 0 });
 });

 it("books a refund notice with a provider serial once and treats its resend as a duplicate (F-067, PR #454 A-1)", async () => {
  const { payment } = await checkout();
  stubPayUni();
  const tradeNo = payment.providerTradeNo!;
  expect((await callback("notify", {}, payment.orderNumber!, tradeNo)).status).toBe(200);
  const first = await refundNotice(payment.orderNumber!, tradeNo, { CloseNo: "synthetic-buyer-close-1" });
  expect(first.status).toBe(200);
  await expect(first.json()).resolves.not.toHaveProperty("duplicate");
  await expect((await refundNotice(payment.orderNumber!, tradeNo, { CloseNo: "synthetic-buyer-close-1" })).json()).resolves.toMatchObject({ duplicate: true });
  const events = await db.webhookEvent.findMany({ where: { provider: "payuni", eventId: { in: [`${tradeNo}:1`, "synthetic-buyer-close-1"] } }, orderBy: { eventId: "asc" } });
  expect(events.map(event => [event.eventId, event.eventType, event.status])).toEqual([
   ["synthetic-buyer-close-1", "refunded", "processed"],
   [`${tradeNo}:1`, "paid", "processed"],
  ]);
  expect(await db.paymentTransaction.findUniqueOrThrow({ where: { id: payment.id } })).toMatchObject({ status: "refunded", refundedAmountCents: 100 });
  expect(await db.refundRecord.findMany({ where: { paymentTransactionId: payment.id }, select: { providerEventId: true, status: true } }))
   .toEqual([{ providerEventId: "synthetic-buyer-close-1", status: "processed" }]);
 });

 it("pays once when a verified Notify follows a tampered Return and an unconfirmed Notify (RR-01)", async () => {
  const { payment } = await checkout();
  stubPayUni();
  const tradeNo = payment.providerTradeNo!;
  // 1) Return with an altered unsigned outer Status records nothing.
  expect((await callback("return", {}, payment.orderNumber!, tradeNo, "UNKNOWN")).headers.get("location"))
   .toBe("http://127.0.0.1:31041/checkout/result?payment=pending");
  expect(await db.webhookEvent.count({ where: { provider: "payuni", eventId: { contains: tradeNo } } })).toBe(0);
  // 2) An unconfirmed signed result goes to manual reconciliation and holds the payment.
  expect((await callback("notify", { Status: "UNKNOWN" }, payment.orderNumber!, tradeNo)).status).toBe(200);
  const manual = await db.webhookEvent.findUniqueOrThrow({ where: { provider_eventId: { provider: "payuni", eventId: `manual:${tradeNo}:1:1` } } });
  expect(manual.status).toBe("needs_manual_reconciliation");
  // 3) The verified paid Notify is processed normally and resolves the hold.
  const paidResponse = await callback("notify", {}, payment.orderNumber!, tradeNo);
  expect(paidResponse.status).toBe(200);
  expect(await db.webhookEvent.findUniqueOrThrow({ where: { provider_eventId: { provider: "payuni", eventId: `${tradeNo}:1` } } }))
   .toMatchObject({ status: "processed", eventType: "paid" });
  expect(await db.webhookEvent.findUniqueOrThrow({ where: { id: manual.id } })).toMatchObject({ status: "manual_reconciliation_resolved" });
  const paid = await db.paymentTransaction.findUniqueOrThrow({ where: { id: payment.id } });
  expect(paid.status).toBe("paid");
  expect(paid.metadata).not.toHaveProperty("paymentManualReconciliation");
  const order = await db.commerceOrder.findFirstOrThrow({ where: { primaryPaymentTransactionId: payment.id } });
  expect(await db.commerceOrderEvent.count({ where: { orderId: order.id, eventType: "payment.paid" } })).toBe(1);
 });

 it("treats an unconfirmed callback after a verified payment as already processed, without a reconciliation record (RR-02)", async () => {
  const { payment } = await checkout();
  stubPayUni();
  const tradeNo = payment.providerTradeNo!;
  expect((await callback("notify", {}, payment.orderNumber!, tradeNo)).status).toBe(200);
  const late = await callback("notify", {}, payment.orderNumber!, tradeNo, null);
  expect(late.status).toBe(200);
  await expect(late.json()).resolves.toEqual({ ok: true, actionable: false, code: "already_processed" });
  expect((await callback("notify", { Status: "UNKNOWN" }, payment.orderNumber!, tradeNo)).status).toBe(200);
  expect(await db.webhookEvent.count({ where: { provider: "payuni", eventId: { startsWith: "manual:" }, vendorId: fixed.vendorId } })).toBe(0);
  expect(await db.webhookEvent.count({ where: { provider: "payuni", eventId: { startsWith: `manual:${tradeNo}:` } } })).toBe(0);
  expect(await db.paymentTransaction.findUniqueOrThrow({ where: { id: payment.id } })).toMatchObject({ status: "paid" });
 });
});
