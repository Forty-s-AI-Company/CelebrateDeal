import { z } from "zod";
import type { FunnelNode, FunnelNodeType } from "@/lib/funnel-page-document";

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

/** Canvas elements that render from the page's product binding (the renderer's commerce branch). */
export const FUNNEL_COMMERCE_NODE_TYPES: ReadonlySet<FunnelNodeType> = new Set<FunnelNodeType>([
  "offer_price", "payment_button", "payment_method", "physical_product", "customer_type",
  "agreement", "order_bump", "coupon", "two_step_order_form", "shipping_fees",
]);

export function isFunnelCommerceNodeType(type: FunnelNodeType): boolean {
  return FUNNEL_COMMERCE_NODE_TYPES.has(type);
}

/** Depth-first: the first checkout element on a page root, or null. */
export function firstFunnelCommerceNodeId(nodes: readonly FunnelNode[]): string | null {
  for (const node of nodes) {
    if (isFunnelCommerceNodeType(node.type)) return node.id;
    const nested = node.children ? firstFunnelCommerceNodeId(node.children) : null;
    if (nested) return nested;
  }
  return null;
}

/**
 * Whether a page's checkout elements have a usable product: `none` without
 * checkout elements, `unbound` without a binding, `unavailable` when the bound
 * product is not in the server's current catalog projection. Display only —
 * the server re-validates every binding on save and publish.
 */
export function funnelCommerceBindingStatus(document: { root: readonly FunnelNode[]; commerce?: FunnelCommerceBinding }, products: readonly FunnelCommerceProduct[]): "none" | "unbound" | "unavailable" | "bound" {
  if (!firstFunnelCommerceNodeId(document.root)) return "none";
  if (!document.commerce) return "unbound";
  return products.some((product) => product.id === document.commerce!.productId) ? "bound" : "unavailable";
}
