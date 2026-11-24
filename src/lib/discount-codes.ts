import type { Prisma, PrismaClient } from "@prisma/client";
import { z } from "zod";

import { PAYUNI_MIN_TRADE_AMOUNT } from "@/lib/payment-providers/payuni-amount";

/**
 * A4-01 (owner 2026-11-23): merchant-wide discount codes typed by the buyer.
 *
 * Rules (also in docs/domain-workflows.md, 折扣碼):
 * - The discount comes only from the `DiscountCode` row. It applies to the
 *   primary product line; an order bump keeps its own price. The minimum
 *   order subtotal is checked against primary + order bump.
 * - The buyer always pays at least {@link DISCOUNT_CODE_MIN_PAYABLE_CENTS}
 *   (PayUni's NT$1 minimum) for the primary product, and TWD discounts are
 *   whole dollars.
 * - One promotion per order: a code cannot be combined with a flash sale or a
 *   post-purchase credit (refused), and an entered code takes the place of an
 *   automation or live voucher (the voucher is not consumed and stays usable).
 * - A use is reserved with the order (conditional update, so concurrent
 *   checkouts cannot exceed the limits), confirmed when paid, released when
 *   the payment fails or expires unpaid. Refunds never give a use back.
 */

export const DISCOUNT_CODE_TYPES = ["fixed_amount", "percentage"] as const;
export type DiscountCodeType = (typeof DISCOUNT_CODE_TYPES)[number];

/** PayUni charges whole TWD units, at least NT$1. */
export const DISCOUNT_CODE_MIN_PAYABLE_CENTS = PAYUNI_MIN_TRADE_AMOUNT * 100;
export const DISCOUNT_CODE_MAX_FIXED_CENTS = 100_000_000;

const ENTERED_CODE = /^[A-Za-z0-9_-]{6,32}$/u;

/** Case-insensitive form used for storage and lookup; null when malformed. */
export function normalizeDiscountCode(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return ENTERED_CODE.test(trimmed) ? trimmed.toUpperCase() : null;
}

export const DiscountCodeInputSchema = z.string().trim().min(6).max(32).regex(ENTERED_CODE);

/** Discount on the primary product line, never leaving less than the minimum payable amount. */
export function calculateDiscountCodeAmount(input: {
  discountType: string;
  discountValue: number;
  primaryPriceCents: number;
  currency: string;
}) {
  const { discountType, discountValue, primaryPriceCents, currency } = input;
  if (!Number.isSafeInteger(primaryPriceCents) || primaryPriceCents <= 0) return 0;
  if (!Number.isSafeInteger(discountValue) || discountValue <= 0) return 0;
  let raw: number;
  if (discountType === "percentage") {
    if (discountValue > 100) return 0;
    raw = Math.floor(primaryPriceCents * discountValue / 100);
  } else if (discountType === "fixed_amount") {
    raw = discountValue;
  } else {
    return 0;
  }
  const bounded = Math.max(0, Math.min(raw, primaryPriceCents - DISCOUNT_CODE_MIN_PAYABLE_CENTS));
  return currency === "TWD" ? Math.floor(bounded / 100) * 100 : bounded;
}

export type DiscountCodeRejection =
  /** Unknown, another vendor's, inactive, outside its period, wrong product or currency. Never says which. */
  | "invalid"
  | "min_subtotal_not_met"
  | "usage_limit_reached"
  | "buyer_limit_reached"
  /** Combined with a flash sale or a post-purchase credit. */
  | "not_combinable"
  /** The code was edited, or the buyer's expected discount no longer matches. */
  | "changed";

export class DiscountCodeUnavailableError extends Error {
  constructor(readonly reason: DiscountCodeRejection) {
    super(`Discount code unavailable: ${reason}`);
    this.name = "DiscountCodeUnavailableError";
  }
}

/**
 * Buyer-facing error codes; the same text for every tenant-boundary failure.
 * The per-buyer limit answers exactly like the total limit (review m-2), so a
 * response never confirms that an e-mail already used the code; the server
 * still logs the two apart ({@link logDiscountCodeRefusal}).
 */
