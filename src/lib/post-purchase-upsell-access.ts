import type { PrismaClient } from "@prisma/client";
import type { ReservedInventoryRevision } from "@/lib/inventory-reservations";
import {
  PostPurchaseUpsellProductSchema,
  resolvePostPurchaseOffer,
  type PostPurchaseOffer,
  type PostPurchaseUpsellProduct,
} from "@/lib/post-purchase-upsell";

type UpsellDb = Pick<PrismaClient, "commerceOrder" | "product">;

// Match the strict offer contract without leaking unrelated product fields.
const offerProductSelect = {
  id: true, vendorId: true, name: true, priceCents: true, currency: true,
  isActive: true, fulfillmentTypeConfirmed: true, inventory: true,
  upsellProductId: true, upsellDiscountCents: true, downsellProductId: true,
} as const;

/**
 * Reads the configured relationship from the purchased product and re-reads
 * every proposed target inside the same tenant. Product IDs from URLs are not
 * considered configuration.
 */
export async function resolvePaidOrderPostPurchaseOffer(
  db: UpsellDb,
  input: { vendorId: string; orderId: string; kind: "upsell" | "downsell" },
  reserved?: ReservedInventoryRevision,
): Promise<{ source: PostPurchaseUpsellProduct; offer: PostPurchaseOffer } | null> {
  // Browser grants deliberately use a bounded order selector, but that does
  // not prove the order has exactly one item. Re-read the canonical paid
  // order here so the credit always comes from immutable commercial terms.
  const order = await db.commerceOrder.findFirst({
    where: {
      id: input.orderId, vendorId: input.vendorId, status: "paid", isTestOrder: false, refundedAmountCents: 0,
      postPurchaseCreditIssued: { is: null }, postPurchaseCreditReceived: { is: null },
    },
    select: {
      currency: true,
      totalAmountCents: true,
      paidAmountCents: true,
      refundedAmountCents: true,
      isTestOrder: true,
      items: { take: 2, select: { productId: true, quantity: true } },
    },
  });
  if (
    !order
    || order.items.length !== 1
    || !order.items[0]?.productId
    || order.items[0].quantity !== 1
    || !Number.isSafeInteger(order.totalAmountCents)
    || order.totalAmountCents <= 0
    // The paid label alone cannot fund credit: retain the canonical settled
    // amount and reject partial refunds and test orders before signing offers.
    || order.paidAmountCents !== order.totalAmountCents
    || order.refundedAmountCents !== 0
    || order.isTestOrder
  ) return null;

  const sourceRecord = await db.product.findFirst({
    where: { id: order.items[0].productId, vendorId: input.vendorId },
    select: offerProductSelect,
  });
  const source = PostPurchaseUpsellProductSchema.safeParse(sourceRecord);
  if (!source.success || source.data.currency !== order.currency) return null;
  const configuredTargetId = input.kind === "upsell" ? source.data.upsellProductId : source.data.downsellProductId;
  if (!configuredTargetId) return null;
  const candidates = await db.product.findMany({
    where: { id: configuredTargetId, vendorId: input.vendorId, checkoutUrl: null },
    select: { ...offerProductSelect, revision: true },
  });
  const availableCandidates = candidates.map(({ revision, ...candidate }) => {
    // Only the checkout's successful reserve proof permits its own final unit
    // to remain eligible after stock reaches zero inside the same transaction.
    const ownsReservedUnit = reserved?.vendorId === input.vendorId && reserved.productId === candidate.id
      && reserved.afterRevision === reserved.beforeRevision + 1 && revision === reserved.afterRevision;
    return ownsReservedUnit ? { ...candidate, inventory: candidate.inventory + 1 } : candidate;
  });
  // Keep the live product's offer configuration and availability checks, but
  // replace its mutable catalogue price with what this buyer actually paid.
  // A later catalogue edit must never inflate the post-purchase credit.
  const paidSource = { ...source.data, priceCents: order.totalAmountCents };
  const offer = resolvePostPurchaseOffer({ source: paidSource, candidates: availableCandidates, kind: input.kind, sourceOwned: true });
  return offer ? { source: paidSource, offer } : null;
}
