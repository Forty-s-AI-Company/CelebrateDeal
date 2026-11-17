import { randomBytes, randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { getDb } from "./db";
import { protectCommerceOrderPii } from "./commerce-order-pii";
import { grantCommerceEntitlement } from "./commerce-order-fulfillment";
import { protectLearnerNotificationDestination, type LearnerNotificationChannel } from "./learner-notification-contract";
import { confirmLearnerConsultationReminder } from "./learner-consultation-reminders";
import { materializeLearnerNotificationSourceEvent } from "./learner-notification-source-events";
import { claimLearnerNotification } from "./learner-notification-outbox";
import { dispatchClaimedLearnerNotification } from "./learner-notification-dispatch";

// Web instances, the notification job and the database read different wall
// clocks. A dispatcher a little behind the confirming instance, a consent
// stamped by an instance a little ahead, or a database clock a little behind
// the job must not drop a consultation reminder for good.
const vendorIds: string[] = [];
let vendor: { id: string };
let course: { id: string };
let eventId: string;

const destinations: Record<"email" | "sms", unknown> = { email: { email: "learner@invalid.example" }, sms: { phone: "+886900000000" } };

async function learner(consents: Array<{ channel: "email" | "sms"; consentedAt: Date }>, startInMs = 30 * 60_000) {
  const db = getDb(), customerKeyHash = randomBytes(32).toString("base64url"), orderId = randomUUID();
  const pii = protectCommerceOrderPii({ buyer: { name: "Synthetic learner", email: `${orderId}@invalid.example` }, shipping: null }, { vendorId: vendor.id, orderId });
  await db.commerceOrder.create({ data: { id: orderId, vendorId: vendor.id, automationCustomerKeyHash: customerKeyHash, orderNumber: orderId, checkoutIdempotencyKey: randomUUID(), checkoutIdentityHash: pii.checkoutIdentityHash,
    status: "paid", subtotalAmountCents: 1000, totalAmountCents: 1000, paidAmountCents: 1000,
    buyerEncryptedEnvelope: pii.buyerEncrypted, buyerMaskedName: pii.buyerNameMasked, buyerMaskedEmail: pii.buyerEmailMasked } });
  const item = await db.commerceOrderItem.create({ data: { vendorId: vendor.id, orderId, productId: course.id, lineIndex: 0, productName: "合成課程", productSlug: randomUUID(), commerceDomain: "course", fulfillmentType: "course", unitPriceCents: 1000, quantity: 1, lineTotalCents: 1000, nonSensitiveSnapshot: {} } });
  const entitlement = await db.commerceEntitlement.create({ data: { vendorId: vendor.id, orderItemId: item.id } });
  await db.$transaction(tx => grantCommerceEntitlement(tx, { vendorId: vendor.id, entitlementId: entitlement.id, expectedRevision: entitlement.revision, actor: { id: "synthetic-clock-skew-fixture" } }));
  const scope = { vendorId: vendor.id, productId: course.id, customerKeyHash };
  for (const { channel, consentedAt } of consents) {
    const destination = protectLearnerNotificationDestination(scope, channel as LearnerNotificationChannel, destinations[channel]);
    await db.learnerNotificationPreference.create({ data: { ...scope, channel, enabled: true, revision: 2, consentedAt,
      destinationEncryptedEnvelope: destination.encryptedEnvelope, destinationKeyHash: destination.destinationKeyHash, destinationVerifiedAt: new Date(consentedAt.getTime() - 60_000) } });
  }
  const startTime = new Date(Date.now() + startInMs);
  const booking = await db.consultationBooking.create({ data: { vendorId: vendor.id, customerKeyHash, eventId, startTime, endTime: new Date(startTime.getTime() + 30 * 60_000),
    clientName: "Synthetic learner", clientEmail: `${orderId}@invalid.example`, clientPhone: "+886900000000" } });
  return { session: { vendorId: vendor.id, customerKeyHash }, booking };
}

function setClock(at: Date) { vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(at); }

async function confirmAt(at: Date, learnerRow: Awaited<ReturnType<typeof learner>>) {
  setClock(at);
  const result = await confirmLearnerConsultationReminder(getDb(), learnerRow.session, course.id, { bookingId: learnerRow.booking.id, expectedStartTime: learnerRow.booking.startTime.toISOString() });
  vi.useRealTimers();
  return result;
}

async function materializeClaimAndDispatch(customerKeyHash: string, materializeAt: Date, dispatchAt: Date, expectedQueued = 1) {
  const db = getDb();
  setClock(materializeAt);
  const source = await db.learnerNotificationSourceEvent.findFirstOrThrow({ where: { vendorId: vendor.id, productId: course.id, event: "consultation_reminder", audienceCustomerKeyHash: customerKeyHash } });
  expect(await materializeLearnerNotificationSourceEvent(db, vendor.id, source.id)).toEqual({ status: "completed", queued: expectedQueued });
  const deliveries = await db.learnerNotificationDelivery.findMany({ where: { vendorId: vendor.id, event: "consultation_reminder", eventIdentity: source.eventIdentity }, orderBy: { id: "asc" } });
  expect(deliveries).toHaveLength(expectedQueued);
  const outcomes = [];
  for (const delivery of deliveries) {
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
    outcomes.push({ result, sender, row: await db.learnerNotificationDelivery.findUniqueOrThrow({ where: { id: delivery.id }, select: { status: true, lastErrorCode: true } }) });
  }
  return outcomes;
}

beforeAll(async () => {
  vi.stubEnv("CSRF_SECRET", "synthetic-clock-skew-db-test-secret-over-32-bytes");
  const db = getDb(), suffix = randomUUID();
  vendor = await db.vendor.create({ data: { name: "Synthetic clock skew owner", slug: `clock-skew-${suffix}`, email: `clock-skew-${suffix}@invalid.example`, passwordHash: "synthetic-login-disabled" }, select: { id: true } });
  vendorIds.push(vendor.id);
  course = await db.product.create({ data: { vendorId: vendor.id, name: "合成課程", slug: `clock-skew-course-${suffix}`, priceCents: 1000, commerceDomain: "course", fulfillmentType: "course" }, select: { id: true } });
  const project = await db.salesProject.create({ data: { vendorId: vendor.id, name: "合成諮詢", slug: `clock-skew-project-${suffix}`, mode: "consulting", primaryFlow: "consultation", status: "published", publishedAt: new Date() } });
  await db.salesProjectProduct.create({ data: { vendorId: vendor.id, projectId: project.id, productId: course.id } });
  eventId = (await db.consultationEvent.create({ data: { vendorId: vendor.id, projectId: project.id, title: "合成諮詢時段", weeklySchedule: {}, intakeFormFields: [] } })).id;
});
// Encrypted fixtures (destinations, payloads) need the same synthetic key in every test.
beforeEach(() => { vi.stubEnv("CSRF_SECRET", "synthetic-clock-skew-db-test-secret-over-32-bytes"); });
afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); });
afterAll(async () => {
  // Disposable loopback test DB only; a restrictive FK leaves synthetic rows behind rather than failing the suite.
  try { await getDb().vendor.deleteMany({ where: { id: { in: vendorIds } } }); } catch { /* retained synthetic fixture */ }
  vi.unstubAllEnvs();
});

