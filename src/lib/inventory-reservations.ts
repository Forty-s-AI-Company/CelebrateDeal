import { Prisma, type PaymentTransaction } from "@prisma/client";
import {
  expireCommerceOrderForPayment,
  reconcileCommerceOrderPaymentTransition,
} from "@/lib/commerce-orders";
import { getDb } from "@/lib/db";

export const INVENTORY_RESERVATION_TTL_MS = 30 * 60 * 1000;

const MAX_SERIALIZABLE_ATTEMPTS = 3;

export class InventoryUnavailableError extends Error {
  constructor() {
    super("Product inventory is unavailable.");
    this.name = "InventoryUnavailableError";
  }
}

export class ProductChangedError extends Error {
  constructor() {
    super("Product changed while checkout was starting.");
    this.name = "ProductChangedError";
  }
}

export class CheckoutIdempotencyConflictError extends Error {
  constructor(public readonly transactionId: string) {
    super("Checkout idempotency key is already in use.");
    this.name = "CheckoutIdempotencyConflictError";
  }
}

function isSerializableConflict(error: unknown) {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2034";
}

function isUniqueConstraintConflict(error: unknown) {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}

async function runSerializable<T>(operation: (tx: Prisma.TransactionClient) => Promise<T>) {
  const db = getDb();
  for (let attempt = 1; attempt <= MAX_SERIALIZABLE_ATTEMPTS; attempt += 1) {
    try {
      return await db.$transaction(operation, {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
        // Production intentionally runs with a small serverless connection
        // pool. Concurrent checkout attempts should queue long enough to
        // resolve through the inventory invariant, not fail at pool admission.
        maxWait: 5_000,
        timeout: 10_000,
      });
    } catch (error) {
      if (!isSerializableConflict(error) || attempt === MAX_SERIALIZABLE_ATTEMPTS) throw error;
    }
  }

  throw new Error("Serializable inventory transaction attempts exhausted.");
}

export async function createReservedPaymentTransaction({
  vendorId,
  productId,
  expectedProductRevision,
  checkoutIdempotencyKey,
  transactionData,
  createCommerceOrder,
  now = new Date(),
}: {
  vendorId: string;
  productId: string;
  expectedProductRevision?: number;
  checkoutIdempotencyKey?: string;
  transactionData: Prisma.PaymentTransactionUncheckedCreateInput;
  /**
   * Optional canonical-order writer. It runs in the same serializable
   * transaction as stock reservation and payment creation, so none of the
   * three records can commit alone.
   */
  createCommerceOrder?: (
    tx: Prisma.TransactionClient,
    transaction: PaymentTransaction,
  ) => Promise<void>;
  now?: Date;
}) {
  try {
    return await runSerializable(async (tx) => {
      if (checkoutIdempotencyKey) {
        const existing = await tx.paymentTransaction.findUnique({
          where: { vendorId_checkoutIdempotencyKey: { vendorId, checkoutIdempotencyKey } },
          select: { id: true },
        });
        if (existing) throw new CheckoutIdempotencyConflictError(existing.id);
      }

      const reserved = await tx.product.updateMany({
        where: {
          id: productId,
          vendorId,
          isActive: true,
          inventory: { gte: 1 },
          ...(expectedProductRevision ? { revision: expectedProductRevision } : {}),
        },
        data: { inventory: { decrement: 1 }, revision: { increment: 1 } },
      });
      if (reserved.count !== 1) {
        if (expectedProductRevision) {
          const current = await tx.product.findFirst({ where: { id: productId, vendorId, isActive: true, inventory: { gte: 1 } }, select: { revision: true } });
          if (current && current.revision !== expectedProductRevision) throw new ProductChangedError();
        }
        throw new InventoryUnavailableError();
      }

      const transaction = await tx.paymentTransaction.create({ data: transactionData });
      if (createCommerceOrder) await createCommerceOrder(tx, transaction);
      await tx.inventoryReservation.create({
        data: {
          vendorId,
          productId,
          paymentTransactionId: transaction.id,
          quantity: 1,
          status: "reserved",
          expiresAt: new Date(now.getTime() + INVENTORY_RESERVATION_TTL_MS),
        },
      });
      return transaction;
    });
  } catch (error) {
    // The unique index is the authoritative race barrier. The failed
    // serializable transaction has already rolled back its stock decrement;
    // resolve the winner only after Prisma has closed that failed transaction.
    if (checkoutIdempotencyKey && isUniqueConstraintConflict(error)) {
      const existing = await getDb().paymentTransaction.findUnique({
        where: { vendorId_checkoutIdempotencyKey: { vendorId, checkoutIdempotencyKey } },
        select: { id: true },
      });
      if (existing) throw new CheckoutIdempotencyConflictError(existing.id);
    }
    throw error;
  }
}

