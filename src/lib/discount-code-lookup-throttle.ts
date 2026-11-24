import "server-only";

import type { PrismaClient } from "@prisma/client";

import {
  logDiscountCodeRefusal,
  resolveDiscountCodeQuote,
  type DiscountCodeCheckoutContext,
  type DiscountCodeEvaluation,
  type DiscountCodeRejection,
} from "@/lib/discount-codes";

/**
 * A4-01 guessing limit (review m-1, MJ-1, MN-1, MN-2, NT-2).
 *
 * Only a lookup that finds no usable code (`invalid`, which is also what
 * another vendor's code and an unknown code answer) counts as a failure. A
 * code that exists but is used up or below its minimum spend does not count,
 * nor does a hit, so a live stream full of buyers typing the right code never
 * locks it.
 *
 * Two fixed 10-minute counters, independent of the caller's IP: per product
 * (`product:<id>`) and per vendor (`vendor`, so many products cannot multiply
 * the per-product cap). Each lookup is debited from both BEFORE the code is
 * read, with a conditional upsert that refuses once the cap is reached, and
 * refunded afterwards when it did not count. Concurrent wrong guesses
 * therefore never read the code table more often than the cap allows.
 *
 * Past a cap every lookup in that scope answers 429 — also a correct code, so
 * a hit cannot be told apart. A buyer who previewed the code successfully
 * carries a signed token that lets checkout skip this throttle
 * (`discount-code-preview-token.ts`). The per-IP limit is separate
 * (`checkRateLimit`, A4-03).
 *
 * Merchant notification when a product or vendor is locked is a follow-up
 * (docs/domain-workflows.md 折扣碼).
 */
export const DISCOUNT_CODE_LOOKUP_WINDOW_MS = 10 * 60 * 1000;
export const DISCOUNT_CODE_LOOKUP_LIMITS = Object.freeze({ product: 300, vendor: 1000 });
export type DiscountCodeLookupLimits = { product: number; vendor: number };
/** Per-IP layer shared by preview and token-less checkout (`checkRateLimit`; A4-03 fixes how the IP is read). */
export const DISCOUNT_CODE_IP_RATE_LIMIT = Object.freeze({ key: "checkout-discount-code", limit: 10, windowMs: 60_000 });

/** Results that prove the code exists; they are not a guess and are refunded. */
const NOT_A_GUESS: ReadonlySet<DiscountCodeRejection> = new Set(["usage_limit_reached", "min_subtotal_not_met"]);

type ThrottleDb = Pick<PrismaClient, "$queryRaw" | "discountCodeLookupThrottle">;
type Scope = { vendorId: string; scopeKey: string; windowStart: Date };

function lookupWindow(now: Date) {
  const start = Math.floor(now.getTime() / DISCOUNT_CODE_LOOKUP_WINDOW_MS) * DISCOUNT_CODE_LOOKUP_WINDOW_MS;
  return {
    windowStart: new Date(start),
    retryAfterSeconds: Math.max(1, Math.ceil((start + DISCOUNT_CODE_LOOKUP_WINDOW_MS - now.getTime()) / 1000)),
  };
}

/** Atomically takes one attempt unless the scope already reached `limit`; true when taken. */
async function debit(db: ThrottleDb, scope: Scope, limit: number) {
  const rows = await db.$queryRaw<Array<{ failureCount: number }>>`
    INSERT INTO "DiscountCodeLookupThrottle" ("vendorId", "scopeKey", "windowStart", "failureCount")
    VALUES (${scope.vendorId}, ${scope.scopeKey}, (${scope.windowStart}::timestamptz AT TIME ZONE 'UTC'), 1)
    ON CONFLICT ("vendorId", "scopeKey", "windowStart")
    DO UPDATE SET "failureCount" = "DiscountCodeLookupThrottle"."failureCount" + 1
    WHERE "DiscountCodeLookupThrottle"."failureCount" < ${limit}
    RETURNING "failureCount"`;
  const taken = rows[0];
  if (taken?.failureCount === 1) {
    // First attempt of a new window: drop this vendor's windows older than the previous one.
    await db.discountCodeLookupThrottle.deleteMany({
      where: { vendorId: scope.vendorId, windowStart: { lt: new Date(scope.windowStart.getTime() - DISCOUNT_CODE_LOOKUP_WINDOW_MS) } },
    });
  }
  return Boolean(taken);
}

async function refund(db: ThrottleDb, scope: Scope) {
  await db.discountCodeLookupThrottle.updateMany({
    where: { vendorId: scope.vendorId, scopeKey: scope.scopeKey, windowStart: scope.windowStart, failureCount: { gt: 0 } },
    data: { failureCount: { decrement: 1 } },
  });
}

async function refundAll(db: ThrottleDb, scopes: readonly Scope[]) {
  for (const scope of scopes) {
    try {
      await refund(db, scope);
    } catch (error) {
      // Keeping the debit only makes the limit stricter; never fail the request for it.
      reportThrottleFailure("refund", error);
    }
  }
}

function reportThrottleFailure(operation: "debit" | "refund", error: unknown) {
  console.error("discount_code_throttle_failed", { operation, errorName: error instanceof Error ? error.name : "unknown" });
}

export type ThrottledDiscountCodeEvaluation =
  | DiscountCodeEvaluation
  | { ok: false; reason: "throttled"; retryAfterSeconds: number };

/**
 * The lookup preview and token-less checkout use. NT-2: when the counter
 * cannot be written the lookup is refused like a full window (429, logged),
 * so a database hiccup neither breaks the request nor lets guesses through.
 */
export async function resolveThrottledDiscountCodeQuote(
  db: ThrottleDb & Pick<PrismaClient, "discountCode">,
  enteredCode: unknown,
  context: DiscountCodeCheckoutContext,
  limits: DiscountCodeLookupLimits = DISCOUNT_CODE_LOOKUP_LIMITS,
): Promise<ThrottledDiscountCodeEvaluation> {
  const { windowStart, retryAfterSeconds } = lookupWindow(context.now);
  const product: Scope = { vendorId: context.vendorId, scopeKey: `product:${context.productId}`, windowStart };
  const vendor: Scope = { vendorId: context.vendorId, scopeKey: "vendor", windowStart };
  const taken: Scope[] = [];
  try {
    if (!await debit(db, product, limits.product)) return { ok: false, reason: "throttled", retryAfterSeconds };
    taken.push(product);
    if (!await debit(db, vendor, limits.vendor)) {
      await refundAll(db, taken);
      return { ok: false, reason: "throttled", retryAfterSeconds };
    }
    taken.push(vendor);
  } catch (error) {
    reportThrottleFailure("debit", error);
    await refundAll(db, taken);
    return { ok: false, reason: "throttled", retryAfterSeconds };
  }

  const result = await resolveDiscountCodeQuote(db, enteredCode, context);
  if (result.ok || NOT_A_GUESS.has(result.reason)) await refundAll(db, taken);
  if (!result.ok) logDiscountCodeRefusal(result.reason, { vendorId: context.vendorId, productId: context.productId });
  return result;
}