export const DISCOUNT_CODE_ERROR_CODES: Record<DiscountCodeRejection, string> = {
  invalid: "DISCOUNT_CODE_INVALID",
  min_subtotal_not_met: "DISCOUNT_CODE_MIN_SUBTOTAL",
  usage_limit_reached: "DISCOUNT_CODE_USAGE_LIMIT",
  buyer_limit_reached: "DISCOUNT_CODE_USAGE_LIMIT",
  not_combinable: "DISCOUNT_CODE_NOT_COMBINABLE",
  changed: "DISCOUNT_CODE_CHANGED",
};

export const DISCOUNT_CODE_TRY_LATER = "DISCOUNT_CODE_TRY_LATER";

/** Body and headers of the same 429 that preview and checkout send while a product's lookups are throttled. */
export function discountCodeTryLaterReply(retryAfterSeconds: number) {
  return {
    body: { error: "Too many discount code attempts", code: DISCOUNT_CODE_TRY_LATER },
    init: { status: 429, headers: { "Cache-Control": "private, no-store", "Retry-After": String(retryAfterSeconds) } },
  };
}

/** Server-side record of why a code was refused; ids only, never a code or an e-mail. */
export function logDiscountCodeRefusal(reason: DiscountCodeRejection, scope: { vendorId: string; productId?: string; discountCodeId?: string }) {
  console.warn("discount_code_refused", { reason, ...scope });
}

export type DiscountCodeRecord = {
  id: string;
  vendorId: string;
  code: string;
  normalizedCode: string;
  discountType: string;
  discountValue: number;
  currency: string;
  appliesToAllProducts: boolean;
  startsAt: Date | null;
  endsAt: Date | null;
  maxRedemptions: number | null;
  maxRedemptionsPerBuyer: number | null;
  minSubtotalCents: number | null;
  isActive: boolean;
  redemptionCount: number;
  revision: number;
  /** Only the requested product's link (if any) is loaded. */
  products: ReadonlyArray<{ productId: string }>;
};

export type DiscountCodeQuote = {
  discountCodeId: string;
  vendorId: string;
  code: string;
  normalizedCode: string;
  discountType: DiscountCodeType;
  discountValue: number;
  revision: number;
  maxRedemptionsPerBuyer: number | null;
  currency: string;
  subtotalAmountCents: number;
  discountAmountCents: number;
  totalAmountCents: number;
};

export type DiscountCodeEvaluation =
  | { ok: true; quote: DiscountCodeQuote }
  | { ok: false; reason: DiscountCodeRejection };

export type DiscountCodeCheckoutContext = {
  vendorId: string;
  productId: string;
  primaryPriceCents: number;
  /** Order-bump price (no discount applies to it). */
  additionalAmountCents: number;
  currency: string;
  now: Date;
};

/** Pure eligibility check of a loaded row; tenant scope is part of the rule. */
export function evaluateDiscountCode(row: DiscountCodeRecord | null, context: DiscountCodeCheckoutContext): DiscountCodeEvaluation {
  if (
    !row
    || row.vendorId !== context.vendorId
    || !row.isActive
    || row.currency !== context.currency
    || (row.startsAt && row.startsAt > context.now)
    || (row.endsAt && row.endsAt <= context.now)
    || (!row.appliesToAllProducts && !row.products.some((link) => link.productId === context.productId))
    || !(DISCOUNT_CODE_TYPES as readonly string[]).includes(row.discountType)
  ) return { ok: false, reason: "invalid" };
  const subtotalAmountCents = context.primaryPriceCents + context.additionalAmountCents;
  if (row.minSubtotalCents !== null && subtotalAmountCents < row.minSubtotalCents) return { ok: false, reason: "min_subtotal_not_met" };
  if (row.maxRedemptions !== null && row.redemptionCount >= row.maxRedemptions) return { ok: false, reason: "usage_limit_reached" };
  const discountAmountCents = calculateDiscountCodeAmount({
    discountType: row.discountType,
    discountValue: row.discountValue,
    primaryPriceCents: context.primaryPriceCents,
    currency: context.currency,
  });
  if (discountAmountCents <= 0) return { ok: false, reason: "invalid" };
  return {
    ok: true,
    quote: {
      discountCodeId: row.id,
      vendorId: row.vendorId,
      code: row.code,
      normalizedCode: row.normalizedCode,
      discountType: row.discountType as DiscountCodeType,
      discountValue: row.discountValue,
      revision: row.revision,
      maxRedemptionsPerBuyer: row.maxRedemptionsPerBuyer,
      currency: row.currency,
      subtotalAmountCents,
      discountAmountCents,
      totalAmountCents: subtotalAmountCents - discountAmountCents,
    },
  };
}

