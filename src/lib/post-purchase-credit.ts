import { createHash } from "node:crypto";
import { Prisma } from "@prisma/client";
import { BUYER_SUPPORT_COOKIE_PREFIX, resolveBuyerSupportGrant } from "@/lib/buyer-support-access";
import { resolvePaidOrderPostPurchaseOffer } from "@/lib/post-purchase-upsell-access";
import { verifyPostPurchaseCheckoutToken } from "@/lib/post-purchase-upsell";
import type { ReservedInventoryRevision } from "@/lib/inventory-reservations";

type Database = Pick<Prisma.TransactionClient, "buyerSupportOrderGrant" | "commerceOrder" | "product" | "postPurchaseCredit">;
type Cookies = { getAll(): Array<{ name: string; value: string }> };
export function postPurchaseRequestCookies(request: Request): Cookies {
  const cookies = (request.headers.get("cookie") ?? "").split(";").slice(0, 100).flatMap(part => {
    const separator = part.indexOf("=");
    if (separator <= 0) return [];
    const name = part.slice(0, separator).trim(); const value = part.slice(separator + 1).trim();
    return name.startsWith(BUYER_SUPPORT_COOKIE_PREFIX) && /^[A-Za-z0-9_-]{43}$/u.test(value) ? [{ name, value }] : [];
  }).slice(0, 50);
  return { getAll: () => cookies };
}
export class PostPurchaseUnavailableError extends Error {
  constructor() { super("Post purchase offer unavailable"); this.name = "PostPurchaseUnavailableError"; }
}

export type PostPurchaseCreditQuote = {
  vendorId: string; sourceOrderId: string; buyerGrantId: string;
  sourceProductId: string; targetProductId: string; kind: "upsell" | "downsell";
  currency: string; creditAmountCents: number; offerDiscountCents: number;
  targetPriceCents: number; checkoutAmountCents: number;
};

/** Same fixed field order binds admission, retry identity and persisted money. */
export function postPurchaseCreditQuoteHash(quote: PostPurchaseCreditQuote) {
  return createHash("sha256").update(JSON.stringify([
    "post-purchase-credit-v1", quote.vendorId, quote.sourceOrderId, quote.buyerGrantId,
    quote.sourceProductId, quote.targetProductId, quote.kind, quote.currency,
    quote.creditAmountCents, quote.offerDiscountCents, quote.targetPriceCents, quote.checkoutAmountCents,
  ])).digest("hex");
}

/** A signed locator never replaces the current browser grant or paid source. */
export async function resolvePostPurchaseCreditQuote(
  db: Database, cookies: Cookies,
  input: { token: string; vendorId: string; productId: string; now?: Date; reserved?: ReservedInventoryRevision },
): Promise<PostPurchaseCreditQuote> {
  const now = input.now ?? new Date();
  const binding = verifyPostPurchaseCheckoutToken(input.token, now);
  if (!binding || binding.vendorId !== input.vendorId || binding.productId !== input.productId) throw new PostPurchaseUnavailableError();
  const grant = await resolveBuyerSupportGrant(db, cookies, binding.grantId, now);
  if (!grant || grant.vendorId !== binding.vendorId || grant.orderId !== binding.orderId) throw new PostPurchaseUnavailableError();
  const resolved = await resolvePaidOrderPostPurchaseOffer(db, { vendorId: binding.vendorId, orderId: binding.orderId, kind: binding.kind }, input.reserved);
  if (!resolved || resolved.source.id !== binding.sourceProductId || resolved.offer.productId !== binding.productId
    || resolved.offer.amountCents !== binding.amountCents) throw new PostPurchaseUnavailableError();
  return {
    vendorId: binding.vendorId, sourceOrderId: binding.orderId, buyerGrantId: binding.grantId,
    sourceProductId: binding.sourceProductId, targetProductId: binding.productId, kind: binding.kind,
    currency: resolved.offer.currency, creditAmountCents: resolved.source.priceCents,
    offerDiscountCents: resolved.offer.discountCents, targetPriceCents: resolved.offer.originalPriceCents,
    checkoutAmountCents: resolved.offer.amountCents,
  };
}

/** Caller must use the checkout's serializable inventory/order transaction. */
export async function consumePostPurchaseCredit(
  tx: Database, cookies: Cookies,
  input: { token: string; quote: PostPurchaseCreditQuote; targetOrderId: string; now?: Date; reserved?: ReservedInventoryRevision },
) {
  const current = await resolvePostPurchaseCreditQuote(tx, cookies, {
    token: input.token, vendorId: input.quote.vendorId, productId: input.quote.targetProductId, now: input.now, reserved: input.reserved,
  });
  if (postPurchaseCreditQuoteHash(current) !== postPurchaseCreditQuoteHash(input.quote)) throw new PostPurchaseUnavailableError();
  try {
    // The unique source-order key covers upsell and downsell together; it is
    // retained even when the target payment fails, so recovery uses that order.
    return await tx.postPurchaseCredit.create({ data: { ...current, targetOrderId: input.targetOrderId } });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && ["P2002", "P2004"].includes(error.code)) throw new PostPurchaseUnavailableError();
    throw error;
  }
}

/** Existing pending orders recover their immutable credit, never a new quote. */
export async function assertPostPurchaseCreditReplay(db: Database, cookies: Cookies, input: {
  vendorId: string; targetOrderId: string; productId: string; token?: string;
}) {
  const credit = await db.postPurchaseCredit.findUnique({
    where: { vendorId_targetOrderId: { vendorId: input.vendorId, targetOrderId: input.targetOrderId } },
    include: { sourceOrder: { select: { status: true, isTestOrder: true, paidAmountCents: true, refundedAmountCents: true } } },
  });
  if (!credit || credit.invalidatedAt || credit.targetProductId !== input.productId || credit.sourceOrder.status !== "paid"
    || credit.sourceOrder.isTestOrder || credit.sourceOrder.refundedAmountCents !== 0
    || credit.sourceOrder.paidAmountCents !== credit.creditAmountCents) throw new PostPurchaseUnavailableError();
  const grant = await resolveBuyerSupportGrant(db, cookies, credit.buyerGrantId);
  if (!grant || grant.vendorId !== credit.vendorId || grant.orderId !== credit.sourceOrderId) throw new PostPurchaseUnavailableError();
  if (input.token) {
    const binding = verifyPostPurchaseCheckoutToken(input.token);
    if (!binding || binding.vendorId !== credit.vendorId || binding.orderId !== credit.sourceOrderId
      || binding.grantId !== credit.buyerGrantId || binding.productId !== credit.targetProductId
      || binding.sourceProductId !== credit.sourceProductId || binding.kind !== credit.kind
      || binding.amountCents !== credit.checkoutAmountCents) throw new PostPurchaseUnavailableError();
  }
  return credit;
}