async function releaseReservation(
  tx: Prisma.TransactionClient,
  reservation: {
    id: string;
    vendorId: string;
    productId: string;
    quantity: number;
    status: string;
  },
  reason: string,
  now: Date,
) {
  if (reservation.status !== "reserved" && reservation.status !== "committed") return false;

  const released = await tx.inventoryReservation.updateMany({
    where: { id: reservation.id, status: reservation.status },
    data: {
      status: "released",
      releasedAt: now,
      releaseReason: reason,
    },
  });
  if (released.count !== 1) return false;

  await tx.product.updateMany({
    where: { id: reservation.productId, vendorId: reservation.vendorId },
    data: { inventory: { increment: reservation.quantity }, revision: { increment: 1 } },
  });
  return true;
}

export async function failPendingCheckoutAndReleaseInventory({
  vendorId,
  transactionId,
  reason,
  now = new Date(),
}: {
  vendorId: string;
  transactionId: string;
  reason: "provider_checkout_failed" | "checkout_metadata_failed";
  now?: Date;
}) {
  return runSerializable(async (tx) => {
    const failed = await tx.paymentTransaction.updateMany({
      where: { id: transactionId, vendorId, status: "pending" },
      data: { status: "failed" },
    });
    if (failed.count !== 1) return false;

    await reconcileCommerceOrderPaymentTransition(tx, {
      vendorId,
      paymentTransactionId: transactionId,
      eventIdentity: reason,
      transition: "failed",
      occurredAt: now,
    });

    const reservation = await tx.inventoryReservation.findUnique({
      where: { paymentTransactionId: transactionId },
      select: { id: true, vendorId: true, productId: true, quantity: true, status: true },
    });
    if (!reservation || reservation.vendorId !== vendorId) return true;

    await releaseReservation(tx, reservation, reason, now);
    return true;
  });
}

function trustedProductId(metadata: unknown) {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return null;
  const productId = (metadata as Record<string, unknown>).productId;
  return typeof productId === "string" && productId.length > 0 ? productId : null;
}

