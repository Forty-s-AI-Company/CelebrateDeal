import { describe, expect, it, vi } from "vitest";
import { readWp4PayUniBuyerOrderProof } from "@/lib/wp4-payuni-buyer-order-proof";
import { WP4_SANDBOX_FIXTURE } from "@/lib/wp4-sandbox-fixture";

const sourceSha = "a".repeat(40);

function fixture() {
  const payment = {
    id: "synthetic-payment", status: "paid", orderNumber: "synthetic-order", grossAmountCents: 100,
    currency: "TWD", checkoutIdempotencyKey: "synthetic-checkout-key",
    metadata: { wp4SourceCommit: sourceSha, billingPurpose: "buyer_order", productId: WP4_SANDBOX_FIXTURE.productId },
  };
  const order = {
    id: "synthetic-order-id", status: "paid", orderNumber: payment.orderNumber,
    checkoutIdempotencyKey: payment.checkoutIdempotencyKey, currency: "TWD",
    subtotalAmountCents: 100, totalAmountCents: 100, paidAmountCents: 100,
    items: [{ productId: WP4_SANDBOX_FIXTURE.productId, lineIndex: 0, commerceDomain: "merchant",
      fulfillmentType: "physical", unitPriceCents: 100, quantity: 1, lineTotalCents: 100 }],
  };
  const tx = {
    paymentTransaction: { findMany: vi.fn().mockResolvedValue([payment]) },
    commerceOrder: { findMany: vi.fn().mockResolvedValue([order]) },
    commerceOrderEvent: { count: vi.fn().mockResolvedValue(1) },
    inventoryReservation: { findMany: vi.fn().mockResolvedValue([{ status: "committed", productId: WP4_SANDBOX_FIXTURE.productId, quantity: 1 }]) },
    product: { findUnique: vi.fn().mockResolvedValue({ vendorId: WP4_SANDBOX_FIXTURE.vendorId,
      priceCents: 100, currency: "TWD", commerceDomain: "merchant", fulfillmentType: "physical", inventory: 2 }) },
  };
  const db = { $transaction: vi.fn(async (read: (value: typeof tx) => unknown) => read(tx)) };
  return { db, tx, payment, order };
}

