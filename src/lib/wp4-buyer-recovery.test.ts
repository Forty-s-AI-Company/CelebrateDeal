import { describe, expect, it, vi } from "vitest";
import { readWp4ExistingBuyerState, wp4HistoricalBuyerWhere, WP4_BUYER_CONTINUATION_SOURCE } from "./wp4-buyer-recovery";
import { WP4_SANDBOX_FIXTURE as fixture } from "./wp4-sandbox-fixture";
function database(refunded = false) {
 const payment = { id: "payment", status: refunded ? "refunded" : "paid", orderNumber: "order", refundedAmountCents: refunded ? 100 : 0 };
 const order = { id: "order", status: refunded ? "refunded" : "paid", orderNumber: "order", checkoutIdempotencyKey: wp4HistoricalBuyerWhere().checkoutIdempotencyKey,
  paidAmountCents: 100, totalAmountCents: 100, items: [{ productId: fixture.productId as string, quantity: 1, unitPriceCents: 100, lineTotalCents: 100, commerceDomain: "merchant", fulfillmentType: "physical" }] };
 const tx = { paymentTransaction: { findMany: vi.fn().mockResolvedValue([payment]) }, commerceOrder: { findMany: vi.fn().mockResolvedValue([order]) },
  commerceOrderEvent: { count: vi.fn().mockResolvedValue(1) }, inventoryReservation: { count: vi.fn().mockResolvedValue(1) }, emailDelivery: { count: vi.fn().mockResolvedValue(1) },
  refundRecord: { aggregate: vi.fn().mockResolvedValue({ _count: refunded ? 1 : 0, _sum: { refundAmountCents: refunded ? 100 : null } }) },
  commerceOrderRefund: { aggregate: vi.fn().mockResolvedValue({ _count: refunded ? 1 : 0, _sum: { amountCents: refunded ? 100 : null } }) } };
 return { tx, order, db: { $transaction: vi.fn(async callback => callback(tx)) } };
}
describe("exact historical buyer persisted proof", () => {
 it("verifies paid state and scopes reads to tenant, exact source and checkout identity", async () => {
  const { db, tx } = database(); expect(await readWp4ExistingBuyerState(db as never)).toMatchObject({ status: "VERIFIED", paymentStatus: "PAID", refundReconciled: false });
  expect(tx.paymentTransaction.findMany).toHaveBeenCalledWith({ where: wp4HistoricalBuyerWhere(), take: 2, select: expect.any(Object) });
  expect(wp4HistoricalBuyerWhere().AND).toContainEqual({ metadata: { path: ["wp4SourceCommit"], equals: WP4_BUYER_CONTINUATION_SOURCE } });
  expect(tx.commerceOrder.findMany.mock.calls[0]![0].where).toEqual({ vendorId: fixture.vendorId, primaryPaymentTransactionId: "payment" });
 });
 it("verifies one exact processed refund with matching order refund", async () => {
  const { db, tx } = database(true); expect(await readWp4ExistingBuyerState(db as never)).toMatchObject({ status: "VERIFIED", paymentStatus: "REFUNDED", refundReconciled: true });
  expect(tx.inventoryReservation.count).toHaveBeenCalledWith({ where: expect.objectContaining({ vendorId: fixture.vendorId, paymentTransactionId: "payment", status: "released", releaseReason: "full_refund", committedAt: { not: null }, releasedAt: { not: null } }) });
 });
 it("rejects duplicate refunds even when their total amount is correct", async () => {
  const { db, tx } = database(true); tx.refundRecord.aggregate.mockResolvedValue({ _count: 2, _sum: { refundAmountCents: 100 } });
  expect(await readWp4ExistingBuyerState(db as never)).toEqual({ status: "STATE_MISMATCH" });
 });
 it("rejects another product with identical commercial amounts", async () => {
  const { db, order } = database(); order.items[0]!.productId = "foreign-product";
  expect(await readWp4ExistingBuyerState(db as never)).toEqual({ status: "STATE_MISMATCH" });
 });
 it.each([0, 2])("rejects %i payments without reading order projection", async count => {
  const { db, tx } = database(); tx.paymentTransaction.findMany.mockResolvedValue(Array.from({ length: count }, () => ({ id: "ambiguous" })));
  expect(await readWp4ExistingBuyerState(db as never)).toEqual({ status: count ? "CANDIDATE_AMBIGUOUS" : "FIXTURE_UNAVAILABLE" });
  expect(tx.commerceOrder.findMany).not.toHaveBeenCalled();
 });
 it("rejects duplicate paid events or missing inventory commitment", async () => {
  const { db, tx } = database(); tx.commerceOrderEvent.count.mockResolvedValue(2);
  expect(await readWp4ExistingBuyerState(db as never)).toEqual({ status: "STATE_MISMATCH" });
  tx.commerceOrderEvent.count.mockResolvedValue(1); tx.inventoryReservation.count.mockResolvedValue(0);
  expect(await readWp4ExistingBuyerState(db as never)).toEqual({ status: "STATE_MISMATCH" });
 });
});
