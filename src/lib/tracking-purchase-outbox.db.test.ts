import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { getDb } from "@/lib/db";
import { protectTrackingBrowserContext } from "@/lib/tracking-browser-context";
import { protectCommerceOrderPii } from "@/lib/commerce-order-pii";
import { saveTrackingCredentialConfiguration } from "@/lib/tracking-settings";
import { enqueuePaidPurchaseTracking } from "@/lib/tracking-purchase-outbox";
import { runPurchaseTrackingBatch } from "@/lib/tracking-purchase-worker";
import { PaymentWebhookPayload, processPaymentWebhook } from "@/lib/payment-webhooks";

const db = getDb();
// 每個 suite 自行宣告合成 Preview binding，完整 coverage 不依賴專用 runner。
beforeEach(() => {
  vi.stubEnv("CSRF_SECRET", "synthetic-tracking-encryption-key-at-least-32-bytes");
  vi.stubEnv("VERCEL_ENV", "preview");
  vi.stubEnv("META_TRACKING_TEST_DELIVERY_ENABLED", "true");
  vi.stubEnv("META_TRACKING_LIVE_DELIVERY_ENABLED", "false");
});
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });
async function fixture() {
  const id = randomUUID();
  const vendor = await db.vendor.create({ data: { name: "Synthetic tracking shop", slug: `outbox-${id}`, email: `${id}@example.test`, passwordHash: "synthetic-only" } });
  await saveTrackingCredentialConfiguration(vendor.id, { expectedRevision: 0, token: "synthetic-meta-outbox-token", testEventCode: "TEST_SYNTHETIC", clearToken: false });
  await db.trackingSetting.update({ where: { vendorId: vendor.id }, data: { facebookPixelId: "123456789" } });
  const payment = await db.paymentTransaction.create({ data: { vendorId: vendor.id, providerName: "demo", status: "paid", grossAmountCents: 12345, currency: "TWD" } });
  const orderId = randomUUID();
  const pii = protectCommerceOrderPii({ buyer: { name: "Synthetic buyer", email: "synthetic-tracking-buyer@example.test" }, shipping: null }, { vendorId: vendor.id, orderId });
  const order = await db.commerceOrder.create({ data: {
    id: orderId, vendorId: vendor.id, orderNumber: orderId, checkoutIdempotencyKey: randomUUID(), checkoutIdentityHash: pii.checkoutIdentityHash,
    primaryPaymentTransactionId: payment.id, status: "paid", isTestOrder: true, paidAt: new Date(),
    subtotalAmountCents: 12345, totalAmountCents: 12345, paidAmountCents: 12345,
    trackingContextEncrypted: protectTrackingBrowserContext(vendor.id, orderId, { sourceUrl: "https://tracking.example.test/checkout/synthetic/product", userAgent: "SyntheticTrackingBrowser/1.0" }),
    buyerEncryptedEnvelope: pii.buyerEncrypted, buyerMaskedName: pii.buyerNameMasked, buyerMaskedEmail: pii.buyerEmailMasked,
  } });
  const input = { vendorId: vendor.id, paymentTransactionId: payment.id };
  return { vendor, payment, order, input };
}
const enqueue = (input: { vendorId: string; paymentTransactionId: string }) => db.$transaction(tx => enqueuePaidPurchaseTracking(tx, input));
const run = (vendorId: string, now?: Date) => runPurchaseTrackingBatch({ vendorId, apiVersion: "v22.0", now });
const accepted = () => new Response('{"events_received":1}', { status: 200 });