type QuoteDb = Pick<PrismaClient | Prisma.TransactionClient, "discountCode">;

/**
 * Looks the code up only inside `context.vendorId` (the vendor of the product
 * being bought). Another vendor's code is indistinguishable from an unknown one.
 */
export async function resolveDiscountCodeQuote(
  db: QuoteDb,
  enteredCode: unknown,
  context: DiscountCodeCheckoutContext,
): Promise<DiscountCodeEvaluation> {
  const normalizedCode = normalizeDiscountCode(enteredCode);
  if (!normalizedCode) return { ok: false, reason: "invalid" };
  const row = await db.discountCode.findUnique({
    where: { vendorId_normalizedCode: { vendorId: context.vendorId, normalizedCode } },
    include: { products: { where: { vendorId: context.vendorId, productId: context.productId }, select: { productId: true } } },
  });
  return evaluateDiscountCode(row, context);
}

/**
 * Whether the vendor has a code that could apply to this product now, so the
 * checkout page shows the input. Display only; it never reveals a code.
 */
export async function vendorHasApplicableDiscountCode(db: QuoteDb, input: { vendorId: string; productId: string; now: Date }) {
  const found = await db.discountCode.findFirst({
    where: {
      vendorId: input.vendorId,
      isActive: true,
      AND: [
        { OR: [{ startsAt: null }, { startsAt: { lte: input.now } }] },
        { OR: [{ endsAt: null }, { endsAt: { gt: input.now } }] },
        { OR: [{ appliesToAllProducts: true }, { products: { some: { vendorId: input.vendorId, productId: input.productId } } }] },
      ],
    },
    select: { id: true },
  });
  return Boolean(found);
}

type ReserveDb = Pick<Prisma.TransactionClient, "discountCode" | "discountCodeRedemption">;

/**
 * Reserves one use inside the checkout's Serializable transaction. The
 * conditional increment (same revision, still active and in period, below the
 * total limit) and the per-buyer count run before the redemption row is
 * written; any refusal throws and rolls the whole order back.
 */
