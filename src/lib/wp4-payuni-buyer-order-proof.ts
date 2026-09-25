import { Prisma, type PrismaClient } from "@prisma/client";
import { WP4_SANDBOX_FIXTURE } from "@/lib/wp4-sandbox-fixture";
import { wp4PayUniPurposeFromMetadata, wp4SourceCommitFromMetadata } from "@/lib/wp4-payuni-sandbox-reconciliation";

type ProofDb = Pick<PrismaClient, "$transaction">;
type SnapshotDb = Pick<Prisma.TransactionClient, "paymentTransaction" | "commerceOrder" | "commerceOrderEvent" | "inventoryReservation" | "product">;
const FIXED_AMOUNT_CENTS = 100;
const FIXED_CURRENCY = "TWD";

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

type SnapshotPayment = {
  status: string; orderNumber: string | null; checkoutIdempotencyKey: string | null;
  currency: string; grossAmountCents: number;
};
type SnapshotOrder = {
  status: string; orderNumber: string; checkoutIdempotencyKey: string; currency: string;
  subtotalAmountCents: number; totalAmountCents: number; paidAmountCents: number;
  items: Array<{ productId: string | null; lineIndex: number; commerceDomain: string;
    fulfillmentType: string; unitPriceCents: number; quantity: number; lineTotalCents: number }>;
};

function matchesFixedCommercialTerms(payment: SnapshotPayment, order: SnapshotOrder) {
  return payment.status === "paid" && order.status === "paid"
    && order.orderNumber === payment.orderNumber
    && typeof payment.checkoutIdempotencyKey === "string" && payment.checkoutIdempotencyKey.length > 0
    && order.checkoutIdempotencyKey === payment.checkoutIdempotencyKey
    && payment.currency === FIXED_CURRENCY && order.currency === FIXED_CURRENCY
    && payment.grossAmountCents === FIXED_AMOUNT_CENTS
    && order.subtotalAmountCents === FIXED_AMOUNT_CENTS
    && order.totalAmountCents === FIXED_AMOUNT_CENTS && order.paidAmountCents === FIXED_AMOUNT_CENTS;
}

function hasOnlyFixedSyntheticProduct(order: SnapshotOrder) {
  const item = order.items.length === 1 ? order.items[0] : null;
  return item?.productId === WP4_SANDBOX_FIXTURE.productId && item.lineIndex === 0
    && item.commerceDomain === "merchant" && item.fulfillmentType === "physical"
    && item.unitPriceCents === FIXED_AMOUNT_CENTS && item.quantity === 1
    && item.lineTotalCents === FIXED_AMOUNT_CENTS;
}

/** Every read shares one PostgreSQL repeatable-read snapshot. No IDs or PII leave this boundary. */
async function readSnapshot(tx: SnapshotDb, sourceSha: string): Promise<BuyerOrderProof> {
  const transactions = await tx.paymentTransaction.findMany({
    where: { vendorId: WP4_SANDBOX_FIXTURE.vendorId, providerName: "payuni" },
    select: { id: true, status: true, metadata: true, grossAmountCents: true, currency: true, orderNumber: true, checkoutIdempotencyKey: true },
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
    tx.commerceOrder.findMany({
      where: { vendorId: WP4_SANDBOX_FIXTURE.vendorId, primaryPaymentTransactionId: payment.id },
      select: {
        id: true, status: true, orderNumber: true, checkoutIdempotencyKey: true,
        currency: true, subtotalAmountCents: true, totalAmountCents: true, paidAmountCents: true,
        items: { select: { productId: true, lineIndex: true, commerceDomain: true, fulfillmentType: true,
          unitPriceCents: true, quantity: true, lineTotalCents: true } },
      },
    }),
    tx.inventoryReservation.findMany({
      where: { vendorId: WP4_SANDBOX_FIXTURE.vendorId, paymentTransactionId: payment.id },
      select: { status: true, productId: true, quantity: true },
    }),
    tx.product.findUnique({ where: { id: WP4_SANDBOX_FIXTURE.productId },
      select: { vendorId: true, priceCents: true, currency: true, commerceDomain: true, fulfillmentType: true, inventory: true } }),
  ]);
  if (orders.length !== 1 || reservations.length !== 1 || !product) return { status: "STATE_MISMATCH" };
  const order = orders[0]!;
  const reservation = reservations[0]!;
  const [paidEventCount, orderEventCount] = await Promise.all([
    tx.commerceOrderEvent.count({
      where: { vendorId: WP4_SANDBOX_FIXTURE.vendorId, orderId: order.id, eventType: "payment.paid" },
    }),
    tx.commerceOrderEvent.count({ where: { vendorId: WP4_SANDBOX_FIXTURE.vendorId, orderId: order.id } }),
  ]);
  if (!matchesFixedCommercialTerms(payment, order) || !hasOnlyFixedSyntheticProduct(order)
    || reservation.status !== "committed" || reservation.productId !== WP4_SANDBOX_FIXTURE.productId || reservation.quantity !== 1
    || paidEventCount !== 1 || !Number.isSafeInteger(orderEventCount) || orderEventCount < 1
    || product.vendorId !== WP4_SANDBOX_FIXTURE.vendorId || product.priceCents !== FIXED_AMOUNT_CENTS
    || product.currency !== FIXED_CURRENCY || product.commerceDomain !== "merchant" || product.fulfillmentType !== "physical"
    || !Number.isSafeInteger(product.inventory) || product.inventory < 0) {
    return { status: "STATE_MISMATCH" };
  }
  return {
    status: "VERIFIED", paymentStatus: "paid", orderStatus: "paid", orderCount: 1,
    paidEventCount: 1, orderEventCount, reservationStatus: "committed", remainingInventory: product.inventory,
  };
}

/** Read only the exact deployment-owned synthetic buyer transaction. */
export async function readWp4PayUniBuyerOrderProof(db: ProofDb, sourceSha: string): Promise<BuyerOrderProof> {
  return db.$transaction((tx) => readSnapshot(tx, sourceSha), {
    isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead,
  });
}
