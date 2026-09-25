import type { PrismaClient } from "@prisma/client";
import { WP4_SANDBOX_FIXTURE } from "@/lib/wp4-sandbox-fixture";
import { wp4PayUniPurposeFromMetadata, wp4SourceCommitFromMetadata } from "@/lib/wp4-payuni-sandbox-reconciliation";

type ProofDb = Pick<PrismaClient, "paymentTransaction" | "commerceOrder" | "commerceOrderEvent" | "inventoryReservation" | "product">;

export type BuyerOrderProof =
  | { status: "FIXTURE_UNAVAILABLE" | "CANDIDATE_AMBIGUOUS" | "STATE_MISMATCH" }
  | {
      status: "VERIFIED";
      paymentStatus: "paid";
      orderStatus: "paid";
      orderCount: 1;
      paidEventCount: 1;
      orderEventCount: number;
      reservationStatus: "committed";
      remainingInventory: number;
    };

/** Read only the exact deployment-owned synthetic buyer transaction. No IDs or PII leave this boundary. */
export async function readWp4PayUniBuyerOrderProof(db: ProofDb, sourceSha: string): Promise<BuyerOrderProof> {
  const transactions = await db.paymentTransaction.findMany({
    where: { vendorId: WP4_SANDBOX_FIXTURE.vendorId, providerName: "payuni" },
    select: { id: true, status: true, metadata: true, grossAmountCents: true, orderNumber: true },
  });
  const candidates = transactions.filter((row) =>
    wp4SourceCommitFromMetadata(row.metadata) === sourceSha
    && wp4PayUniPurposeFromMetadata(row.metadata) === "buyer_order"
    && row.metadata !== null
    && typeof row.metadata === "object"
    && !Array.isArray(row.metadata)
    && row.metadata.productId === WP4_SANDBOX_FIXTURE.productId,
  );
  if (candidates.length === 0) return { status: "FIXTURE_UNAVAILABLE" };
  if (candidates.length !== 1) return { status: "CANDIDATE_AMBIGUOUS" };
  const payment = candidates[0]!;
  const [orders, reservations, product] = await Promise.all([
    db.commerceOrder.findMany({
      where: { vendorId: WP4_SANDBOX_FIXTURE.vendorId, primaryPaymentTransactionId: payment.id },
      select: { id: true, status: true, orderNumber: true, totalAmountCents: true, paidAmountCents: true },
    }),
    db.inventoryReservation.findMany({
      where: { vendorId: WP4_SANDBOX_FIXTURE.vendorId, paymentTransactionId: payment.id },
      select: { status: true, productId: true },
    }),
    db.product.findUnique({ where: { id: WP4_SANDBOX_FIXTURE.productId }, select: { inventory: true } }),
  ]);
  if (orders.length !== 1 || reservations.length !== 1 || !product) return { status: "STATE_MISMATCH" };
  const order = orders[0]!;
  const reservation = reservations[0]!;
  const [paidEventCount, orderEventCount] = await Promise.all([
    db.commerceOrderEvent.count({
      where: { vendorId: WP4_SANDBOX_FIXTURE.vendorId, orderId: order.id, eventType: "payment.paid" },
    }),
    db.commerceOrderEvent.count({ where: { vendorId: WP4_SANDBOX_FIXTURE.vendorId, orderId: order.id } }),
  ]);
  if (payment.status !== "paid" || order.status !== "paid" || order.orderNumber !== payment.orderNumber
    || order.totalAmountCents !== payment.grossAmountCents || order.paidAmountCents !== payment.grossAmountCents
    || reservation.status !== "committed" || reservation.productId !== WP4_SANDBOX_FIXTURE.productId
    || paidEventCount !== 1 || !Number.isSafeInteger(orderEventCount) || orderEventCount < 1
    || !Number.isSafeInteger(product.inventory) || product.inventory < 0) {
    return { status: "STATE_MISMATCH" };
  }
  return {
    status: "VERIFIED", paymentStatus: "paid", orderStatus: "paid", orderCount: 1,
    paidEventCount: 1, orderEventCount, reservationStatus: "committed", remainingInventory: product.inventory,
  };
}
