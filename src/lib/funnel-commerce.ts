import { z } from "zod";

const identifier = z.string().trim().min(1).max(100).regex(/^[A-Za-z0-9_-]+$/u);

/** Persist references, never merchant ownership, prices or provider credentials. */
export const FunnelCommerceBindingSchema = z.object({
  schemaVersion: z.literal(1),
  productId: identifier,
  orderBumpProductId: identifier.optional(),
  formMode: z.enum(["single", "two_step"]).default("single"),
  agreement: z.object({ label: z.string().trim().min(1).max(500) }).strict().optional(),
}).strict().refine((binding) => binding.productId !== binding.orderBumpProductId, {
  message: "加購商品不能與主商品相同", path: ["orderBumpProductId"],
});
export type FunnelCommerceBinding = z.infer<typeof FunnelCommerceBindingSchema>;

/** An untrusted locator: the server must re-read the published page and binding. */
export const FunnelCheckoutReferenceSchema = z.object({
  slug: identifier,
  stepId: identifier,
  // Checkout pages receive these from a server-rendered resolved snapshot.
  // They are still untrusted input and POST compares them before new writes.
  expectedVersion: z.number().int().positive().max(1_000_000).optional(),
  expectedProductRevision: z.number().int().positive().max(1_000_000).optional(),
  expectedOrderBumpRevision: z.number().int().positive().max(1_000_000).optional(),
}).strict();
export type FunnelCheckoutReference = z.infer<typeof FunnelCheckoutReferenceSchema>;

/** Explicit allowlist of catalog fields safe for editor/public serialization. */
export type FunnelCommerceProduct = {
  id: string;
  name: string;
  priceCents: number;
  currency: string;
  fulfillmentType: "physical" | "digital" | "service" | "course";
};
export type FunnelCommerceView = {
  product: FunnelCommerceProduct;
  orderBump?: FunnelCommerceProduct;
  checkoutPath?: string;
};

export function funnelCheckoutPath(reference: FunnelCheckoutReference): string {
  return `/lp/${encodeURIComponent(reference.slug)}/${encodeURIComponent(reference.stepId)}/checkout`;
}

export function commerceViewForBinding(binding: FunnelCommerceBinding | undefined, products: FunnelCommerceProduct[]): FunnelCommerceView | undefined {
  if (!binding) return undefined;
  const product = products.find((item) => item.id === binding.productId);
  const orderBump = products.find((item) => item.id === binding.orderBumpProductId);
  if (!product || (binding.orderBumpProductId && (!orderBump || orderBump.currency !== product.currency))) return undefined;
  return { product, ...(orderBump ? { orderBump } : {}) };
}
