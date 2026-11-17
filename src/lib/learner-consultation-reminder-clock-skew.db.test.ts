import { randomBytes, randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { getDb } from "./db";
import { protectCommerceOrderPii } from "./commerce-order-pii";
import { grantCommerceEntitlement } from "./commerce-order-fulfillment";
import { protectLearnerNotificationDestination } from "./learner-notification-contract";
import { confirmLearnerConsultationReminder } from "./learner-consultation-reminders";
import { materializeLearnerNotificationSourceEvent } from "./learner-notification-source-events";
import { claimLearnerNotification } from "./learner-notification-outbox";
import { dispatchClaimedLearnerNotification } from "./learner-notification-dispatch";

// Web instances and the notification job read different wall clocks. A
// dispatcher a little behind the confirming instance, or a consent stamped by
// an instance a little ahead, must not drop a consultation reminder for good.
const vendorIds: string[] = [];
let vendor: { id: string };
let course: { id: string };
let eventId: string;

async function learner(consentedAt: Date) {
  const db = getDb(), customerKeyHash = randomBytes(32).toString("base64url"), orderId = randomUUID();
  const pii = protectCommerceOrderPii({ buyer: { name: "Synthetic learner", email: `${orderId}@invalid.example` }, shipping: null }, { vendorId: vendor.id, orderId });
  await db.commerceOrder.create({ data: { id: orderId, vendorId: vendor.id, automationCustomerKeyHash: customerKeyHash, orderNumber: orderId, checkoutIdempotencyKey: randomUUID(), checkoutIdentityHash: pii.checkoutIdentityHash,
    status: "paid", subtotalAmountCents: 1000, totalAmountCents: 1000, paidAmountCents: 1000,
    buyerEncryptedEnvelope: pii.buyerEncrypted, buyerMaskedName: pii.buyerNameMasked, buyerMaskedEmail: pii.buyerEmailMasked } });
  const item = await db.commerceOrderItem.create({ data: { vendorId: vendor.id, orderId, productId: course.id, lineIndex: 0, productName: "合成課程", productSlug: randomUUID(), commerceDomain: "course", fulfillmentType: "course", unitPriceCents: 1000, quantity: 1, lineTotalCents: 1000, nonSensitiveSnapshot: {} } });
  const entitlement = await db.commerceEntitlement.create({ data: { vendorId: vendor.id, orderItemId: item.id } });
  await db.$transaction(tx => grantCommerceEntitlement(tx, { vendorId: vendor.id, entitlementId: entitlement.id, expectedRevision: entitlement.revision, actor: { id: "synthetic-clock-skew-fixture" } }));
  const scope = { vendorId: vendor.id, productId: course.id, customerKeyHash };
  const destination = protectLearnerNotificationDestination(scope, "email", { email: `${orderId}@invalid.example` });
  await db.learnerNotificationPreference.create({ data: { ...scope, channel: "email", enabled: true, revision: 2, consentedAt,
    destinationEncryptedEnvelope: destination.encryptedEnvelope, destinationKeyHash: destination.destinationKeyHash, destinationVerifiedAt: new Date(consentedAt.getTime() - 60_000) } });
  // Starts within the hour, so the reminder is due right after confirmation.
  const startTime = new Date(Date.now() + 30 * 60_000);
  const booking = await db.consultationBooking.create({ data: { vendorId: vendor.id, customerKeyHash, eventId, startTime, endTime: new Date(startTime.getTime() + 30 * 60_000),
    clientName: "Synthetic learner", clientEmail: `${orderId}@invalid.example`, clientPhone: "+886900000000" } });
  return { session: { vendorId: vendor.id, customerKeyHash }, booking };
}

function setClock(at: Date) { vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(at); }

async function materializeClaimAndDispatch(materializeAt: Date, dispatchAt: Date) {
  const db = getDb();
  setClock(materializeAt);
  const source = await db.learnerNotificationSourceEvent.findFirstOrThrow({ where: { vendorId: vendor.id, productId: course.id, event: "consultation_reminder", completedAt: null } });
  expect(await materializeLearnerNotificationSourceEvent(db, vendor.id, source.id)).toEqual({ status: "completed", queued: 1 });
  const delivery = await db.learnerNotificationDelivery.findFirstOrThrow({ where: { vendorId: vendor.id, event: "consultation_reminder", eventIdentity: source.eventIdentity } });
  // The delivery's nextAttemptAt default is stamped outside the JS clock (the
  // Prisma engine / database), so its due gate does not protect a dispatcher
  // whose wall clock is behind. Claim on the real clock; only the pre-send
  // check runs on the skewed one.
  vi.useRealTimers();
  const claim = await claimLearnerNotification(db, vendor.id, delivery.id);
  expect(claim).not.toBeNull();
  setClock(dispatchAt);
  const sender = vi.fn(async () => ({ outcome: "sent" as const }));
  const result = await dispatchClaimedLearnerNotification(db, { vendorId: vendor.id, id: delivery.id, claimToken: claim!.claimToken }, { appOrigin: "https://app.example.test", configuration: {}, sender });
  vi.useRealTimers();
  return { result, sender, row: await db.learnerNotificationDelivery.findUniqueOrThrow({ where: { id: delivery.id }, select: { status: true, lastErrorCode: true } }) };
}

beforeAll(async () => {
  const db = getDb(), suffix = randomUUID();
  vendor = await db.vendor.create({ data: { name: "Synthetic clock skew owner", slug: `clock-skew-${suffix}`, email: `clock-skew-${suffix}@invalid.example`, passwordHash: "synthetic-login-disabled" }, select: { id: true } });
  vendorIds.push(vendor.id);
  course = await db.product.create({ data: { vendorId: vendor.id, name: "合成課程", slug: `clock-skew-course-${suffix}`, priceCents: 1000, commerceDomain: "course", fulfillmentType: "course" }, select: { id: true } });
  const project = await db.salesProject.create({ data: { vendorId: vendor.id, name: "合成諮詢", slug: `clock-skew-project-${suffix}`, mode: "consulting", primaryFlow: "consultation", status: "published", publishedAt: new Date() } });
  await db.salesProjectProduct.create({ data: { vendorId: vendor.id, projectId: project.id, productId: course.id } });
  eventId = (await db.consultationEvent.create({ data: { vendorId: vendor.id, projectId: project.id, title: "合成諮詢時段", weeklySchedule: {}, intakeFormFields: [] } })).id;
});
afterEach(() => { vi.useRealTimers(); });
afterAll(async () => {
  // Disposable loopback test DB only; a restrictive FK leaves synthetic rows behind rather than failing the suite.
  try { await getDb().vendor.deleteMany({ where: { id: { in: vendorIds } } }); } catch { /* retained synthetic fixture */ }
});

describe("consultation reminder across skewed server clocks", () => {
  it("a dispatcher clock 2 seconds behind the confirming instance still sends the reminder", async () => {
    const confirmAt = new Date();
    const { session, booking } = await learner(new Date(confirmAt.getTime() - 10 * 60_000));
    setClock(confirmAt);
    expect(await confirmLearnerConsultationReminder(getDb(), session, course.id, { bookingId: booking.id, expectedStartTime: booking.startTime.toISOString() }))
      .toEqual({ status: "scheduled", availableAt: confirmAt.toISOString() });
    const { result, sender, row } = await materializeClaimAndDispatch(confirmAt, new Date(confirmAt.getTime() - 2_000));
    expect(result).toEqual({ status: "sent", providerAttempted: true });
    expect(sender).toHaveBeenCalledTimes(1);
    expect(row).toEqual({ status: "sent", lastErrorCode: null });
  });

  it("a consent stamped 30 seconds ahead confirms, fans out to that learner and is delivered", async () => {
    const confirmAt = new Date(), consentedAt = new Date(confirmAt.getTime() + 30_000);
    const { session, booking } = await learner(consentedAt);
    setClock(confirmAt);
    expect(await confirmLearnerConsultationReminder(getDb(), session, course.id, { bookingId: booking.id, expectedStartTime: booking.startTime.toISOString() }))
      .toEqual({ status: "scheduled", availableAt: consentedAt.toISOString() });
    const source = await getDb().learnerNotificationSourceEvent.findFirstOrThrow({ where: { vendorId: vendor.id, audienceCustomerKeyHash: session.customerKeyHash } });
    expect(source.occurredAt).toEqual(consentedAt);
    const { result, row } = await materializeClaimAndDispatch(consentedAt, new Date(consentedAt.getTime() - 2_000));
    expect(result).toEqual({ status: "sent", providerAttempted: true });
    expect(row.status).toBe("sent");
  });

  it("a consent stamped more than 60 seconds ahead is not treated as skew", async () => {
    const confirmAt = new Date();
    const { session, booking } = await learner(new Date(confirmAt.getTime() + 61_000));
    setClock(confirmAt);
    expect(await confirmLearnerConsultationReminder(getDb(), session, course.id, { bookingId: booking.id, expectedStartTime: booking.startTime.toISOString() }))
      .toEqual({ status: "verification_required" });
    expect(await getDb().learnerNotificationSourceEvent.count({ where: { vendorId: vendor.id, audienceCustomerKeyHash: session.customerKeyHash } })).toBe(0);
  });
});
