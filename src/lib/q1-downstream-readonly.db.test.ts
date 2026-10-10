import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@prisma/client";
import { assertLocalTestDatabase } from "../../scripts/local-database-safety";
import { readQ1Downstream, Q1_ORIGINAL_SOURCE, Q1DownstreamReceipt } from "./q1-downstream-readonly";
import { ensureWp4SandboxFixture, WP4_SANDBOX_FIXTURE as fixed } from "./wp4-sandbox-fixture";
import { wp4HistoricalBuyerWhere } from "./wp4-buyer-recovery";
import { createReservedPaymentTransaction } from "./inventory-reservations";
import { createCommerceOrderForCheckout } from "./commerce-orders";
import { retryWebhookEvent } from "./webhook-retry";

assertLocalTestDatabase("DATABASE_URL", process.env.DATABASE_URL);
const db = new PrismaClient();
afterEach(async () => {
  vi.unstubAllEnvs();
  await db.vendor.deleteMany({ where: { id: fixed.vendorId } });
  await db.user.deleteMany({ where: { id: fixed.userId } });
  await db.billingPlan.deleteMany({ where: { id: fixed.planId } });
});
afterAll(() => db.$disconnect());
async function seed() {
  vi.stubEnv("CSRF_SECRET", "synthetic-q1-encryption-key-aaaaaaaaaaaaaaaa");
  await ensureWp4SandboxFixture(db);
  const key = wp4HistoricalBuyerWhere(Q1_ORIGINAL_SOURCE).checkoutIdempotencyKey;
  return createReservedPaymentTransaction({ vendorId: fixed.vendorId, productId: fixed.productId, checkoutIdempotencyKey: key,
    transactionData: { vendorId: fixed.vendorId, providerName: "payuni", orderNumber: "synthetic-q1-downstream-order",
      paymentMode: "platform", grossAmountCents: 100, netAmountCents: 100, currency: "TWD", status: "pending", checkoutIdempotencyKey: key,
      metadata: { billingPurpose: "buyer_order", productId: fixed.productId, wp4SourceCommit: Q1_ORIGINAL_SOURCE, wp4PaymentSubmissionReserved: true } },
    createCommerceOrder: async (tx, payment) => { await createCommerceOrderForCheckout(tx, { vendorId: fixed.vendorId, productId: fixed.productId,
      orderNumber: "synthetic-q1-downstream-order", checkoutIdempotencyKey: key, paymentTransactionId: payment.id,
      totalAmountCents: 100, currency: "TWD", buyer: { name: "Synthetic private buyer", email: "q1-private@invalid.example" }, shipping: null }); },
  });
}