it("deduplicates concurrent callbacks by the server-owned transaction identity", async () => {
  const f = await fixture();
  await Promise.all([enqueue(f.input), enqueue(f.input)]);
  expect(await db.trackingDelivery.count({ where: { vendorId: f.vendor.id } })).toBe(1);
  expect(await db.trackingDelivery.findFirstOrThrow({ where: { vendorId: f.vendor.id } })).toMatchObject({ eventId: `purchase:${f.payment.id}`, orderId: f.order.id, credentialRevision: 1, attemptCount: 0 });
});
it("rolls the queue row back with its owning payment transaction", async () => {
  const f = await fixture();
  await expect(db.$transaction(async tx => { await enqueuePaidPurchaseTracking(tx, f.input); throw new Error("synthetic rollback"); })).rejects.toThrow("synthetic rollback");
  expect(await db.trackingDelivery.count({ where: { vendorId: f.vendor.id } })).toBe(0);
});
it("cannot select or foreign-key another tenant's order", async () => {
  const a = await fixture(), b = await fixture();
  expect(await enqueue({ vendorId: b.vendor.id, paymentTransactionId: a.payment.id })).toBeNull();
  await expect(db.trackingDelivery.create({ data: { vendorId: b.vendor.id, orderId: a.order.id, eventId: "foreign", credentialRevision: 1, pixelId: "123456789" } })).rejects.toMatchObject({ code: "P2003" });
  expect(await db.trackingDelivery.count({ where: { vendorId: b.vendor.id } })).toBe(0);
});
it("rejects unpaid, refunded and disabled sources without creating an event", async () => {
  const f = await fixture();
  await db.paymentTransaction.update({ where: { id: f.payment.id }, data: { status: "pending" } });
  expect(await enqueue(f.input)).toBeNull();
  await db.paymentTransaction.update({ where: { id: f.payment.id }, data: { status: "paid" } });
  await db.commerceOrder.update({ where: { id: f.order.id }, data: { refundedAmountCents: 100 } });
  expect(await enqueue(f.input)).toBeNull();
  await db.commerceOrder.update({ where: { id: f.order.id }, data: { refundedAmountCents: 0 } });
  await db.trackingSetting.update({ where: { vendorId: f.vendor.id }, data: { enablePurchaseEvent: false } });
  expect(await enqueue(f.input)).toBeNull();
  expect(await db.trackingDelivery.count({ where: { vendorId: f.vendor.id } })).toBe(0);
});
it("uses the real database order amount and hashed identity with simulated HTTP acceptance", async () => {
  const f = await fixture(); await enqueue(f.input);
  const fetchMock = vi.fn().mockResolvedValue(accepted()); vi.stubGlobal("fetch", fetchMock);
  expect(await run(f.vendor.id)).toMatchObject({ claimed: 1, accepted: 1 });
  const body = JSON.parse(fetchMock.mock.calls[0][1].body);
  expect(body.data[0]).toMatchObject({ event_name: "Purchase", event_id: `purchase:${f.payment.id}`, custom_data: { currency: "TWD", value: 123.45 } });
  expect(body.data[0].user_data.em[0]).toMatch(/^[a-f0-9]{64}$/);
  expect(JSON.stringify(body)).not.toContain("synthetic-tracking-buyer@example.test");
  expect(body.test_event_code).toBe("TEST_SYNTHETIC");
  expect(await db.trackingDelivery.findFirstOrThrow({ where: { vendorId: f.vendor.id } })).toMatchObject({ status: "accepted", attemptCount: 1, leaseToken: null });
});
it("claims one concurrent worker and never resends an accepted row", async () => {
  const f = await fixture(); await enqueue(f.input);
  const fetchMock = vi.fn().mockImplementation(async () => { await new Promise(resolve => setTimeout(resolve, 40)); return accepted(); });
  vi.stubGlobal("fetch", fetchMock);
  const results = await Promise.all([run(f.vendor.id), run(f.vendor.id)]);
  expect(results.reduce((sum, result) => sum + result.accepted, 0)).toBe(1);
  await run(f.vendor.id);
  expect(fetchMock).toHaveBeenCalledTimes(1);
});
it("persists a scheduled retry and reuses the event identity", async () => {
  const f = await fixture(); await enqueue(f.input);
  const fetchMock = vi.fn().mockRejectedValueOnce(new Error("synthetic timeout")).mockImplementation(async () => accepted()); vi.stubGlobal("fetch", fetchMock);
  expect(await run(f.vendor.id)).toMatchObject({ retried: 1 });
  const row = await db.trackingDelivery.findFirstOrThrow({ where: { vendorId: f.vendor.id } });
  expect(await run(f.vendor.id)).toMatchObject({ claimed: 0 });
  expect(await run(f.vendor.id, new Date(row.nextAttemptAt.getTime() + 1))).toMatchObject({ accepted: 1 });
  expect(fetchMock).toHaveBeenCalledTimes(2);
  expect(fetchMock.mock.calls.map(call => JSON.parse(call[1].body).data[0].event_id)).toEqual([row.eventId, row.eventId]);
});
it("cancels a refunded order before issuing any provider request", async () => {
  const f = await fixture(); await enqueue(f.input);
  await db.commerceOrder.update({ where: { id: f.order.id }, data: { status: "refunded", refundedAmountCents: f.order.totalAmountCents } });
  const fetchMock = vi.fn(); vi.stubGlobal("fetch", fetchMock);
  expect(await run(f.vendor.id)).toMatchObject({ cancelled: 1 });
  expect(fetchMock).not.toHaveBeenCalled();
});
it("cancels stale credentials instead of sending to changed settings", async () => {
  const f = await fixture(); await enqueue(f.input);
  await saveTrackingCredentialConfiguration(f.vendor.id, { expectedRevision: 1, token: "synthetic-new-meta-token", testEventCode: "NEW_TEST", clearToken: false });
  const fetchMock = vi.fn(); vi.stubGlobal("fetch", fetchMock);
  expect(await run(f.vendor.id)).toMatchObject({ cancelled: 1 });
  expect(fetchMock).not.toHaveBeenCalled();
});
it("recovers an expired worker lease using the same provider event ID", async () => {
  const f = await fixture(); const row = await enqueue(f.input);
  await db.trackingDelivery.update({ where: { id: row!.id }, data: { status: "processing", attemptCount: 1, leaseToken: randomUUID(), leaseExpiresAt: new Date(Date.now() - 1000) } });
  const fetchMock = vi.fn().mockImplementation(async () => accepted()); vi.stubGlobal("fetch", fetchMock);
  expect(await run(f.vendor.id)).toMatchObject({ claimed: 1, accepted: 1 });
  expect(JSON.parse(fetchMock.mock.calls[0][1].body).data[0].event_id).toBe(row!.eventId);
  expect(await db.trackingDelivery.findUniqueOrThrow({ where: { id: row!.id } })).toMatchObject({ status: "accepted", attemptCount: 2, leaseToken: null });
});
it("terminates an exhausted expired lease without a ninth network attempt", async () => {
  const f = await fixture(); const row = await enqueue(f.input);
  await db.trackingDelivery.update({ where: { id: row!.id }, data: { status: "processing", attemptCount: 8, leaseToken: randomUUID(), leaseExpiresAt: new Date(Date.now() - 1000) } });
  const fetchMock = vi.fn(); vi.stubGlobal("fetch", fetchMock);
  expect(await run(f.vendor.id)).toMatchObject({ claimed: 0, rejected: 1 });
  expect(await db.trackingDelivery.findUniqueOrThrow({ where: { id: row!.id } })).toMatchObject({ status: "rejected", attemptCount: 8, leaseToken: null });
  expect(fetchMock).not.toHaveBeenCalled();
});
it("does not claim another tenant's queued event", async () => {
  const a = await fixture(), b = await fixture(); const row = await enqueue(b.input);
  const fetchMock = vi.fn(); vi.stubGlobal("fetch", fetchMock);
  expect(await run(a.vendor.id)).toMatchObject({ claimed: 0 });
  expect(await db.trackingDelivery.findUniqueOrThrow({ where: { id: row!.id } })).toMatchObject({ status: "queued", attemptCount: 0 });
  expect(fetchMock).not.toHaveBeenCalled();
});
it("the actual paid webhook commits one durable purchase across distinct callback IDs", async () => {
  const f = await fixture();
  const plan = await db.billingPlan.create({ data: { name: "Synthetic tracking plan", code: `tracking-${randomUUID()}`, monthlyPriceCents: 0 } });
  await db.vendorSubscription.create({ data: { vendorId: f.vendor.id, planId: plan.id, paymentMode: "platform", status: "active" } });
  await db.paymentTransaction.update({ where: { id: f.payment.id }, data: { status: "pending", orderNumber: f.order.orderNumber } });
  await db.commerceOrder.update({ where: { id: f.order.id }, data: { status: "pending_payment", paidAmountCents: 0, paidAt: null } });
  const fetchMock = vi.fn(); vi.stubGlobal("fetch", fetchMock);
  const payload = { provider: "demo", eventType: "paid", vendorId: f.vendor.id, orderNumber: f.order.orderNumber, grossAmountCents: 12345, currency: "TWD" };
  await processPaymentWebhook(PaymentWebhookPayload.parse({ ...payload, eventId: randomUUID() }));
  await processPaymentWebhook(PaymentWebhookPayload.parse({ ...payload, eventId: randomUUID() }));
  expect(await db.commerceOrder.findUniqueOrThrow({ where: { id: f.order.id } })).toMatchObject({ status: "paid", paidAmountCents: 12345 });
  expect(await db.trackingDelivery.count({ where: { vendorId: f.vendor.id } })).toBe(1);
  expect(await db.trackingDelivery.findFirstOrThrow({ where: { vendorId: f.vendor.id } })).toMatchObject({ status: "queued", eventId: `purchase:${f.payment.id}`, attemptCount: 0 });
  expect(fetchMock).not.toHaveBeenCalled();
});

