import type { Prisma } from "@prisma/client";
import { z } from "zod";
import { isPayUniChargeableAmountCents } from "@/lib/payment-providers/payuni-amount";

const identifier = z.string().max(160).regex(/^[A-Za-z0-9_-]+$/u);
export class PostPurchaseProductPolicyError extends Error {}

/** Missing fields preserve older clients; the complete form can explicitly clear offers. */
export function parsePostPurchaseProductPolicy(form: FormData) {
  const keys = ["upsellProductId", "downsellProductId", "upsellDiscount"];
  if (!keys.some(key => form.has(key))) return undefined;
  if (!keys.every(key => typeof form.get(key) === "string")) throw new PostPurchaseProductPolicyError();
  const upsellProductId = String(form.get("upsellProductId")).trim() || null;
  const downsellProductId = String(form.get("downsellProductId")).trim() || null;
  if ([upsellProductId, downsellProductId].some(id => id !== null && !identifier.safeParse(id).success)) throw new PostPurchaseProductPolicyError();
  const discount = String(form.get("upsellDiscount")).trim() || "0";
  if (!/^\d{1,8}(?:\.\d{1,2})?$/u.test(discount)) throw new PostPurchaseProductPolicyError();
  const [whole, fraction = ""] = discount.split(".");
  const upsellDiscountCents = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
  if (upsellDiscountCents > 2_147_483_647 || (!upsellProductId && upsellDiscountCents !== 0)) throw new PostPurchaseProductPolicyError();
  return { upsellProductId, downsellProductId, upsellDiscountCents };
}

export async function assertPostPurchaseProductPolicy(
  db: Pick<Prisma.TransactionClient, "product">,
  input: { vendorId: string; productId: string; currency: string; priceCents: number;
    policy: NonNullable<ReturnType<typeof parsePostPurchaseProductPolicy>>;
    existing?: { vendorId: string; currency: string; priceCents: number; upsellProductId: string | null;
      downsellProductId: string | null; upsellDiscountCents: number | null } | null },
) {
  // Description-only edits preserve existing settings even if a target was
  // subsequently disabled. Checkout still checks current target eligibility.
  const existing = input.existing;
  if (existing && existing.vendorId === input.vendorId && existing.currency === input.currency
    && existing.priceCents === input.priceCents && existing.upsellProductId === input.policy.upsellProductId
    && existing.downsellProductId === input.policy.downsellProductId
    && (existing.upsellDiscountCents ?? 0) === input.policy.upsellDiscountCents) return;
  const ids = [...new Set([input.policy.upsellProductId, input.policy.downsellProductId].filter((id): id is string => id !== null))];
  if (ids.includes(input.productId)) throw new PostPurchaseProductPolicyError();
  // TWD is charged in whole units; a fractional discount can never be paid.
  if (input.currency === "TWD" && input.policy.upsellDiscountCents % 100 !== 0) throw new PostPurchaseProductPolicyError();
  if (!ids.length) return;
  const targets = await db.product.findMany({ where: { vendorId: input.vendorId, id: { in: ids },
    isActive: true, fulfillmentTypeConfirmed: true, checkoutUrl: null },
  select: { id: true, currency: true, priceCents: true } });
  // Checkout re-checks against the paid source amount; this refuses offers the
  // provider could never charge at the configured catalogue prices.
  const offerAmounts = targets.flatMap(target => [
    ...(target.id === input.policy.upsellProductId ? [target.priceCents - input.priceCents - input.policy.upsellDiscountCents] : []),
    ...(target.id === input.policy.downsellProductId ? [target.priceCents - input.priceCents] : []),
  ]);
  if (targets.length !== ids.length || targets.some(target => target.currency !== input.currency
    || target.priceCents <= input.priceCents + (target.id === input.policy.upsellProductId ? input.policy.upsellDiscountCents : 0))
    || offerAmounts.some(amount => !isPayUniChargeableAmountCents(amount))) {
    throw new PostPurchaseProductPolicyError();
  }
}