describe("real PostgreSQL downstream readonly probe", () => {
  it("checks the original synthetic order in-process without writes or disclosure", async () => {
    const payment = await seed();
    const order = await db.commerceOrder.findFirstOrThrow({ where: { primaryPaymentTransactionId: payment.id } });
    const receipt = await readQ1Downstream(db);
    expect(receipt).toMatchObject({ classification: "DOWNSTREAM_OBSERVED", decrypt: "OK", protect: "OK",
      billingPurposeClass: "buyer_order", coursePolicySnapshotClass: "ABSENT", databaseWrites: false, callbackPosts: 0 });
    expect(receipt.schema.every(row => row.compatible)).toBe(true);
    expect(receipt.enums.every(row => row.compatible)).toBe(true);
    expect(JSON.stringify(receipt)).not.toContain(order.buyerEncryptedEnvelope);
    for (const value of [payment.id, order.id, "q1-private@invalid.example", "Synthetic private buyer"]) expect(JSON.stringify(receipt)).not.toContain(value);
    expect(await db.paymentTransaction.findUniqueOrThrow({ where: { id: payment.id } })).toEqual(payment);
    expect(await db.commerceOrder.findUniqueOrThrow({ where: { id: order.id } })).toEqual(order);
    expect(await db.emailDelivery.count({ where: { vendorId: fixed.vendorId } })).toBe(0);
    expect(Q1DownstreamReceipt.parse(receipt)).toEqual(receipt);
  });
  it("classifies a real authentication-tag mismatch without outputting the key", async () => {
    await seed();
    vi.stubEnv("CSRF_SECRET", "synthetic-q1-encryption-key-bbbbbbbbbbbbbbbb");
    expect(await readQ1Downstream(db)).toMatchObject({ decrypt: "SENSITIVE_ENVELOPE_AUTH_FAILED", protect: "NOT_RUN" });
  });
  it("classifies a malformed envelope without changing it", async () => {
    await seed();
    await db.commerceOrder.updateMany({ where: { vendorId: fixed.vendorId }, data: { buyerEncryptedEnvelope: "synthetic-invalid-envelope" } });
    expect(await readQ1Downstream(db)).toMatchObject({ decrypt: "SENSITIVE_ENVELOPE_INVALID", protect: "NOT_RUN" });
  });
  it("persists only the real failed stage and cause while rolling back payment", async () => {
    const payment = await seed();
    await db.commerceOrder.updateMany({ where: { vendorId: fixed.vendorId }, data: { buyerEncryptedEnvelope: "synthetic-invalid-envelope" } });
    const event = await db.webhookEvent.create({ data: { vendorId: fixed.vendorId, provider: "payuni", eventId: "synthetic-q1-stage-paid",
      eventType: "paid", status: "failed", retryCount: 1, maxRetries: 5, payload: { normalized: { provider: "payuni",
        eventId: "synthetic-q1-stage-paid", eventType: "paid", vendorId: fixed.vendorId, orderNumber: payment.orderNumber,
        grossAmountCents: 100, netAmountCents: 100, currency: "TWD" } } } });
    expect(await retryWebhookEvent(event.id, "synthetic-stage-probe")).toMatchObject({ status: "failed", errorCode: "processing_failed" });
    const audit = await db.auditLog.findFirstOrThrow({ where: { vendorId: fixed.vendorId, targetId: event.id, actorLabel: "synthetic-stage-probe" } });
    expect(audit.after).toEqual({ errorCode: "processing_failed", errorClass: "SENSITIVE_ENVELOPE_INVALID",
      errorStage: "PAID_DELIVERY_DECRYPT", status: "failed" });
    expect(await db.paymentTransaction.findUniqueOrThrow({ where: { id: payment.id } })).toEqual(payment);
    expect(await db.commerceOrderEvent.count({ where: { vendorId: fixed.vendorId, eventType: "payment.paid" } })).toBe(0);
    expect(await db.emailDelivery.count({ where: { vendorId: fixed.vendorId } })).toBe(0);
    expect((await db.webhookEvent.findUniqueOrThrow({ where: { id: event.id } })).retryCount).toBe(2);
  });
  it.each([
    { table: "EmailDelivery", column: "recipientHash" },
    { table: "AffiliateCommission", column: "merchantCheckoutId" },
  ])("detects an actual missing $table column before any crypto read", async ({ table, column }) => {
    await seed();
    // Identifiers are the fixed reviewed table/column tuples above; loopback guard
    // runs before mutation, and each rename is restored even when an assertion fails.
    await db.$executeRawUnsafe(`ALTER TABLE "${table}" RENAME COLUMN "${column}" TO "q1_probe_missing"`);
    try {
      const receipt = await readQ1Downstream(db);
      expect(receipt.classification).toBe("SCHEMA_INCOMPATIBLE");
      expect(receipt.schema.find(row => row.model === table)).toMatchObject({ compatible: false, missingColumns: [column] });
      expect(receipt.decrypt).toBe("NOT_RUN");
    } finally { await db.$executeRawUnsafe(`ALTER TABLE "${table}" RENAME COLUMN "q1_probe_missing" TO "${column}"`); }
  });
  it("detects an actual missing enum label in the same batch", async () => {
    await seed();
    await db.$executeRaw`ALTER TYPE "CommerceFulfillmentType" RENAME VALUE 'physical' TO 'q1_probe_missing_physical'`;
    try {
      const receipt = await readQ1Downstream(db);
      expect(receipt.classification).toBe("SCHEMA_INCOMPATIBLE");
      expect(receipt.enums.find(row => row.name === "CommerceFulfillmentType")).toMatchObject({ compatible: false, missingLabels: ["physical"] });
    } finally { await db.$executeRaw`ALTER TYPE "CommerceFulfillmentType" RENAME VALUE 'q1_probe_missing_physical' TO 'physical'`; }
  });
  it("PostgreSQL rejects an attempted mutation inside the probe", async () => {
    await seed();
    const proxy = { $transaction: ((callback: (tx: unknown) => Promise<unknown>, options: unknown) => db.$transaction(async tx => {
      const wrapped = new Proxy(tx, { get(target, property) {
        if (property === "$executeRaw") return async (...args: unknown[]) => {
          await Reflect.apply(target.$executeRaw, target, args);
          await tx.vendor.update({ where: { id: fixed.vendorId }, data: { name: "not allowed" } });
        };
        const value = Reflect.get(target, property);
        return typeof value === "function" ? value.bind(target) : value;
      } });
      return callback(wrapped);
    }, options as never)) as typeof db.$transaction };
    expect(await readQ1Downstream(proxy)).toMatchObject({ classification: "READ_FAILED" });
    expect((await db.vendor.findUniqueOrThrow({ where: { id: fixed.vendorId } })).name).not.toBe("not allowed");
  });
});
