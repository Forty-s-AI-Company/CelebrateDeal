import type { PrismaClient } from "@prisma/client";
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
): Promise<{ source: PostPurchaseUpsellProduct; offer: PostPurchaseOffer } | null> {
  // Browser grants deliberately use a bounded order selector, but that does
  // not prove the order has exactly one item. Re-read the canonical paid
  // order here so the credit always comes from immutable commercial terms.
  const order = await db.commerceOrder.findFirst({
    where: { id: input.orderId, vendorId: input.vendorId, status: "paid" },
    select: {
      currency: true,
      totalAmountCents: true,
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
    where: { id: configuredTargetId, vendorId: input.vendorId },
    select: offerProductSelect,
  });
  // Keep the live product's offer configuration and availability checks, but
  // replace its mutable catalogue price with what this buyer actually paid.
  // A later catalogue edit must never inflate the post-purchase credit.
  const paidSource = { ...source.data, priceCents: order.totalAmountCents };
  const offer = resolvePostPurchaseOffer({ source: paidSource, candidates, kind: input.kind });
  return offer ? { source: paidSource, offer } : null;
}
