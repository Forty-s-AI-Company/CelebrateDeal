import { afterEach, describe, expect, it } from "vitest";
import { Prisma } from "@prisma/client";
import { getDb } from "@/lib/db";
import {
  applyPaymentInventoryTransition,
  CheckoutIdempotencyConflictError,
  createReservedPaymentTransaction,
  failPendingCheckoutAndReleaseInventory,
  INVENTORY_RESERVATION_TTL_MS,
  InventoryUnavailableError,
  ProductChangedError,
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

async function createAdditionalProduct(
  db: ReturnType<typeof getDb>,
  vendorId: string,
  suffix: string,
  inventory = 2,
) {
  return db.product.create({
    data: {
      vendorId,
      name: `Inventory order bump ${suffix}`,
      slug: `inventory-order-bump-${suffix}`,
      priceCents: 600,
      inventory,
    },
  });
}

function transactionData(vendorId: string, productId: string, suffix: string, checkoutIdempotencyKey?: string) {
  return {
    vendorId,
    providerName: "demo",
    orderNumber: `INVENTORY-${suffix}`,
    grossAmountCents: 1200,
    netAmountCents: 1200,
    currency: "TWD",
    status: "pending",
    metadata: { productId },
    ...(checkoutIdempotencyKey ? { checkoutIdempotencyKey } : {}),
  };
}

afterEach(async () => {
  await getDb().vendor.deleteMany({ where: { id: { in: createdVendorIds.splice(0) } } });
});

describe("inventory reservations", () => {
  it("rejects a stale checkout snapshot without reserving stock", async () => {
    const { db, vendor, product, suffix } = await createFixture(2);
    await db.product.update({ where: { id: product.id }, data: { priceCents: 1_500, revision: { increment: 1 } } });
    await expect(createReservedPaymentTransaction({
      vendorId: vendor.id,
      productId: product.id,
      expectedProductRevision: product.revision,
      transactionData: transactionData(vendor.id, product.id, suffix),
    })).rejects.toBeInstanceOf(ProductChangedError);
    expect(await db.product.findUniqueOrThrow({ where: { id: product.id } })).toMatchObject({ inventory: 2, revision: 2, priceCents: 1_500 });
    expect(await db.paymentTransaction.count({ where: { vendorId: vendor.id } })).toBe(0);
  });

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

    expect(await db.product.findUniqueOrThrow({ where: { id: product.id } })).toMatchObject({ inventory: 1, revision: 2 });
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
    expect(await db.product.findUniqueOrThrow({ where: { id: product.id } })).toMatchObject({ inventory: 0, revision: 2 });
    expect(await db.inventoryReservation.count({ where: { productId: product.id } })).toBe(1);
  });

  it("atomically reserves and snapshots primary plus server-resolved order-bump stock", async () => {
    const { db, vendor, product, suffix } = await createFixture(2);
    const orderBump = await createAdditionalProduct(db, vendor.id, suffix, 2);
    const transaction = await createReservedPaymentTransaction({
      vendorId: vendor.id,
      productId: product.id,
      expectedProductRevision: product.revision,
      additionalProducts: [{ productId: orderBump.id, expectedProductRevision: orderBump.revision }],
      transactionData: transactionData(vendor.id, product.id, suffix),
    });

    expect(await db.product.findUniqueOrThrow({ where: { id: product.id } })).toMatchObject({ inventory: 1, revision: 2 });
    expect(await db.product.findUniqueOrThrow({ where: { id: orderBump.id } })).toMatchObject({ inventory: 1, revision: 2 });
    expect(await db.inventoryReservation.findUniqueOrThrow({ where: { paymentTransactionId: transaction.id } }))
      .toMatchObject({
        productId: product.id,
        status: "reserved",
        items: [{ productId: product.id, quantity: 1 }, { productId: orderBump.id, quantity: 1 }],
      });

    await failPendingCheckoutAndReleaseInventory({
      vendorId: vendor.id,
      transactionId: transaction.id,
      reason: "provider_checkout_failed",
    });
    expect(await db.product.findUniqueOrThrow({ where: { id: product.id } })).toMatchObject({ inventory: 2, revision: 3 });
    expect(await db.product.findUniqueOrThrow({ where: { id: orderBump.id } })).toMatchObject({ inventory: 2, revision: 3 });
  });

  it("rolls back the primary reservation when an order-bump reservation cannot be acquired", async () => {
    const { db, vendor, product, suffix } = await createFixture(2);
    const unavailableOrderBump = await createAdditionalProduct(db, vendor.id, suffix, 0);

    await expect(createReservedPaymentTransaction({
      vendorId: vendor.id,
      productId: product.id,
      additionalProducts: [{ productId: unavailableOrderBump.id, expectedProductRevision: unavailableOrderBump.revision }],
      transactionData: transactionData(vendor.id, product.id, suffix),
    })).rejects.toBeInstanceOf(InventoryUnavailableError);

    expect(await db.product.findUniqueOrThrow({ where: { id: product.id } })).toMatchObject({ inventory: 2, revision: 1 });
    expect(await db.product.findUniqueOrThrow({ where: { id: unavailableOrderBump.id } })).toMatchObject({ inventory: 0, revision: 1 });
    expect(await db.paymentTransaction.count({ where: { vendorId: vendor.id } })).toBe(0);
    expect(await db.inventoryReservation.count({ where: { vendorId: vendor.id } })).toBe(0);
  });

  it("rejects a stale order-bump revision without reserving the primary product", async () => {
    const { db, vendor, product, suffix } = await createFixture(2);
    const orderBump = await createAdditionalProduct(db, vendor.id, suffix, 2);
    await db.product.update({ where: { id: orderBump.id }, data: { revision: { increment: 1 } } });

    await expect(createReservedPaymentTransaction({
      vendorId: vendor.id,
      productId: product.id,
      additionalProducts: [{ productId: orderBump.id, expectedProductRevision: orderBump.revision }],
      transactionData: transactionData(vendor.id, product.id, suffix),
    })).rejects.toBeInstanceOf(ProductChangedError);

    expect(await db.product.findUniqueOrThrow({ where: { id: product.id } })).toMatchObject({ inventory: 2, revision: 1 });
    expect(await db.product.findUniqueOrThrow({ where: { id: orderBump.id } })).toMatchObject({ inventory: 2, revision: 2 });
  });

  it("allows only one concurrent bundle to consume a shared order-bump unit and rolls the losing primary back", async () => {
    const { db, vendor, product: primaryA, suffix } = await createFixture(1);
    const primaryB = await createAdditionalProduct(db, vendor.id, `${suffix}-primary-b`, 1);
    const sharedOrderBump = await createAdditionalProduct(db, vendor.id, `${suffix}-shared`, 1);
    const attempts = await Promise.allSettled([
      createReservedPaymentTransaction({
        vendorId: vendor.id,
        productId: primaryA.id,
        additionalProducts: [{ productId: sharedOrderBump.id, expectedProductRevision: sharedOrderBump.revision }],
        transactionData: transactionData(vendor.id, primaryA.id, `${suffix}-a`),
      }),
      createReservedPaymentTransaction({
        vendorId: vendor.id,
        productId: primaryB.id,
        additionalProducts: [{ productId: sharedOrderBump.id, expectedProductRevision: sharedOrderBump.revision }],
        transactionData: transactionData(vendor.id, primaryB.id, `${suffix}-b`),
      }),
    ]);

    expect(attempts.filter((attempt) => attempt.status === "fulfilled")).toHaveLength(1);
    expect(attempts.find((attempt) => attempt.status === "rejected"))
      .toMatchObject({ status: "rejected", reason: expect.any(InventoryUnavailableError) });
    expect(await db.product.findUniqueOrThrow({ where: { id: sharedOrderBump.id } })).toMatchObject({ inventory: 0 });
    const primaryInventories = await Promise.all([primaryA.id, primaryB.id].map(async (id) => (await db.product.findUniqueOrThrow({ where: { id } })).inventory));
    expect(primaryInventories.sort()).toEqual([0, 1]);
    expect(await db.paymentTransaction.count({ where: { vendorId: vendor.id } })).toBe(1);
  });

  it("reacquires every snapped item once when a late paid notification follows expiry", async () => {
    const { db, vendor, product, suffix } = await createFixture(2);
    const orderBump = await createAdditionalProduct(db, vendor.id, suffix, 2);
    const createdAt = new Date("2026-09-17T00:00:00.000Z");
    const transaction = await createReservedPaymentTransaction({
      vendorId: vendor.id,
      productId: product.id,
      additionalProducts: [{ productId: orderBump.id, expectedProductRevision: orderBump.revision }],
      transactionData: transactionData(vendor.id, product.id, suffix),
      now: createdAt,
    });
    const afterExpiry = new Date(createdAt.getTime() + INVENTORY_RESERVATION_TTL_MS + 1);
    await releaseExpiredInventoryReservations(100, afterExpiry);
    const paidTransaction = await db.paymentTransaction.update({
      where: { id: transaction.id },
      data: { status: "paid" },
    });

    await db.$transaction((tx) => applyPaymentInventoryTransition(tx, {
      transaction: paidTransaction,
      eventType: "paid",
      trustedCheckoutMetadata: { productId: product.id },
      now: afterExpiry,
    }));
    await db.$transaction((tx) => applyPaymentInventoryTransition(tx, {
      transaction: paidTransaction,
      eventType: "paid",
      trustedCheckoutMetadata: { productId: product.id },
      now: afterExpiry,
    }));

    expect(await db.product.findUniqueOrThrow({ where: { id: product.id } })).toMatchObject({ inventory: 1, revision: 4 });
    expect(await db.product.findUniqueOrThrow({ where: { id: orderBump.id } })).toMatchObject({ inventory: 1, revision: 4 });
    expect(await db.inventoryReservation.findUniqueOrThrow({ where: { paymentTransactionId: transaction.id } }))
      .toMatchObject({ status: "committed" });
  });

  it("keeps a legacy null snapshot limited to its primary product", async () => {
    const { db, vendor, product, suffix } = await createFixture(2);
    const historicalOrderBump = await createAdditionalProduct(db, vendor.id, `${suffix}-legacy`, 0);
    const transaction = await db.$transaction(async (tx) => {
      await tx.product.update({ where: { id: product.id }, data: { inventory: { decrement: 1 }, revision: { increment: 1 } } });
      const payment = await tx.paymentTransaction.create({
        data: { ...transactionData(vendor.id, product.id, suffix), metadata: { productId: product.id, orderBumpProductId: historicalOrderBump.id } },
      });
      await tx.inventoryReservation.create({
        data: {
          vendorId: vendor.id,
          productId: product.id,
          paymentTransactionId: payment.id,
          quantity: 1,
          items: Prisma.DbNull,
          status: "committed",
          expiresAt: new Date(),
          committedAt: new Date(),
        },
      });
      return payment;
    });

    await db.$transaction((tx) => applyPaymentInventoryTransition(tx, {
      transaction,
      eventType: "refunded",
      trustedCheckoutMetadata: { productId: product.id },
      now: new Date(),
    }));

    expect(await db.product.findUniqueOrThrow({ where: { id: product.id } })).toMatchObject({ inventory: 2, revision: 3 });
    expect(await db.product.findUniqueOrThrow({ where: { id: historicalOrderBump.id } })).toMatchObject({ inventory: 0, revision: 1 });
    expect(await db.inventoryReservation.findUniqueOrThrow({ where: { paymentTransactionId: transaction.id } }))
      .toMatchObject({ status: "released", items: null, releaseReason: "full_refund" });
  });

  it("allows only one concurrent transaction for the same checkout idempotency key", async () => {
    const { db, vendor, product, suffix } = await createFixture(2);
    const checkoutIdempotencyKey = `same-checkout-${suffix}`;
    const attempts = await Promise.allSettled([
      createReservedPaymentTransaction({
        vendorId: vendor.id,
        productId: product.id,
        checkoutIdempotencyKey,
        transactionData: transactionData(vendor.id, product.id, `${suffix}-a`, checkoutIdempotencyKey),
      }),
      createReservedPaymentTransaction({
        vendorId: vendor.id,
        productId: product.id,
        checkoutIdempotencyKey,
        transactionData: transactionData(vendor.id, product.id, `${suffix}-b`, checkoutIdempotencyKey),
      }),
    ]);

    expect(attempts.filter((attempt) => attempt.status === "fulfilled")).toHaveLength(1);
    const rejected = attempts.find((attempt) => attempt.status === "rejected");
    expect(rejected).toMatchObject({
      status: "rejected",
      reason: expect.any(CheckoutIdempotencyConflictError),
    });
    expect(await db.product.findUniqueOrThrow({ where: { id: product.id } })).toMatchObject({ inventory: 1, revision: 2 });
    expect(await db.paymentTransaction.count({ where: { vendorId: vendor.id, checkoutIdempotencyKey } })).toBe(1);
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

    expect(await db.product.findUniqueOrThrow({ where: { id: product.id } })).toMatchObject({ inventory: 2, revision: 3 });
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

    expect(await db.product.findUniqueOrThrow({ where: { id: product.id } })).toMatchObject({ inventory: 2, revision: 3 });
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
    expect(await db.product.findUniqueOrThrow({ where: { id: product.id } })).toMatchObject({ inventory: 2, revision: 3 });
    expect(await db.paymentTransaction.findUniqueOrThrow({ where: { id: transaction.id } })).toMatchObject({ status: "expired" });
    expect(await db.inventoryReservation.findUniqueOrThrow({
      where: { paymentTransactionId: transaction.id },
    })).toMatchObject({ status: "released", releaseReason: "expired" });
  });
});