describe("consultation reminder across skewed server clocks", () => {
  it("a dispatcher clock 2 seconds behind the confirming instance still sends the reminder", async () => {
    const now = new Date();
    const row = await learner([{ channel: "email", consentedAt: new Date(now.getTime() - 10 * 60_000) }]);
    expect(await confirmAt(now, row)).toEqual({ status: "scheduled", availableAt: now.toISOString() });
    const [outcome] = await materializeClaimAndDispatch(row.session.customerKeyHash, now, new Date(now.getTime() - 2_000));
    expect(outcome!.result).toEqual({ status: "sent", providerAttempted: true });
    expect(outcome!.sender).toHaveBeenCalledTimes(1);
    expect(outcome!.row).toEqual({ status: "sent", lastErrorCode: null });
  });

  it("a consent stamped 30 seconds ahead confirms, fans out to that learner and is delivered", async () => {
    const now = new Date(), consentedAt = new Date(now.getTime() + 30_000);
    const row = await learner([{ channel: "email", consentedAt }]);
    expect(await confirmAt(now, row)).toEqual({ status: "scheduled", availableAt: consentedAt.toISOString() });
    const source = await getDb().learnerNotificationSourceEvent.findFirstOrThrow({ where: { vendorId: vendor.id, audienceCustomerKeyHash: row.session.customerKeyHash } });
    expect(source.occurredAt).toEqual(consentedAt);
    const [outcome] = await materializeClaimAndDispatch(row.session.customerKeyHash, consentedAt, new Date(consentedAt.getTime() - 2_000));
    expect(outcome!.result).toEqual({ status: "sent", providerAttempted: true });
    expect(outcome!.row.status).toBe("sent");
  });

  it("several channels: the latest skewed consent decides, so every channel is fanned out and delivered", async () => {
    const now = new Date(), latest = new Date(now.getTime() + 40_000);
    const row = await learner([{ channel: "email", consentedAt: new Date(now.getTime() - 10 * 60_000) }, { channel: "sms", consentedAt: latest }]);
    expect(await confirmAt(now, row)).toEqual({ status: "scheduled", availableAt: latest.toISOString() });
    const outcomes = await materializeClaimAndDispatch(row.session.customerKeyHash, latest, latest, 2);
    expect(outcomes.map(outcome => outcome.result)).toEqual([{ status: "sent", providerAttempted: true }, { status: "sent", providerAttempted: true }]);
  });

  it("a consent stamped more than 60 seconds ahead is not treated as skew", async () => {
    const now = new Date();
    const row = await learner([{ channel: "email", consentedAt: new Date(now.getTime() + 61_000) }]);
    expect(await confirmAt(now, row)).toEqual({ status: "verification_required" });
    expect(await getDb().learnerNotificationSourceEvent.count({ where: { vendorId: vendor.id, audienceCustomerKeyHash: row.session.customerKeyHash } })).toBe(0);
  });

  it("a database clock up to 60 seconds behind the job does not suppress a reminder due an hour before start", async () => {
    // The source became due (start - 1 h) on an application clock 30 s ahead of the database.
    const now = new Date();
    const row = await learner([{ channel: "email", consentedAt: new Date(now.getTime() - 10 * 60_000) }], 60 * 60_000 + 30_000);
    const due = new Date(row.booking.startTime.getTime() - 60 * 60_000);
    expect(await confirmAt(now, row)).toEqual({ status: "scheduled", availableAt: due.toISOString() });
    const [outcome] = await materializeClaimAndDispatch(row.session.customerKeyHash, due, due);
    expect(outcome!.result).toEqual({ status: "sent", providerAttempted: true });
  });

  it("a reminder more than 60 seconds earlier than an hour before start is still refused", async () => {
    const now = new Date();
    const row = await learner([{ channel: "email", consentedAt: new Date(now.getTime() - 10 * 60_000) }], 60 * 60_000 + 90_000);
    const due = new Date(row.booking.startTime.getTime() - 60 * 60_000);
    expect(await confirmAt(now, row)).toEqual({ status: "scheduled", availableAt: due.toISOString() });
    const [outcome] = await materializeClaimAndDispatch(row.session.customerKeyHash, due, due);
    expect(outcome!.result).toEqual({ status: "suppressed" });
    expect(outcome!.sender).not.toHaveBeenCalled();
    expect(outcome!.row).toEqual({ status: "suppressed", lastErrorCode: "CONSULTATION_BOOKING_UNAVAILABLE" });
  });
});
