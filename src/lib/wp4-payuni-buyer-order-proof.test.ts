import { describe, expect, it, vi } from "vitest";
import { readWp4PayUniBuyerOrderProof, verifyWp4PayUniDuplicateCallback } from "@/lib/wp4-payuni-buyer-order-proof";
import { WP4_SANDBOX_FIXTURE } from "@/lib/wp4-sandbox-fixture";

const sourceSha = "a".repeat(40);

function fixture() {
  const payment = {
    id: "synthetic-payment", status: "paid", orderNumber: "synthetic-order", grossAmountCents: 1200,
    metadata: { wp4SourceCommit: sourceSha, billingPurpose: "buyer_order", productId: WP4_SANDBOX_FIXTURE.productId },
  };
  const order = {
    id: "synthetic-order-id", status: "paid", orderNumber: payment.orderNumber,
    totalAmountCents: 1200, paidAmountCents: 1200,
  };
  const db = {
    paymentTransaction: { findMany: vi.fn().mockResolvedValue([payment]) },
    commerceOrder: { findMany: vi.fn().mockResolvedValue([order]) },
    commerceOrderEvent: { count: vi.fn().mockResolvedValue(1) },
    inventoryReservation: { findMany: vi.fn().mockResolvedValue([{ status: "committed", productId: WP4_SANDBOX_FIXTURE.productId }]) },
    product: { findUnique: vi.fn().mockResolvedValue({ inventory: 2 }) },
  };
  return { db, payment, order };
}

describe("fixed PayUni buyer order proof", () => {
  it("attests the persisted synthetic order and permits comparison after an identical callback", async () => {
    const { db } = fixture();
    const first = await readWp4PayUniBuyerOrderProof(db as never, sourceSha);
    const afterDuplicate = await readWp4PayUniBuyerOrderProof(db as never, sourceSha);
    expect(first).toEqual({
      status: "VERIFIED", paymentStatus: "paid", orderStatus: "paid", orderCount: 1,
      paidEventCount: 1, reservationStatus: "committed", remainingInventory: 2,
    });
    expect(afterDuplicate).toEqual(first);
    expect(JSON.stringify(first)).not.toContain("synthetic-order");
    expect(db.commerceOrderEvent.count).toHaveBeenCalledWith({
      where: { vendorId: WP4_SANDBOX_FIXTURE.vendorId, orderId: "synthetic-order-id", eventType: "payment.paid" },
    });
  });

  it("rejects source drift, ambiguity, and duplicated paid order events", async () => {
    const { db, payment } = fixture();
    expect(await readWp4PayUniBuyerOrderProof(db as never, "b".repeat(40))).toEqual({ status: "FIXTURE_UNAVAILABLE" });
    db.paymentTransaction.findMany.mockResolvedValueOnce([payment, { ...payment, id: "second-payment" }]);
    expect(await readWp4PayUniBuyerOrderProof(db as never, sourceSha)).toEqual({ status: "CANDIDATE_AMBIGUOUS" });
    db.commerceOrderEvent.count.mockResolvedValueOnce(2);
    expect(await readWp4PayUniBuyerOrderProof(db as never, sourceSha)).toEqual({ status: "STATE_MISMATCH" });
  });

  it("rejects mismatched payment amounts, incomplete reservations, and missing orders", async () => {
    const { db, order } = fixture();
    db.commerceOrder.findMany.mockResolvedValueOnce([{ ...order, paidAmountCents: 100 }]);
    expect(await readWp4PayUniBuyerOrderProof(db as never, sourceSha)).toEqual({ status: "STATE_MISMATCH" });
    db.inventoryReservation.findMany.mockResolvedValueOnce([{ status: "reserved", productId: WP4_SANDBOX_FIXTURE.productId }]);
    expect(await readWp4PayUniBuyerOrderProof(db as never, sourceSha)).toEqual({ status: "STATE_MISMATCH" });
    db.commerceOrder.findMany.mockResolvedValueOnce([]);
    expect(await readWp4PayUniBuyerOrderProof(db as never, sourceSha)).toEqual({ status: "STATE_MISMATCH" });
  });

  it("requires the same callback event acknowledgement and unchanged persisted state", async () => {
    const { db } = fixture();
    const before = await readWp4PayUniBuyerOrderProof(db as never, sourceSha);
    const after = await readWp4PayUniBuyerOrderProof(db as never, sourceSha);
    const firstAck = { ok: true, eventId: "synthetic-event" };
    const replayAck = { ok: true, duplicate: true, eventId: "synthetic-event" };
    expect(verifyWp4PayUniDuplicateCallback(before, after, firstAck, replayAck)).toBe("VERIFIED");
    expect(verifyWp4PayUniDuplicateCallback(before, after, firstAck, { ...replayAck, eventId: "other-event" })).toBe("NOT_PROVEN");
    expect(verifyWp4PayUniDuplicateCallback(before, after, firstAck, { ...replayAck, duplicate: false })).toBe("NOT_PROVEN");
    expect(verifyWp4PayUniDuplicateCallback(before, { ...after, remainingInventory: 1 }, firstAck, replayAck)).toBe("NOT_PROVEN");
    expect(verifyWp4PayUniDuplicateCallback(before, { status: "STATE_MISMATCH" }, firstAck, replayAck)).toBe("NOT_PROVEN");
  });
});
