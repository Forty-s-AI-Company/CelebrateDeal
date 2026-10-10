import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { beforeAll, afterAll, afterEach, expect, it } from "vitest";
import { WP4_SANDBOX_FIXTURE } from "./wp4-sandbox-fixture";
import { wp4HistoricalBuyerWhere } from "./wp4-buyer-recovery";
import { Q1_ORIGINAL_REFUND_SOURCE, readPendingRefundProof, readQ1OriginalPendingRefundProof } from "./payuni-pending-refund-proof";
import { assertLocalTestDatabase } from "../../scripts/local-database-safety";

assertLocalTestDatabase("DATABASE_URL", process.env.DATABASE_URL);
assertLocalTestDatabase("DIRECT_URL", process.env.DIRECT_URL);
const db = new PrismaClient(), execution = "a".repeat(40), prefix = `q1-original-proof-${randomUUID()}`;
const ids: string[] = [];
beforeAll(async () => {
  await db.vendor.upsert({ where: { id: WP4_SANDBOX_FIXTURE.vendorId }, update: {}, create: {
    id: WP4_SANDBOX_FIXTURE.vendorId, name: "Synthetic original refund proof vendor", slug: WP4_SANDBOX_FIXTURE.vendorSlug,
    email: WP4_SANDBOX_FIXTURE.vendorEmail, passwordHash: "synthetic-disabled-login",
  } });
});
afterEach(async () => {
  await db.webhookEvent.deleteMany({ where: { eventId: { startsWith: prefix } } });
  await db.paymentTransaction.deleteMany({ where: { id: { in: ids }, vendorId: WP4_SANDBOX_FIXTURE.vendorId } });
  ids.length = 0;
});
afterAll(() => db.$disconnect());
async function fixture(callback = true) {
  const id = `${prefix}-${ids.length}`; ids.push(id);
  const payment = await db.paymentTransaction.create({ data: { id, vendorId: WP4_SANDBOX_FIXTURE.vendorId,
    providerName: "payuni", orderNumber: `${id}-order`, providerTradeNo: `${id}-trade`, currency: "TWD",
    grossAmountCents: 100, netAmountCents: 100, refundedAmountCents: 0, status: "paid",
    checkoutIdempotencyKey: wp4HistoricalBuyerWhere(Q1_ORIGINAL_REFUND_SOURCE).checkoutIdempotencyKey,
    metadata: { billingPurpose: "buyer_order", productId: WP4_SANDBOX_FIXTURE.productId, wp4SourceCommit: Q1_ORIGINAL_REFUND_SOURCE,
      wp4PaymentSubmissionReserved: true, wp4CallbackRetryReserved: true, q1SchemaRecoveryReserved: true } } });
  if (callback) await db.webhookEvent.create({ data: { vendorId: payment.vendorId, provider: "payuni", eventId: id,
    eventType: "paid", status: "processed", payload: { normalized: { orderNumber: payment.orderNumber,
      providerTradeNo: payment.providerTradeNo, grossAmountCents: 100 } } } });
  return payment;
}
it("binds the catalog-owned original separately from the executing source without rewriting metadata", async () => {
  const payment = await fixture();
  expect(await readPendingRefundProof(db, payment.id, execution)).toBeNull();
  expect(await readQ1OriginalPendingRefundProof(db, execution)).toMatchObject({ sourceCommit: execution,
    transactionSourceCommit: Q1_ORIGINAL_REFUND_SOURCE, historicalOriginalBound: true,
    paymentCallbackMatched: true, status: "paid", grossAmountCents: 100, refundRecordCount: 0 });
  expect((await db.paymentTransaction.findUniqueOrThrow({ where: { id: payment.id } })).metadata).toEqual(payment.metadata);
});
it.each(["wp4CallbackRetryReserved", "q1SchemaRecoveryReserved", "wp4PaymentSubmissionReserved"])("rejects missing durable %s", async marker => {
  const payment = await fixture();
  await db.paymentTransaction.update({ where: { id: payment.id }, data: { metadata: { ...Object(payment.metadata), [marker]: false } } });
  expect(await readQ1OriginalPendingRefundProof(db, execution)).toBeNull();
});
it.each([{ wp4SourceCommit: "b".repeat(40) }, { productId: "foreign-product" }, { billingPurpose: "platform_subscription" }])("rejects foreign original metadata %#", async drift => {
  const payment = await fixture();
  await db.paymentTransaction.update({ where: { id: payment.id }, data: { metadata: { ...Object(payment.metadata), ...drift } } });
  expect(await readQ1OriginalPendingRefundProof(db, execution)).toBeNull();
});
it.each([{ grossAmountCents: 200 }, { currency: "USD" }, { checkoutIdempotencyKey: "foreign-checkout" }, { providerName: "demo" }])("rejects fixed money/provider/idempotency drift %#", async drift => {
  const payment = await fixture(); await db.paymentTransaction.update({ where: { id: payment.id }, data: drift });
  expect(await readQ1OriginalPendingRefundProof(db, execution)).toBeNull();
});
it("never borrows another order's processed callback", async () => {
  const payment = await fixture(false);
  await db.webhookEvent.create({ data: { vendorId: payment.vendorId, provider: "payuni", eventId: payment.id,
    eventType: "paid", status: "processed", payload: { normalized: { orderNumber: "foreign-order",
      providerTradeNo: payment.providerTradeNo, grossAmountCents: 100 } } } });
  expect(await readQ1OriginalPendingRefundProof(db, execution)).toBeNull();
});
it("rejects ambiguous processed callback evidence in both proof paths", async () => {
  const payment = await fixture();
  await db.webhookEvent.create({ data: { vendorId: payment.vendorId, provider: "payuni", eventId: `${payment.id}-duplicate`,
    eventType: "paid", status: "processed", payload: { normalized: { orderNumber: payment.orderNumber,
      providerTradeNo: payment.providerTradeNo, grossAmountCents: 100 } } } });
  expect((await readPendingRefundProof(db, payment.id, Q1_ORIGINAL_REFUND_SOURCE))?.paymentCallbackMatched).toBe(false);
  expect(await readQ1OriginalPendingRefundProof(db, execution)).toBeNull();
});
it("requires one processed full refund with its provider identity, not merely refunded status", async () => {
  const payment = await fixture();
  await db.paymentTransaction.update({ where: { id: payment.id }, data: { status: "refunded", refundedAmountCents: 100 } });
  expect((await readQ1OriginalPendingRefundProof(db, execution))?.refundPersistencePassed).toBe(false);
  const refund = await db.refundRecord.create({ data: { vendorId: payment.vendorId, paymentTransactionId: payment.id,
    monthKey: "2026-10", refundAmountCents: 100, status: "pending", providerEventId: "synthetic-original-refund" } });
  expect((await readQ1OriginalPendingRefundProof(db, execution))?.refundPersistencePassed).toBe(false);
  await db.refundRecord.update({ where: { id: refund.id }, data: { status: "processed" } });
  expect((await readQ1OriginalPendingRefundProof(db, execution))?.refundPersistencePassed).toBe(true);
  await db.refundRecord.create({ data: { vendorId: payment.vendorId, paymentTransactionId: payment.id,
    monthKey: "2026-10", refundAmountCents: 1, status: "failed" } });
  expect((await readQ1OriginalPendingRefundProof(db, execution))?.refundPersistencePassed).toBe(false);
});
it("rejects malformed execution identity without weakening original source binding", async () => {
  await fixture(); expect(await readQ1OriginalPendingRefundProof(db, "unknown")).toBeNull();
});
