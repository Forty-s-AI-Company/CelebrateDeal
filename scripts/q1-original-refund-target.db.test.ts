import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { beforeAll, afterAll, afterEach, expect, it } from "vitest";
import { WP4_SANDBOX_FIXTURE } from "../src/lib/wp4-sandbox-fixture";
import { wp4HistoricalBuyerWhere } from "../src/lib/wp4-buyer-recovery";
import { assertLocalTestDatabase } from "./local-database-safety";
import { ORIGINAL_REFUND_SOURCE, readOriginalRefundTarget, reserveOriginalRefund, readReservedOriginalRefundTarget, recordOriginalDuplicateVerified } from "./q1-original-refund-target";
assertLocalTestDatabase("DATABASE_URL", process.env.DATABASE_URL);
assertLocalTestDatabase("DIRECT_URL", process.env.DIRECT_URL);
const db = new PrismaClient(), prefix = `q1-original-refund-${randomUUID()}`, ids: string[] = [];
beforeAll(async () => { await db.vendor.upsert({ where: { id: WP4_SANDBOX_FIXTURE.vendorId }, update: {}, create: {
  id: WP4_SANDBOX_FIXTURE.vendorId, name: "Synthetic original refund target", slug: WP4_SANDBOX_FIXTURE.vendorSlug,
  email: WP4_SANDBOX_FIXTURE.vendorEmail, passwordHash: "synthetic-disabled-login" } }); });