export async function applyPaymentInventoryTransition(
  tx: Prisma.TransactionClient,
  {
    transaction,
    eventType,
    trustedCheckoutMetadata,
    now,
  }: {
    transaction: Pick<PaymentTransaction, "id" | "vendorId">;
    eventType: "paid" | "failed" | "refunded" | "partially_refunded";
    trustedCheckoutMetadata: unknown;
    now: Date;
  },
) {
  const reservation = await tx.inventoryReservation.findUnique({
    where: { paymentTransactionId: transaction.id },
    select: { id: true, vendorId: true, productId: true, quantity: true, status: true },
  });
  const productId = trustedProductId(trustedCheckoutMetadata);

  if (reservation && reservation.vendorId !== transaction.vendorId) {
    throw new Error("Inventory reservation tenant mismatch.");
  }
  if (reservation && productId && reservation.productId !== productId) {
    throw new Error("Inventory reservation product mismatch.");
  }

  if (eventType === "paid") {
    if (reservation?.status === "committed") return "already_committed" as const;
    if (reservation?.status === "reserved") {
      await tx.inventoryReservation.updateMany({
        where: { id: reservation.id, status: "reserved" },
        data: { status: "committed", committedAt: now, releasedAt: null, releaseReason: null },
      });
      return "committed" as const;
    }

    const resolvedProductId = reservation?.productId ?? productId;
    if (!resolvedProductId) return "not_tracked" as const;

    const reacquired = await tx.product.updateMany({
      where: {
        id: resolvedProductId,
        vendorId: transaction.vendorId,
        isActive: true,
        inventory: { gte: 1 },
      },
      data: { inventory: { decrement: 1 }, revision: { increment: 1 } },
    });
    if (reacquired.count !== 1) throw new InventoryUnavailableError();

    if (reservation) {
      const committed = await tx.inventoryReservation.updateMany({
        where: { id: reservation.id, status: "released" },
        data: { status: "committed", committedAt: now, releasedAt: null, releaseReason: null },
      });
      if (committed.count !== 1) throw new Error("Inventory reservation changed concurrently.");
    } else {
      await tx.inventoryReservation.create({
        data: {
          vendorId: transaction.vendorId,
          productId: resolvedProductId,
          paymentTransactionId: transaction.id,
          quantity: 1,
          status: "committed",
          expiresAt: now,
          committedAt: now,
        },
      });
    }
    return "committed" as const;
  }

  if (!reservation) return "not_tracked" as const;
  if (eventType === "failed") {
    if (reservation.status !== "reserved") return "unchanged" as const;
    return await releaseReservation(tx, reservation, "payment_failed", now)
      ? "released"
      : "unchanged";
  }
  if (eventType === "refunded") {
    return await releaseReservation(tx, reservation, "full_refund", now)
      ? "released"
      : "unchanged";
  }
  return "unchanged" as const;
}

export async function releaseExpiredInventoryReservations(limit = 100, now = new Date()) {
  const db = getDb();
  const candidates = await db.inventoryReservation.findMany({
    where: { status: "reserved", expiresAt: { lte: now } },
    orderBy: { expiresAt: "asc" },
    select: { id: true },
    take: limit,
  });
  let released = 0;
  let committed = 0;

  for (const candidate of candidates) {
    const outcome = await runSerializable(async (tx) => {
      const reservation = await tx.inventoryReservation.findUnique({
        where: { id: candidate.id },
        select: {
          id: true,
          vendorId: true,
          productId: true,
          paymentTransactionId: true,
          quantity: true,
          status: true,
          expiresAt: true,
        },
      });
      if (!reservation || reservation.status !== "reserved" || reservation.expiresAt > now) return "unchanged";

      const transaction = await tx.paymentTransaction.findUnique({
        where: { id: reservation.paymentTransactionId },
        select: { status: true },
      });
      if (transaction?.status === "paid") {
        const updated = await tx.inventoryReservation.updateMany({
          where: { id: reservation.id, status: "reserved" },
          data: { status: "committed", committedAt: now },
        });
        if (updated.count === 1) {
          await reconcileCommerceOrderPaymentTransition(tx, {
            vendorId: reservation.vendorId,
            paymentTransactionId: reservation.paymentTransactionId,
            eventIdentity: `inventory-expiry-reconcile:${reservation.id}`,
            transition: "paid",
            occurredAt: now,
          });
        }
        return updated.count === 1 ? "committed" : "unchanged";
      }

      const didRelease = await releaseReservation(tx, reservation, "expired", now);
      if (!didRelease) return "unchanged";
      const expired = await tx.paymentTransaction.updateMany({
        where: { id: reservation.paymentTransactionId, vendorId: reservation.vendorId, status: "pending" },
        data: { status: "expired" },
      });
      if (expired.count === 1) {
        await expireCommerceOrderForPayment(tx, {
          vendorId: reservation.vendorId,
          paymentTransactionId: reservation.paymentTransactionId,
          eventIdentity: `inventory-reservation:${reservation.id}`,
          occurredAt: now,
        });
      }
      return "released";
    });

    if (outcome === "released") released += 1;
    if (outcome === "committed") committed += 1;
  }

  return { examined: candidates.length, released, committed };
}