describe("fixed PayUni buyer order proof", () => {
  it("attests the persisted synthetic order and permits comparison after an identical callback", async () => {
    const { db, tx } = fixture();
    const first = await readWp4PayUniBuyerOrderProof(db as never, sourceSha);
    const afterDuplicate = await readWp4PayUniBuyerOrderProof(db as never, sourceSha);
    expect(first).toEqual({
      status: "VERIFIED", paymentStatus: "paid", orderStatus: "paid", orderCount: 1,
      paidEventCount: 1, orderEventCount: 1, reservationStatus: "committed", remainingInventory: 2,
    });
    expect(afterDuplicate).toEqual(first);
    expect(JSON.stringify(first)).not.toContain("synthetic-order");
    expect(db.$transaction).toHaveBeenCalledWith(expect.any(Function), { isolationLevel: "RepeatableRead" });
    expect(tx.commerceOrderEvent.count).toHaveBeenCalledWith({
      where: { vendorId: WP4_SANDBOX_FIXTURE.vendorId, orderId: "synthetic-order-id", eventType: "payment.paid" },
    });
  });

  it("rejects source drift, ambiguity, and duplicated paid order events", async () => {
    const { db, tx, payment } = fixture();
    expect(await readWp4PayUniBuyerOrderProof(db as never, "b".repeat(40))).toEqual({ status: "FIXTURE_UNAVAILABLE" });
    tx.paymentTransaction.findMany.mockResolvedValueOnce([payment, { ...payment, id: "second-payment" }]);
    expect(await readWp4PayUniBuyerOrderProof(db as never, sourceSha)).toEqual({ status: "CANDIDATE_AMBIGUOUS" });
    tx.commerceOrderEvent.count.mockResolvedValueOnce(2);
    expect(await readWp4PayUniBuyerOrderProof(db as never, sourceSha)).toEqual({ status: "STATE_MISMATCH" });
  });

  it("rejects mismatched payment amounts, incomplete reservations, and missing orders", async () => {
    const { db, tx, order } = fixture();
    tx.commerceOrder.findMany.mockResolvedValueOnce([{ ...order, paidAmountCents: 99 }]);
    expect(await readWp4PayUniBuyerOrderProof(db as never, sourceSha)).toEqual({ status: "STATE_MISMATCH" });
    tx.inventoryReservation.findMany.mockResolvedValueOnce([{ status: "reserved", productId: WP4_SANDBOX_FIXTURE.productId, quantity: 1 }]);
    expect(await readWp4PayUniBuyerOrderProof(db as never, sourceSha)).toEqual({ status: "STATE_MISMATCH" });
    tx.commerceOrder.findMany.mockResolvedValueOnce([]);
    expect(await readWp4PayUniBuyerOrderProof(db as never, sourceSha)).toEqual({ status: "STATE_MISMATCH" });
  });

  it.each([
    ["wrong product", (order: ReturnType<typeof fixture>["order"]) => ({ ...order, items: [{ ...order.items[0], productId: "other-product" }] })],
    ["wrong quantity", (order: ReturnType<typeof fixture>["order"]) => ({ ...order, items: [{ ...order.items[0], quantity: 2 }] })],
    ["wrong unit price", (order: ReturnType<typeof fixture>["order"]) => ({ ...order, items: [{ ...order.items[0], unitPriceCents: 50 }] })],
    ["extra order line", (order: ReturnType<typeof fixture>["order"]) => ({ ...order, items: [...order.items, { ...order.items[0], lineIndex: 1 }] })],
    ["wrong order currency", (order: ReturnType<typeof fixture>["order"]) => ({ ...order, currency: "USD" })],
  ])("rejects %s despite matching paid amount", async (_case, mutate) => {
    const { db, tx, order } = fixture();
    tx.commerceOrder.findMany.mockResolvedValueOnce([mutate(order)]);
    expect(await readWp4PayUniBuyerOrderProof(db as never, sourceSha)).toEqual({ status: "STATE_MISMATCH" });
  });

  it("rejects wrong payment currency and wrong reservation quantity", async () => {
    const { db, tx, payment } = fixture();
    tx.paymentTransaction.findMany.mockResolvedValueOnce([{ ...payment, currency: "USD" }]);
    expect(await readWp4PayUniBuyerOrderProof(db as never, sourceSha)).toEqual({ status: "STATE_MISMATCH" });
    tx.inventoryReservation.findMany.mockResolvedValueOnce([{ status: "committed", productId: WP4_SANDBOX_FIXTURE.productId, quantity: 2 }]);
    expect(await readWp4PayUniBuyerOrderProof(db as never, sourceSha)).toEqual({ status: "STATE_MISMATCH" });
  });

  it("rejects a fixture product rebound to another vendor or currency", async () => {
    const { db, tx } = fixture();
    tx.product.findUnique.mockResolvedValueOnce({ vendorId: "other-vendor", priceCents: 100,
      currency: "TWD", commerceDomain: "merchant", fulfillmentType: "physical", inventory: 2 });
    expect(await readWp4PayUniBuyerOrderProof(db as never, sourceSha)).toEqual({ status: "STATE_MISMATCH" });
    tx.product.findUnique.mockResolvedValueOnce({ vendorId: WP4_SANDBOX_FIXTURE.vendorId, priceCents: 100,
      currency: "USD", commerceDomain: "merchant", fulfillmentType: "physical", inventory: 2 });
    expect(await readWp4PayUniBuyerOrderProof(db as never, sourceSha)).toEqual({ status: "STATE_MISMATCH" });
  });

});
