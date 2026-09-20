import { getDb } from "@/lib/db";
import {
  commerceViewForBinding,
  FunnelCommerceBindingSchema,
  type FunnelCommerceBinding,
  type FunnelCommerceProduct,
  type FunnelCommerceView,
} from "@/lib/funnel-commerce";
import { parsePageDocument, type PageDocument } from "@/lib/funnel-page-document";
import { parseFunnelStepPages } from "@/lib/funnel-step-pages";

type CommerceScope = { vendorId: string; projectId: string };

type CatalogProduct = {
  id: string;
  vendorId: string;
  name: string;
  priceCents: number;
  currency: string;
  fulfillmentType: "physical" | "digital" | "service" | "course";
  inventory: number;
  isActive: boolean;
  fulfillmentTypeConfirmed: boolean;
  checkoutUrl: string | null;
  deliveryConfig: { status: string; fulfillmentType: string } | null;
};

const productSelect = {
  id: true,
  vendorId: true,
  name: true,
  priceCents: true,
  currency: true,
  fulfillmentType: true,
  inventory: true,
  isActive: true,
  fulfillmentTypeConfirmed: true,
  checkoutUrl: true,
  deliveryConfig: { select: { status: true, fulfillmentType: true } },
} as const;

function isReady(product: CatalogProduct | undefined) {
  if (!product) return false;
  return product.isActive
    && product.fulfillmentTypeConfirmed
    && product.priceCents > 0
    && product.inventory > 0
    && !product.checkoutUrl
    && (product.fulfillmentType === "physical" || (
      product.deliveryConfig?.status === "active"
      && product.deliveryConfig.fulfillmentType === product.fulfillmentType
    ));
}

function safeProduct(product: CatalogProduct | undefined): FunnelCommerceProduct | null {
  if (!product || !isReady(product)) return null;
  return {
    id: product.id,
    name: product.name,
    priceCents: product.priceCents,
    currency: product.currency,
    fulfillmentType: product.fulfillmentType,
  };
}

function documentsIn(content: unknown): PageDocument[] {
  const steps = parseFunnelStepPages(content);
  if (steps) return Object.values(steps.pages);
  const document = parsePageDocument(content);
  return document ? [document] : [];
}

function bindingsIn(content: unknown): FunnelCommerceBinding[] {
  return documentsIn(content).flatMap((document) => document.commerce ? [document.commerce] : []);
}

async function catalogProducts(database: ReturnType<typeof getDb>, scope: CommerceScope, ids?: string[]) {
  return database.product.findMany({
    where: {
      vendorId: scope.vendorId,
      ...(ids ? { id: { in: ids } } : {}),
      salesProjectLinks: { some: { vendorId: scope.vendorId, projectId: scope.projectId } },
    },
    select: productSelect,
    orderBy: [{ name: "asc" }, { id: "asc" }],
  }) as Promise<CatalogProduct[]>;
}

/** Catalog projection used by the editor; provider and delivery details stay server-side. */
export async function listFunnelCommerceProducts(scope: CommerceScope, database = getDb()): Promise<FunnelCommerceProduct[]> {
  const products = await catalogProducts(database, scope);
  return products.flatMap((product) => {
    const safe = safeProduct(product);
    return safe ? [safe] : [];
  });
}

/** Reject stale, cross-project, not-ready, or mixed-currency document bindings. */
export async function validateFunnelCommerceBindings(scope: CommerceScope, content: unknown, database = getDb()) {
  const bindings = bindingsIn(content);
  if (bindings.length === 0) return;
  const parsed = bindings.map((binding) => FunnelCommerceBindingSchema.safeParse(binding));
  if (parsed.some((result) => !result.success)) throw new Error("funnel_commerce_binding_invalid");
  const ids = [...new Set(parsed.flatMap((result) => result.success
    ? [result.data.productId, ...(result.data.orderBumpProductId ? [result.data.orderBumpProductId] : [])]
    : []))];
  const products = await catalogProducts(database, scope, ids);
  const byId = new Map(products.map((product) => [product.id, product]));
  if (products.length !== ids.length) throw new Error("funnel_commerce_product_unavailable");
  for (const result of parsed) {
    if (!result.success) continue;
    const product = safeProduct(byId.get(result.data.productId) ?? undefined);
    const bump = result.data.orderBumpProductId ? safeProduct(byId.get(result.data.orderBumpProductId) ?? undefined) : undefined;
    const invalidBump = result.data.orderBumpProductId && (!bump
      || bump.currency !== product?.currency
      || (product?.fulfillmentType !== "physical" && bump.fulfillmentType === "physical"));
    if (!product || invalidBump) throw new Error("funnel_commerce_product_unavailable");
  }
}

/** Build the public projection for a document after server-side catalog checks. */
export function publicCommerceViewForDocument(
  document: PageDocument,
  products: FunnelCommerceProduct[],
  checkoutPath?: string,
): FunnelCommerceView | undefined {
  const view = commerceViewForBinding(document.commerce, products);
  return view ? { ...view, ...(checkoutPath ? { checkoutPath } : {}) } : undefined;
}

/** Public Funnel projection: only ready products bound to the current project
 * are exposed, while merchant/provider fields remain server-side. */
export async function publicFunnelCommerceViews(
  scope: CommerceScope,
  content: unknown,
  database = getDb(),
): Promise<Record<string, FunnelCommerceView>> {
  const documents = documentsIn(content);
  const ids = [...new Set(bindingsIn(content).flatMap((binding) => [
    binding.productId,
    ...(binding.orderBumpProductId ? [binding.orderBumpProductId] : []),
  ]))];
  if (ids.length === 0) return {};
  const products = (await catalogProducts(database, scope, ids)).flatMap((product) => {
    const safe = safeProduct(product);
    return safe ? [safe] : [];
  });
  return Object.fromEntries(documents.flatMap((document) => {
    const view = commerceViewForBinding(document.commerce, products);
    return view ? [[document.id, view] as const] : [];
  }));
}