// 實際 disposable DB，provider 僅模擬；不送正式事件。
it("keeps live rows untouched by test batches and requires explicit live enablement", async () => {
  const live = await fixture(), test = await fixture();
  await db.commerceOrder.update({ where: { id: live.order.id }, data: { isTestOrder: false } });
  await saveTrackingCredentialConfiguration(live.vendor.id, { expectedRevision: 1, testEventCode: null, clearToken: false });
  await enqueue(live.input); await enqueue(test.input);
  const fetchMock = vi.fn().mockResolvedValue(accepted()); vi.stubGlobal("fetch", fetchMock);
  vi.stubEnv("VERCEL_ENV", "preview");
  vi.stubEnv("META_TRACKING_TEST_DELIVERY_ENABLED", "true");
  vi.stubEnv("META_TRACKING_LIVE_DELIVERY_ENABLED", "false");
  expect(await run(live.vendor.id)).toMatchObject({ claimed: 0 });
  await expect(runPurchaseTrackingBatch({ vendorId: live.vendor.id, apiVersion: "v22.0", deliveryMode: "live" })).rejects.toThrow(TypeError);
  expect(fetchMock).not.toHaveBeenCalled();
  expect(await db.trackingDelivery.findFirstOrThrow({ where: { vendorId: live.vendor.id } })).toMatchObject({ status: "queued", attemptCount: 0, testEventCode: null });
  vi.stubEnv("VERCEL_ENV", "production");
  vi.stubEnv("META_TRACKING_TEST_DELIVERY_ENABLED", "false");
  vi.stubEnv("META_TRACKING_LIVE_DELIVERY_ENABLED", "true");
  expect(await runPurchaseTrackingBatch({ vendorId: test.vendor.id, apiVersion: "v22.0", deliveryMode: "live" })).toMatchObject({ claimed: 0 });
  expect(await runPurchaseTrackingBatch({ vendorId: live.vendor.id, apiVersion: "v22.0", deliveryMode: "live" })).toMatchObject({ claimed: 1, accepted: 1 });
  expect(JSON.parse(fetchMock.mock.calls[0][1].body)).not.toHaveProperty("test_event_code");
  expect(fetchMock).toHaveBeenCalledTimes(1);
  expect(await db.trackingDelivery.findFirstOrThrow({ where: { vendorId: test.vendor.id } })).toMatchObject({ status: "queued", attemptCount: 0, testEventCode: "TEST_SYNTHETIC" });
});

