import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { getDb } from "@/lib/db";
import { createCommerceOrderForCheckout } from "@/lib/commerce-orders";
import { createReservedPaymentTransaction } from "@/lib/inventory-reservations";
import { ensureWp4SandboxFixture, WP4_SANDBOX_FIXTURE } from "@/lib/wp4-sandbox-fixture";
import { retryWp4PayUniBuyerCallback, WP4_CURRENT_BUYER_CALLBACK_SOURCE_SHA } from "@/lib/wp4-payuni-buyer-callback-retry";

vi.mock("@/lib/monitoring", () => ({ captureOperationalError: vi.fn() }));

const orderNumbers: string[] = [];
const eventIds: string[] = [];
let ownsFixture = false;

beforeAll(async () => {
  // Synthetic encryption key only; no environment file or deployed secret is read.
  vi.stubEnv("CSRF_SECRET", "wp4-buyer-callback-retry-db-synthetic-key-32-bytes");
  const db = getDb();
  const existing = await Promise.all([
    db.vendor.findUnique({ where: { id: WP4_SANDBOX_FIXTURE.vendorId }, select: { id: true } }),
    db.user.findUnique({ where: { id: WP4_SANDBOX_FIXTURE.userId }, select: { id: true } }),
    db.billingPlan.findUnique({ where: { id: WP4_SANDBOX_FIXTURE.planId }, select: { id: true } }),
  ]);
  if (existing.some(Boolean)) throw new Error("WP4_CALLBACK_RETRY_TEST_FIXTURE_EXISTS");
  await ensureWp4SandboxFixture(db);
  ownsFixture = true;
});

afterEach(async () => {
  const db = getDb();
  const orders = orderNumbers.splice(0);
  const events = eventIds.splice(0);
  await db.webhookEvent.deleteMany({ where: { id: { in: events } } });
  const transactions = await db.paymentTransaction.findMany({ where: { orderNumber: { in: orders } }, select: { id: true } });
  await db.commerceOrder.deleteMany({ where: { orderNumber: { in: orders } } });
  await db.inventoryReservation.deleteMany({ where: { paymentTransactionId: { in: transactions.map(({ id }) => id) } } });
  await db.paymentTransaction.deleteMany({ where: { id: { in: transactions.map(({ id }) => id) } } });
});

afterAll(async () => {
  const db = getDb();
  try {
    if (ownsFixture) {
      await db.emailDelivery.deleteMany({ where: { vendorId: WP4_SANDBOX_FIXTURE.vendorId } });
      await db.auditLog.deleteMany({ where: { vendorId: WP4_SANDBOX_FIXTURE.vendorId } });
      await db.vendor.delete({ where: { id: WP4_SANDBOX_FIXTURE.vendorId } });
      await db.user.delete({ where: { id: WP4_SANDBOX_FIXTURE.userId } });
      await db.billingPlan.delete({ where: { id: WP4_SANDBOX_FIXTURE.planId } });
    }
  } finally {
    vi.unstubAllEnvs();
    await db.$disconnect();
  }
});

