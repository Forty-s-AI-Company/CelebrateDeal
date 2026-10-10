import { afterAll, afterEach, describe, expect, it } from "vitest";
import { randomBytes } from "node:crypto";
import { Prisma, PrismaClient } from "@prisma/client";
import { assertLocalTestDatabase } from "./local-database-safety";
import { readProcessingPreconditions } from "./q1-processing-preconditions";
import { ensureWp4SandboxFixture, WP4_SANDBOX_FIXTURE as fixed } from "../src/lib/wp4-sandbox-fixture";
import { wp4HistoricalBuyerWhere } from "../src/lib/wp4-buyer-recovery";

assertLocalTestDatabase("DATABASE_URL", process.env.DATABASE_URL);
const db = new PrismaClient();
const source = "9acfe8d2dba62430e950cff2c0387841ab91f44b";
const prefix = `q1_preconditions_${randomBytes(8).toString("hex")}`;
afterEach(async () => {
  await db.webhookEvent.deleteMany({ where: { id: { startsWith: prefix } } });
  await db.vendor.deleteMany({ where: { id: fixed.vendorId } });
  await db.user.deleteMany({ where: { id: fixed.userId } });
  await db.billingPlan.deleteMany({ where: { id: fixed.planId } });
});
afterAll(() => db.$disconnect());

async function seed(items: Prisma.InputJsonValue | typeof Prisma.DbNull = [{ productId: fixed.productId, quantity: 1 }],
  eventId = "payuni:fixed", occurredAt?: string) {
  await ensureWp4SandboxFixture(db);
  const payment = await db.paymentTransaction.create({ data: { vendorId: fixed.vendorId, providerName: "payuni",
    orderNumber: `${prefix}_order`, paymentMode: "platform", grossAmountCents: 100, netAmountCents: 100,
    currency: "TWD", status: "pending", checkoutIdempotencyKey: wp4HistoricalBuyerWhere(source).checkoutIdempotencyKey,
    metadata: { billingPurpose: "buyer_order", productId: fixed.productId, wp4SourceCommit: source,
      wp4PaymentSubmissionReserved: true, referralCode: "must-not-leak", affiliateClickId: "must-not-leak" } } });
  const reservation = await db.inventoryReservation.create({ data: { vendorId: fixed.vendorId, productId: fixed.productId,
    paymentTransactionId: payment.id, quantity: 1, status: "reserved", expiresAt: new Date("2026-10-10T00:00:00Z"), items } });
  const event = await db.webhookEvent.create({ data: { id: `${prefix}_event`, provider: "payuni", eventId: `${prefix}_identity`,
    eventType: "paid", status: "failed", retryCount: 3, maxRetries: 5,
    payload: { normalized: { provider: "payuni", eventId, orderNumber: payment.orderNumber,
      ...(occurredAt === undefined ? {} : { occurredAt }), ignored: "must-not-leak" } } } });
  return { payment, reservation, event };
}

describe("processing preconditions against migrated PostgreSQL", () => {
  it.each([
    { items: Prisma.DbNull, expected: "NULL_LEGACY" },
    { items: [{ productId: fixed.productId, quantity: 1 }], expected: "VALID" },
    { items: [], expected: "INVALID" },
    { items: [{ productId: fixed.productId, quantity: 0 }], expected: "INVALID" },
    { items: [{ productId: "other", quantity: 1 }], expected: "INVALID" },
  ])("observes $expected inventory snapshot without mutating original rows", async ({ items, expected }) => {
    const { payment, reservation, event } = await seed(items);
    const result = await readProcessingPreconditions(db);
    expect(result).toMatchObject({ classification: "PROCESSING_PRECONDITIONS_OBSERVED", reservationSnapshotClass: expected,
      occurredAtClass: "ABSENT", scopeSiblingCount: "ONE", fixedPaymentIsSoleScopeRow: true, reservationVendorMatches: true,
      eventIdentityOpaque: true, metadataHints: { referralCode: true, affiliateClickId: true, formSubmissionId: false },
      databaseWrites: false, callbackPosts: 0, callbackReplayAuthorized: false });
    expect(JSON.stringify(result)).not.toMatch(/must-not-leak|q1_preconditions_|payuni:fixed/);
    expect(await db.paymentTransaction.findUniqueOrThrow({ where: { id: payment.id } })).toEqual(payment);
    expect(await db.inventoryReservation.findUniqueOrThrow({ where: { id: reservation.id } })).toEqual(reservation);
    expect(await db.webhookEvent.findUniqueOrThrow({ where: { id: event.id } })).toEqual(event);
  });
  it.each(["x".repeat(192), "control\u0001", "valid:colon"])("uses original opaque identifier rules for %j", async eventId => {
    await seed(undefined, eventId);
    expect(await readProcessingPreconditions(db)).toMatchObject({ eventIdentityOpaque: eventId === "valid:colon" });
  });
  it.each([{ value: undefined, expected: "ABSENT" }, { value: "not-a-date", expected: "INVALID" },
    { value: "2026-10-10T00:00:00Z", expected: "VALID" }])("classifies real JSON timestamp $expected", async ({ value, expected }) => {
    await seed(undefined, undefined, value);
    expect(await readProcessingPreconditions(db)).toMatchObject({ occurredAtClass: expected });
  });
  it("detects a provider scope sibling while preserving both payment identities", async () => {
    const { payment } = await seed();
    const sibling = await db.paymentTransaction.create({ data: { vendorId: fixed.vendorId, providerName: "payuni",
      orderNumber: payment.orderNumber, paymentMode: "platform", grossAmountCents: 100, netAmountCents: 100, currency: "TWD", status: "pending" } });
    expect(await readProcessingPreconditions(db)).toMatchObject({ scopeSiblingCount: "MANY", fixedPaymentIsSoleScopeRow: false });
    expect(await db.paymentTransaction.findUniqueOrThrow({ where: { id: sibling.id } })).toEqual(sibling);
  });
  it("stops before projection when the original event is ambiguous", async () => {
    const { event } = await seed();
    await db.webhookEvent.create({ data: { provider: "payuni", eventId: `${prefix}_second`, eventType: "paid", payload: event.payload as Prisma.InputJsonValue } });
    expect(await readProcessingPreconditions(db)).toMatchObject({ classification: "EVENT_AMBIGUOUS", databaseWrites: false });
  });
});
