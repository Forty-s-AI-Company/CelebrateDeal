import { afterEach, describe, expect, it } from "vitest";
import { getDb } from "@/lib/db";
import {
  applyPaymentInventoryTransition,
  createReservedPaymentTransaction,
  failPendingCheckoutAndReleaseInventory,
  INVENTORY_RESERVATION_TTL_MS,
  InventoryUnavailableError,
  releaseExpiredInventoryReservations,
} from "@/lib/inventory-reservations";

const createdVendorIds: string[] = [];

async function createFixture(inventory = 2) {
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  const db = getDb();
  const vendor = await db.vendor.create({
    data: {
      name: `Inventory Vendor ${suffix}`,
      slug: `inventory-vendor-${suffix}`,
      email: `inventory-${suffix}@example.test`,
      passwordHash: "test",
    },
  });
  createdVendorIds.push(vendor.id);
  const product = await db.product.create({
    data: {
      vendorId: vendor.id,
      name: `Inventory Product ${suffix}`,
      slug: `inventory-product-${suffix}`,
      priceCents: 1200,
      inventory,
    },
  });
  return { db, vendor, product, suffix };
}

function transactionData(vendorId: string, productId: string, suffix: string) {
  return {
    vendorId,
    providerName: "demo",
    orderNumber: `INVENTORY-${suffix}`,
    grossAmountCents: 1200,
    netAmountCents: 1200,
    currency: "TWD",
    status: "pending",
    metadata: { productId },
  };
}

afterEach(async () => {
  await getDb().vendor.deleteMany({ where: { id: { in: createdVendorIds.splice(0) } } });
});

describe("inventory reservations", () => {
  it("reserves stock atomically and commits a paid transaction only once", async () => {
    const { db, vendor, product, suffix } = await createFixture();
    const transaction = await createReservedPaymentTransaction({
      vendorId: vendor.id,
      productId: product.id,
      transactionData: transactionData(vendor.id, product.id, suffix),
    });

    const applyPaid = () => db.$transaction((tx) => applyPaymentInventoryTransition(tx, {
      transaction,
      eventType: "paid",
      trustedCheckoutMetadata: { productId: product.id },
      now: new Date(),
    }));
    await applyPaid();
    await applyPaid();

    expect(await db.product.findUniqueOrThrow({ where: { id: product.id } })).toMatchObject({ inventory: 1 });
    expect(await db.inventoryReservation.findUniqueOrThrow({
      where: { paymentTransactionId: transaction.id },
    })).toMatchObject({ status: "committed", quantity: 1 });
  });

  it("allows only one concurrent checkout to reserve the final unit", async () => {
    const { db, vendor, product, suffix } = await createFixture(1);
    const attempts = await Promise.allSettled([
      createReservedPaymentTransaction({
        vendorId: vendor.id,
        productId: product.id,
        transactionData: transactionData(vendor.id, product.id, `${suffix}-a`),
      }),
      createReservedPaymentTransaction({
        vendorId: vendor.id,
        productId: product.id,
        transactionData: transactionData(vendor.id, product.id, `${suffix}-b`),
      }),
    ]);

    expect(attempts.filter((attempt) => attempt.status === "fulfilled")).toHaveLength(1);
    const rejected = attempts.find((attempt) => attempt.status === "rejected");
    expect(rejected).toMatchObject({ status: "rejected", reason: expect.any(InventoryUnavailableError) });
    expect(await db.product.findUniqueOrThrow({ where: { id: product.id } })).toMatchObject({ inventory: 0 });
    expect(await db.inventoryReservation.count({ where: { productId: product.id } })).toBe(1);
  });

  it("releases stock once when checkout setup fails", async () => {
    const { db, vendor, product, suffix } = await createFixture();
    const transaction = await createReservedPaymentTransaction({
      vendorId: vendor.id,
      productId: product.id,
      transactionData: transactionData(vendor.id, product.id, suffix),
    });

    await failPendingCheckoutAndReleaseInventory({
      vendorId: vendor.id,
      transactionId: transaction.id,
      reason: "provider_checkout_failed",
    });
    await failPendingCheckoutAndReleaseInventory({
      vendorId: vendor.id,
      transactionId: transaction.id,
      reason: "provider_checkout_failed",
    });

    expect(await db.product.findUniqueOrThrow({ where: { id: product.id } })).toMatchObject({ inventory: 2 });
    expect(await db.paymentTransaction.findUniqueOrThrow({ where: { id: transaction.id } })).toMatchObject({ status: "failed" });
    expect(await db.inventoryReservation.findUniqueOrThrow({
      where: { paymentTransactionId: transaction.id },
    })).toMatchObject({ status: "released", releaseReason: "provider_checkout_failed" });
  });

  it("restocks only once after a full refund and ignores partial refunds", async () => {
    const { db, vendor, product, suffix } = await createFixture();
    const transaction = await createReservedPaymentTransaction({
      vendorId: vendor.id,
      productId: product.id,
      transactionData: transactionData(vendor.id, product.id, suffix),
    });

    await db.$transaction((tx) => applyPaymentInventoryTransition(tx, {
      transaction,
      eventType: "paid",
      trustedCheckoutMetadata: { productId: product.id },
      now: new Date(),
    }));
    await db.$transaction((tx) => applyPaymentInventoryTransition(tx, {
      transaction,
      eventType: "partially_refunded",
      trustedCheckoutMetadata: { productId: product.id },
      now: new Date(),
    }));
    await db.$transaction((tx) => applyPaymentInventoryTransition(tx, {
      transaction,
      eventType: "refunded",
      trustedCheckoutMetadata: { productId: product.id },
      now: new Date(),
    }));
    await db.$transaction((tx) => applyPaymentInventoryTransition(tx, {
      transaction,
      eventType: "refunded",
      trustedCheckoutMetadata: { productId: product.id },
      now: new Date(),
    }));

    expect(await db.product.findUniqueOrThrow({ where: { id: product.id } })).toMatchObject({ inventory: 2 });
    expect(await db.inventoryReservation.findUniqueOrThrow({
      where: { paymentTransactionId: transaction.id },
    })).toMatchObject({ status: "released", releaseReason: "full_refund" });
  });

  it("releases expired pending reservations without touching committed sales", async () => {
    const { db, vendor, product, suffix } = await createFixture();
    const createdAt = new Date("2026-07-21T00:00:00.000Z");
    const transaction = await createReservedPaymentTransaction({
      vendorId: vendor.id,
      productId: product.id,
      transactionData: transactionData(vendor.id, product.id, suffix),
      now: createdAt,
    });

    const result = await releaseExpiredInventoryReservations(
      100,
      new Date(createdAt.getTime() + INVENTORY_RESERVATION_TTL_MS + 1),
    );

    expect(result.released).toBeGreaterThanOrEqual(1);
    expect(await db.product.findUniqueOrThrow({ where: { id: product.id } })).toMatchObject({ inventory: 2 });
    expect(await db.paymentTransaction.findUniqueOrThrow({ where: { id: transaction.id } })).toMatchObject({ status: "expired" });
    expect(await db.inventoryReservation.findUniqueOrThrow({
      where: { paymentTransactionId: transaction.id },
    })).toMatchObject({ status: "released", releaseReason: "expired" });
  });
});