describe("WP4 fixed buyer callback retry PostgreSQL", () => {
  it("processes one failed paid webhook and converges on a repeated retry", async () => {
    const db = getDb();
    await ensureWp4SandboxFixture(db);
    const suffix = randomUUID();
    const orderNumber = `WP4-BUYER-CALLBACK-${suffix}`;
    orderNumbers.push(orderNumber);
    const checkoutIdempotencyKey = `wp4-buyer-callback-${suffix}`;
    const transaction = await createReservedPaymentTransaction({
      vendorId: WP4_SANDBOX_FIXTURE.vendorId,
      productId: WP4_SANDBOX_FIXTURE.productId,
      checkoutIdempotencyKey,
      transactionData: {
        vendorId: WP4_SANDBOX_FIXTURE.vendorId,
        checkoutIdempotencyKey,
        providerName: "payuni",
        orderNumber,
        grossAmountCents: 100,
        netAmountCents: 100,
        currency: "TWD",
        status: "pending",
        metadata: {
          productId: WP4_SANDBOX_FIXTURE.productId,
          wp4SourceCommit: WP4_CURRENT_BUYER_CALLBACK_SOURCE_SHA,
          billingPurpose: "buyer_order",
          wp4PaymentSubmissionReserved: true,
        },
      },
      createCommerceOrder: async (tx, payment) => {
        await createCommerceOrderForCheckout(tx, {
          vendorId: WP4_SANDBOX_FIXTURE.vendorId,
          productId: WP4_SANDBOX_FIXTURE.productId,
          orderNumber,
          checkoutIdempotencyKey,
          paymentTransactionId: payment.id,
          totalAmountCents: 100,
          currency: "TWD",
          buyer: { name: "合成買家", email: `${suffix}@invalid.example`, phone: "0900000000" },
          shipping: null,
        });
      },
    });

    const event = await db.webhookEvent.create({
      data: {
        provider: "payuni",
        eventId: `wp4-buyer-callback-event-${suffix}`,
        eventType: "paid",
        status: "failed",
        maxRetries: 3,
        payload: {
          normalized: {
            provider: "payuni",
            eventId: `wp4-buyer-callback-event-${suffix}`,
            eventType: "paid",
            orderNumber,
            providerTradeNo: `PAYUNI-${suffix}`,
            vendorId: WP4_SANDBOX_FIXTURE.vendorId,
            grossAmountCents: 100,
            currency: "TWD",
          },
        },
      },
    });
    eventIds.push(event.id);

    const first = await retryWp4PayUniBuyerCallback(db);
    expect(first).toEqual({ status: "PROCESSED", retryAttempts: 1, failureCode: "NONE" });
    const emailDeliveriesAfterFirst = await db.emailDelivery.count({ where: { vendorId: WP4_SANDBOX_FIXTURE.vendorId } });
    expect(emailDeliveriesAfterFirst).toBe(1);
    await expect(db.paymentTransaction.findUniqueOrThrow({ where: { id: transaction.id } })).resolves.toMatchObject({ status: "paid", providerName: "payuni", orderNumber });
    await expect(db.inventoryReservation.findUniqueOrThrow({ where: { paymentTransactionId: transaction.id } })).resolves.toMatchObject({ status: "committed" });
    await expect(db.commerceOrder.findUniqueOrThrow({ where: { vendorId_orderNumber: { vendorId: WP4_SANDBOX_FIXTURE.vendorId, orderNumber } } })).resolves.toMatchObject({ status: "paid", paidAmountCents: 100 });

    const second = await retryWp4PayUniBuyerCallback(db);
    expect(second).toEqual({ status: "ALREADY_PROCESSED", retryAttempts: 0, failureCode: "NONE" });
    await expect(db.emailDelivery.count({ where: { vendorId: WP4_SANDBOX_FIXTURE.vendorId } })).resolves.toBe(emailDeliveriesAfterFirst);
    await expect(db.webhookEvent.findUniqueOrThrow({ where: { id: event.id } })).resolves.toMatchObject({ status: "processed", retryCount: 1 });
  });

  it("fails closed on a paid callback amount mismatch and preserves pending state", async () => {
    const db = getDb();
    const emailDeliveriesBefore = await db.emailDelivery.count({ where: { vendorId: WP4_SANDBOX_FIXTURE.vendorId } });
    const suffix = randomUUID();
    const orderNumber = `WP4-BUYER-CALLBACK-MISMATCH-${suffix}`;
    orderNumbers.push(orderNumber);
    const checkoutIdempotencyKey = `wp4-buyer-callback-mismatch-${suffix}`;
    const transaction = await createReservedPaymentTransaction({
      vendorId: WP4_SANDBOX_FIXTURE.vendorId,
      productId: WP4_SANDBOX_FIXTURE.productId,
      checkoutIdempotencyKey,
      transactionData: {
        vendorId: WP4_SANDBOX_FIXTURE.vendorId, checkoutIdempotencyKey, providerName: "payuni",
        orderNumber, grossAmountCents: 100, netAmountCents: 100, currency: "TWD", status: "pending",
        metadata: { productId: WP4_SANDBOX_FIXTURE.productId, wp4SourceCommit: WP4_CURRENT_BUYER_CALLBACK_SOURCE_SHA, billingPurpose: "buyer_order", wp4PaymentSubmissionReserved: true },
      },
      createCommerceOrder: async (tx, payment) => {
        await createCommerceOrderForCheckout(tx, {
          vendorId: WP4_SANDBOX_FIXTURE.vendorId, productId: WP4_SANDBOX_FIXTURE.productId, orderNumber,
          checkoutIdempotencyKey, paymentTransactionId: payment.id, totalAmountCents: 100, currency: "TWD",
          buyer: { name: "合成買家", email: `${suffix}@invalid.example`, phone: "0900000000" }, shipping: null,
        });
      },
    });
    const event = await db.webhookEvent.create({
      data: {
        vendorId: WP4_SANDBOX_FIXTURE.vendorId, provider: "payuni", eventId: `wp4-buyer-callback-mismatch-event-${suffix}`, eventType: "paid", status: "failed", maxRetries: 3,
        payload: { normalized: { provider: "payuni", eventId: `wp4-buyer-callback-mismatch-event-${suffix}`, eventType: "paid", orderNumber, providerTradeNo: `PAYUNI-${suffix}`, vendorId: WP4_SANDBOX_FIXTURE.vendorId, grossAmountCents: 200, currency: "TWD" } },
      },
    });
    eventIds.push(event.id);

    const result = await retryWp4PayUniBuyerCallback(db);
    expect(result).toEqual({ status: "RETRY_FAILED", retryAttempts: 1, failureCode: "amount_mismatch" });
    await expect(db.paymentTransaction.findUniqueOrThrow({ where: { id: transaction.id } })).resolves.toMatchObject({ status: "pending" });
    await expect(db.inventoryReservation.findUniqueOrThrow({ where: { paymentTransactionId: transaction.id } })).resolves.toMatchObject({ status: "reserved" });
    await expect(db.commerceOrder.findUniqueOrThrow({ where: { vendorId_orderNumber: { vendorId: WP4_SANDBOX_FIXTURE.vendorId, orderNumber } } })).resolves.toMatchObject({ status: "pending_payment", paidAmountCents: 0 });
    await expect(db.emailDelivery.count({ where: { vendorId: WP4_SANDBOX_FIXTURE.vendorId } })).resolves.toBe(emailDeliveriesBefore);
    await expect(db.webhookEvent.findUniqueOrThrow({ where: { id: event.id } })).resolves.toMatchObject({ status: "failed", retryCount: 1 });
  });
});
