import type { PrismaClient } from "@prisma/client";
import {
  PostPurchaseUpsellProductSchema,
  resolvePostPurchaseOffer,
  type PostPurchaseOffer,
  type PostPurchaseUpsellProduct,
} from "@/lib/post-purchase-upsell";

type UpsellDb = Pick<PrismaClient, "product">;

/**
 * Reads the configured relationship from the purchased product and re-reads
 * every proposed target inside the same tenant. Product IDs from URLs are not
 * considered configuration.
 */
export async function resolvePaidOrderPostPurchaseOffer(
  db: UpsellDb,
  input: { vendorId: string; status: string; productIds: readonly string[]; kind: "upsell" | "downsell" },
): Promise<{ source: PostPurchaseUpsellProduct; offer: PostPurchaseOffer } | null> {
  if (input.status !== "paid" || input.productIds.length !== 1) return null;
  const sourceRecord = await db.product.findFirst({
    where: { id: input.productIds[0], vendorId: input.vendorId },
  });
  const source = PostPurchaseUpsellProductSchema.safeParse(sourceRecord);
  if (!source.success) return null;
  const configuredTargetId = input.kind === "upsell" ? source.data.upsellProductId : source.data.downsellProductId;
  if (!configuredTargetId) return null;
  const candidates = await db.product.findMany({
    where: { id: configuredTargetId, vendorId: input.vendorId },
  });
  const offer = resolvePostPurchaseOffer({ source: source.data, candidates, kind: input.kind });
  return offer ? { source: source.data, offer } : null;
}