export async function reserveDiscountCodeRedemption(tx: ReserveDb, input: {
  quote: DiscountCodeQuote;
  orderId: string;
  paymentTransactionId: string;
  buyerKeyHash: string;
  now: Date;
}) {
  const { quote, now } = input;
  const reserved = await tx.discountCode.updateMany({
    where: {
      id: quote.discountCodeId,
      vendorId: quote.vendorId,
      revision: quote.revision,
      isActive: true,
      AND: [
        { OR: [{ startsAt: null }, { startsAt: { lte: now } }] },
        { OR: [{ endsAt: null }, { endsAt: { gt: now } }] },
        { OR: [{ maxRedemptions: null }, { redemptionCount: { lt: tx.discountCode.fields.maxRedemptions } }] },
      ],
    },
    data: { redemptionCount: { increment: 1 } },
  });
  if (reserved.count !== 1) {
    const current = await tx.discountCode.findFirst({
      where: { id: quote.discountCodeId, vendorId: quote.vendorId },
      select: { revision: true, isActive: true, maxRedemptions: true, redemptionCount: true },
    });
    const exhausted = current?.revision === quote.revision && current.isActive
      && current.maxRedemptions !== null && current.redemptionCount >= current.maxRedemptions;
    const reason = exhausted ? "usage_limit_reached" : "changed";
    logDiscountCodeRefusal(reason, { vendorId: quote.vendorId, discountCodeId: quote.discountCodeId });
    throw new DiscountCodeUnavailableError(reason);
  }
  if (quote.maxRedemptionsPerBuyer !== null) {
    const used = await tx.discountCodeRedemption.count({
      where: {
        vendorId: quote.vendorId,
        discountCodeId: quote.discountCodeId,
        buyerKeyHash: input.buyerKeyHash,
        status: { in: ["reserved", "redeemed"] },
      },
    });
    if (used >= quote.maxRedemptionsPerBuyer) {
      logDiscountCodeRefusal("buyer_limit_reached", { vendorId: quote.vendorId, discountCodeId: quote.discountCodeId });
      throw new DiscountCodeUnavailableError("buyer_limit_reached");
    }
  }
  return tx.discountCodeRedemption.create({
    data: {
      vendorId: quote.vendorId,
      discountCodeId: quote.discountCodeId,
      orderId: input.orderId,
      paymentTransactionId: input.paymentTransactionId,
      buyerKeyHash: input.buyerKeyHash,
      status: "reserved",
      codeSnapshot: quote.code,
      discountType: quote.discountType,
      discountValue: quote.discountValue,
      currency: quote.currency,
      subtotalAmountCents: quote.subtotalAmountCents,
      discountAmountCents: quote.discountAmountCents,
      totalAmountCents: quote.totalAmountCents,
      reservedAt: now,
    },
    select: { id: true },
  });
}

type LifecycleDb = Pick<Prisma.TransactionClient, "discountCode" | "discountCodeRedemption">;

export type DiscountCodeReleaseReason = "payment_failed" | "payment_expired";

/**
 * Gives the use back when an unpaid order fails or expires. Called in the
 * same transaction as the order's status change; a no-op for orders without
 * a code, already released or already paid.
 */
export async function releaseDiscountCodeRedemption(tx: LifecycleDb, input: {
  vendorId: string; orderId: string; reason: DiscountCodeReleaseReason; now: Date;
}) {
  const redemption = await tx.discountCodeRedemption.findUnique({
    where: { vendorId_orderId: { vendorId: input.vendorId, orderId: input.orderId } },
    select: { id: true, discountCodeId: true, status: true },
  });
  if (!redemption || redemption.status !== "reserved") return false;
  const released = await tx.discountCodeRedemption.updateMany({
    where: { id: redemption.id, vendorId: input.vendorId, status: "reserved" },
    data: { status: "released", releasedAt: input.now, releaseReason: input.reason },
  });
  if (released.count !== 1) return false;
  await tx.discountCode.updateMany({
    where: { id: redemption.discountCodeId, vendorId: input.vendorId, redemptionCount: { gt: 0 } },
    data: { redemptionCount: { decrement: 1 } },
  });
  return true;
}

/**
 * Marks the use as redeemed when the order is paid. A payment that arrives
 * after the reservation was released (PayUni may still collect an expired
 * order) counts the use again even past the total limit: the buyer already
 * paid the discounted price.
 */
export async function confirmDiscountCodeRedemption(tx: LifecycleDb, input: {
  vendorId: string; orderId: string; now: Date;
}) {
  const redemption = await tx.discountCodeRedemption.findUnique({
    where: { vendorId_orderId: { vendorId: input.vendorId, orderId: input.orderId } },
    select: { id: true, discountCodeId: true, status: true },
  });
  if (!redemption || redemption.status === "redeemed") return null;
  const confirmed = await tx.discountCodeRedemption.updateMany({
    where: { id: redemption.id, vendorId: input.vendorId, status: redemption.status },
    data: { status: "redeemed", redeemedAt: input.now },
  });
  if (confirmed.count !== 1) return null;
  if (redemption.status === "released") {
    await tx.discountCode.updateMany({
      where: { id: redemption.discountCodeId, vendorId: input.vendorId },
      data: { redemptionCount: { increment: 1 } },
    });
  }
  return { id: redemption.id, recountedAfterRelease: redemption.status === "released" };
}
