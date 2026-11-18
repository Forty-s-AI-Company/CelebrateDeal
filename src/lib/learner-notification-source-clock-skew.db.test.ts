import { randomBytes, randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { getDb } from "./db";
import { protectCommerceOrderPii } from "./commerce-order-pii";
import { grantCommerceEntitlement } from "./commerce-order-fulfillment";
import { protectLearnerNotificationDestination } from "./learner-notification-contract";
import { materializeLearnerNotificationSourceEvent, recordLearnerNotificationSourceEvent } from "./learner-notification-source-events";

// A learner's consent is stamped by one web instance and the event that fans
// out to them by another. The fan-out must keep "consented after the event
// happened" out, but a consent only a clock-skew behind must still count.
const vendorIds: string[] = [];
type Tenant = { vendorId: string; productId: string };
let tenantA: Tenant, tenantB: Tenant;

async function createTenant(label: string): Promise<Tenant> {
  const db = getDb(), suffix = randomUUID();
  const vendor = await db.vendor.create({ data: { name: `Synthetic ${label}`, slug: `source-skew-${label}-${suffix}`, email: `source-skew-${label}-${suffix}@invalid.example`, passwordHash: "synthetic-login-disabled" }, select: { id: true } });
  vendorIds.push(vendor.id);
  const course = await db.product.create({ data: { vendorId: vendor.id, name: "合成課程", slug: `source-skew-course-${suffix}`, priceCents: 1000, commerceDomain: "course", fulfillmentType: "course" }, select: { id: true } });
  return { vendorId: vendor.id, productId: course.id };
}

async function learner(tenant: Tenant, consentedAt: Date) {
  const db = getDb(), customerKeyHash = randomBytes(32).toString("base64url"), orderId = randomUUID();
  const pii = protectCommerceOrderPii({ buyer: { name: "Synthetic learner", email: `${orderId}@invalid.example` }, shipping: null }, { vendorId: tenant.vendorId, orderId });
  await db.commerceOrder.create({ data: { id: orderId, vendorId: tenant.vendorId, automationCustomerKeyHash: customerKeyHash, orderNumber: orderId, checkoutIdempotencyKey: randomUUID(), checkoutIdentityHash: pii.checkoutIdentityHash,
    status: "paid", subtotalAmountCents: 1000, totalAmountCents: 1000, paidAmountCents: 1000,
    buyerEncryptedEnvelope: pii.buyerEncrypted, buyerMaskedName: pii.buyerNameMasked, buyerMaskedEmail: pii.buyerEmailMasked } });
  const item = await db.commerceOrderItem.create({ data: { vendorId: tenant.vendorId, orderId, productId: tenant.productId, lineIndex: 0, productName: "合成課程", productSlug: randomUUID(), commerceDomain: "course", fulfillmentType: "course", unitPriceCents: 1000, quantity: 1, lineTotalCents: 1000, nonSensitiveSnapshot: {} } });
  const entitlement = await db.commerceEntitlement.create({ data: { vendorId: tenant.vendorId, orderItemId: item.id } });
  await db.$transaction(tx => grantCommerceEntitlement(tx, { vendorId: tenant.vendorId, entitlementId: entitlement.id, expectedRevision: entitlement.revision, actor: { id: "synthetic-source-skew-fixture" } }));
  const scope = { vendorId: tenant.vendorId, productId: tenant.productId, customerKeyHash };
  const destination = protectLearnerNotificationDestination(scope, "email", { email: "learner@invalid.example" });
  await db.learnerNotificationPreference.create({ data: { ...scope, channel: "email", enabled: true, revision: 2, consentedAt,
    destinationEncryptedEnvelope: destination.encryptedEnvelope, destinationKeyHash: destination.destinationKeyHash, destinationVerifiedAt: new Date(consentedAt.getTime() - 60_000) } });
  return customerKeyHash;
}

async function fanOut(tenant: Tenant, occurredAt: Date) {
  const db = getDb(), eventIdentity = `published_${randomUUID()}`;
  await db.$transaction(tx => recordLearnerNotificationSourceEvent(tx, { vendorId: tenant.vendorId, productId: tenant.productId, event: "lesson_published", eventIdentity, audienceCustomerKeyHash: null, occurredAt,
    message: { title: "Lesson", body: "Synthetic lesson", path: `/portal/notify.link/${tenant.vendorId}/notifications` } }));
  const source = await db.learnerNotificationSourceEvent.findUniqueOrThrow({ where: { vendorId_productId_event_eventIdentity: { vendorId: tenant.vendorId, productId: tenant.productId, event: "lesson_published", eventIdentity } } });
  const result = await materializeLearnerNotificationSourceEvent(db, tenant.vendorId, source.id);
  const deliveries = await db.learnerNotificationDelivery.findMany({ where: { event: "lesson_published", eventIdentity }, select: { vendorId: true, preference: { select: { customerKeyHash: true } } } });
  return { result, deliveries: deliveries.map(delivery => ({ vendorId: delivery.vendorId, customerKeyHash: delivery.preference.customerKeyHash })) };
}

beforeAll(async () => {
  vi.stubEnv("CSRF_SECRET", "synthetic-source-clock-skew-db-secret-over-32-bytes");
  tenantA = await createTenant("a");
  tenantB = await createTenant("b");
});
afterAll(async () => {
  // Disposable loopback test DB only; a restrictive FK leaves synthetic rows behind rather than failing the suite.
  try { await getDb().vendor.deleteMany({ where: { id: { in: vendorIds } } }); } catch { /* retained synthetic fixture */ }
  vi.unstubAllEnvs();
});

describe("learner notification fan-out consent cutoff under clock skew", () => {
  it("delivers to a consent 30 s after the event, skips one 90 s after, and keeps other tenants out", async () => {
    const occurredAt = new Date(Date.now() - 10 * 60_000);
    const before = await learner(tenantA, new Date(occurredAt.getTime() - 5 * 60_000));
    const withinSkew = await learner(tenantA, new Date(occurredAt.getTime() + 30_000));
    const afterSkew = await learner(tenantA, new Date(occurredAt.getTime() + 90_000));
    const foreign = await learner(tenantB, new Date(occurredAt.getTime() - 5 * 60_000));
    const { result, deliveries } = await fanOut(tenantA, occurredAt);
    expect(result).toEqual({ status: "completed", queued: 2 });
    expect(deliveries.every(delivery => delivery.vendorId === tenantA.vendorId)).toBe(true);
    expect(deliveries.map(delivery => delivery.customerKeyHash).sort()).toEqual([before, withinSkew].sort());
    expect(deliveries.map(delivery => delivery.customerKeyHash)).not.toContain(afterSkew);
    expect(deliveries.map(delivery => delivery.customerKeyHash)).not.toContain(foreign);
  });

  it("a source from another tenant's event never reaches this tenant's consenting learners", async () => {
    const occurredAt = new Date(Date.now() - 10 * 60_000);
    const own = await learner(tenantA, new Date(occurredAt.getTime() + 30_000));
    const { result, deliveries } = await fanOut(tenantB, occurredAt);
    expect(result.status).toBe("completed");
    expect(deliveries.every(delivery => delivery.vendorId === tenantB.vendorId)).toBe(true);
    expect(deliveries.map(delivery => delivery.customerKeyHash)).not.toContain(own);
  });
});
