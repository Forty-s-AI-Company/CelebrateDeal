import { randomBytes } from "node:crypto";

import { Prisma } from "@prisma/client";

/**
 * Server-generated merchant order numbers (PayUni `MerTradeNo`).
 *
 * Format: `CD-<UTC yymmdd>-<14 Crockford base32>` (24 chars), which satisfies
 * the PayUni adapter's `^[A-Za-z0-9_-]{1,25}$` contract. The random part
 * carries 70 bits from `crypto.randomBytes`; the database additionally
 * enforces `(providerName, orderNumber)` uniqueness (F-050／DB-I01), and a
 * creator that hits that index regenerates the number once.
 */
const CROCKFORD_BASE32 = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
export const PAYMENT_ORDER_NUMBER_RANDOM_LENGTH = 14;
export const PAYMENT_ORDER_NUMBER_PATTERN = /^CD-\d{6}-[0-9A-HJKMNP-TV-Z]{14}$/;

export function generatePaymentOrderNumber(now: Date = new Date()) {
  const stamp = now.toISOString().slice(2, 10).replace(/-/g, "");
  const bytes = randomBytes(PAYMENT_ORDER_NUMBER_RANDOM_LENGTH);
  let suffix = "";
  // 256 is a multiple of 32, so masking each byte keeps the alphabet uniform.
  for (const byte of bytes) suffix += CROCKFORD_BASE32[byte & 31];
  return `CD-${stamp}-${suffix}`;
}

/** P2002 raised by an order-number unique index (payment or commerce order). */
export function isPaymentOrderNumberConflict(error: unknown) {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== "P2002") return false;
  const target = (error.meta as { target?: unknown } | undefined)?.target;
  if (Array.isArray(target)) return target.some((field) => field === "orderNumber");
  return typeof target === "string" && target.includes("orderNumber");
}

/**
 * Runs a create operation with a fresh order number and retries exactly once
 * with a new number when the first one collided. The operation must be a
 * complete transaction, so the failed attempt has already rolled back.
 */
export async function withPaymentOrderNumberRetry<T>(
  operation: (orderNumber: string) => Promise<T>,
  generate: () => string = generatePaymentOrderNumber,
) {
  try {
    return await operation(generate());
  } catch (error) {
    if (!isPaymentOrderNumberConflict(error)) throw error;
    return await operation(generate());
  }
}