it("rejects disabled direct test workers before a database claim", async () => {
  const f = await fixture(); await enqueue(f.input);
  const fetchMock = vi.fn(); vi.stubGlobal("fetch", fetchMock);
  for (const [environment, testFlag, liveFlag] of [["", "", ""], ["preview", "false", "false"], ["preview", "true", "true"], ["production", "true", "false"]]) {
    vi.stubEnv("VERCEL_ENV", environment); vi.stubEnv("META_TRACKING_TEST_DELIVERY_ENABLED", testFlag); vi.stubEnv("META_TRACKING_LIVE_DELIVERY_ENABLED", liveFlag);
    await expect(run(f.vendor.id)).rejects.toThrow(TypeError);
    expect(await db.trackingDelivery.findFirstOrThrow({ where: { vendorId: f.vendor.id } })).toMatchObject({ status: "queued", attemptCount: 0 });
  }
  expect(fetchMock).not.toHaveBeenCalled();
});
it("excludes test orders from live enqueue and cancels a queued purchase changed to test", async () => {
  const f = await fixture();
  await saveTrackingCredentialConfiguration(f.vendor.id, { expectedRevision: 1, testEventCode: null, clearToken: false });
  expect(await enqueue(f.input)).toBeNull();
  expect(await db.trackingDelivery.count({ where: { vendorId: f.vendor.id } })).toBe(0);
  await db.commerceOrder.update({ where: { id: f.order.id }, data: { isTestOrder: false } });
  await enqueue(f.input);
  await db.commerceOrder.update({ where: { id: f.order.id }, data: { isTestOrder: true } });
  vi.stubEnv("VERCEL_ENV", "production"); vi.stubEnv("META_TRACKING_TEST_DELIVERY_ENABLED", "false"); vi.stubEnv("META_TRACKING_LIVE_DELIVERY_ENABLED", "true");
  const fetchMock = vi.fn(); vi.stubGlobal("fetch", fetchMock);
  expect(await runPurchaseTrackingBatch({ vendorId: f.vendor.id, apiVersion: "v22.0", deliveryMode: "live" })).toMatchObject({ claimed: 1, cancelled: 1 });
  expect(fetchMock).not.toHaveBeenCalled();
});