afterEach(async () => {
  await db.refundRecord.deleteMany({ where: { paymentTransactionId: { in: ids }, vendorId: WP4_SANDBOX_FIXTURE.vendorId } });
  await db.paymentTransaction.deleteMany({ where: { id: { in: ids }, vendorId: WP4_SANDBOX_FIXTURE.vendorId } }); ids.length = 0;
});
afterAll(() => db.$disconnect());
async function fixture() {
  const id = `${prefix}-${ids.length}`; ids.push(id);
  return db.paymentTransaction.create({ data: { id, vendorId: WP4_SANDBOX_FIXTURE.vendorId, providerName: "payuni",
    orderNumber: `${id}-order`, providerTradeNo: `${id}-trade`, currency: "TWD", grossAmountCents: 100, netAmountCents: 100,
    refundedAmountCents: 0, status: "paid", checkoutIdempotencyKey: wp4HistoricalBuyerWhere(ORIGINAL_REFUND_SOURCE).checkoutIdempotencyKey,
    metadata: { billingPurpose: "buyer_order", productId: WP4_SANDBOX_FIXTURE.productId, wp4SourceCommit: ORIGINAL_REFUND_SOURCE,
      wp4PaymentSubmissionReserved: true, wp4CallbackRetryReserved: true, q1SchemaRecoveryReserved: true } } });
}
it("reserves once without replacing original provenance or submitting payment/refund", async () => {
  const row = await fixture(); expect(await readOriginalRefundTarget(db)).toEqual({ transactionId: row.id, orderNumber: row.orderNumber, providerTradeNo: row.providerTradeNo });
  await reserveOriginalRefund(db, row.id); await expect(reserveOriginalRefund(db, row.id)).rejects.toThrow();
  const after = await db.paymentTransaction.findUniqueOrThrow({ where: { id: row.id } });
  expect(after.metadata).toEqual({ ...Object(row.metadata), q1OriginalRefundReserved: true });
  expect(after.status).toBe("paid"); expect(after.providerTradeNo).toBe(row.providerTradeNo);
  expect(await db.refundRecord.count({ where: { paymentTransactionId: row.id } })).toBe(0);
  await expect(readOriginalRefundTarget(db)).rejects.toThrow();
});
it("concurrent reservations have exactly one winner", async () => {
  const row = await fixture(); const results = await Promise.allSettled([reserveOriginalRefund(db, row.id), reserveOriginalRefund(db, row.id)]);
  expect(results.filter(result => result.status === "fulfilled")).toHaveLength(1);
});
it("never accepts a caller substitute ID", async () => {
  const row = await fixture(); await expect(reserveOriginalRefund(db, "foreign-transaction")).rejects.toThrow();
  expect((await db.paymentTransaction.findUniqueOrThrow({ where: { id: row.id } })).metadata).toEqual(row.metadata);
});
it.each(["wp4CallbackRetryReserved", "q1SchemaRecoveryReserved", "wp4PaymentSubmissionReserved"])("rejects missing original marker %s", async key => {
  const row = await fixture(); await db.paymentTransaction.update({ where: { id: row.id }, data: { metadata: { ...Object(row.metadata), [key]: false } } });
  await expect(readOriginalRefundTarget(db)).rejects.toThrow(); await expect(reserveOriginalRefund(db, row.id)).rejects.toThrow();
});
it.each([{ status: "refunded" }, { refundedAmountCents: 100 }, { currency: "USD" }, { providerName: "demo" }])("rejects original state/provider drift %#", async patch => {
  const row = await fixture(); await db.paymentTransaction.update({ where: { id: row.id }, data: patch });
  await expect(readOriginalRefundTarget(db)).rejects.toThrow(); await expect(reserveOriginalRefund(db, row.id)).rejects.toThrow();
});
it("an existing pending refund cannot authorize another submission", async () => {
  const row = await fixture(); await db.refundRecord.create({ data: { vendorId: row.vendorId, paymentTransactionId: row.id,
    monthKey: "2026-10", refundAmountCents: 100, status: "pending" } });
  await expect(readOriginalRefundTarget(db)).rejects.toThrow(); await expect(reserveOriginalRefund(db, row.id)).rejects.toThrow();
});
async function processedFixture(marked = true) {
  const row = await fixture();
  await db.paymentTransaction.update({ where: { id: row.id }, data: { status: "refunded", refundedAmountCents: 100,
    metadata: { ...Object(row.metadata), ...(marked ? { q1OriginalRefundReserved: true } : {}) } } });
  await db.refundRecord.create({ data: { vendorId: row.vendorId, paymentTransactionId: row.id, monthKey: "2026-10",
    refundAmountCents: 100, status: "processed", providerEventId: "synthetic-original-full-refund" } });
  return row;
}
it("readonly resume accepts only the marked original with one processed full refund", async () => {
  const row = await processedFixture(); const before = await db.paymentTransaction.findUniqueOrThrow({ where: { id: row.id } });
  expect(await readReservedOriginalRefundTarget(db)).toEqual({ transactionId: row.id, orderNumber: row.orderNumber,
    providerTradeNo: row.providerTradeNo, reservationVerified: true, duplicateUIVerified: false });
  expect(await db.paymentTransaction.findUniqueOrThrow({ where: { id: row.id } })).toEqual(before);
});
it("readonly resume refuses absent marker even when refund is processed", async () => {
  await processedFixture(false); await expect(readReservedOriginalRefundTarget(db)).rejects.toThrow();
});
it.each(["pending", "foreign-source", "duplicate"])("readonly resume refuses %s evidence", async drift => {
  const row = await processedFixture();
  if (drift === "pending") await db.refundRecord.updateMany({ where: { paymentTransactionId: row.id }, data: { status: "pending" } });
  if (drift === "foreign-source") await db.paymentTransaction.update({ where: { id: row.id }, data: { metadata: { ...Object(row.metadata),
    q1OriginalRefundReserved: true, wp4SourceCommit: "b".repeat(40) } } });
  if (drift === "duplicate") await db.refundRecord.create({ data: { vendorId: row.vendorId, paymentTransactionId: row.id, monthKey: "2026-10",
    refundAmountCents: 1, status: "failed" } });
  await expect(readReservedOriginalRefundTarget(db)).rejects.toThrow();
});
it("durable duplicate observation requires the marked full processed original", async () => {
  const row = await processedFixture(); await recordOriginalDuplicateVerified(db, row.id);
  expect((await readReservedOriginalRefundTarget(db)).duplicateUIVerified).toBe(true);
  await expect(recordOriginalDuplicateVerified(db, "foreign")).rejects.toThrow();
});
it("cannot record duplicate verification on an unmarked or unpaid original", async () => {
  const row = await fixture(); await expect(recordOriginalDuplicateVerified(db, row.id)).rejects.toThrow();
});