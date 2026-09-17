import { getDb } from "@/lib/db";
import {
  commerceViewForBinding,
  funnelCheckoutPath,
  FunnelCheckoutReferenceSchema,
  FunnelCommerceBindingSchema,
  type FunnelCheckoutReference,
  type FunnelCommerceBinding,
  type FunnelCommerceProduct,
  type FunnelCommerceView,
} from "@/lib/funnel-commerce";
import { parsePageDocument, type PageDocument } from "@/lib/funnel-page-document";
import { parseFunnelStepPages } from "@/lib/funnel-step-pages";
import { safeParseCustomCheckoutFields, type CustomCheckoutFields } from "@/lib/commerce-custom-checkout";

type CommerceScope = { vendorId: string; projectId: string };

type CatalogProduct = {
  id: string;
  vendorId: string;
  name: string;
  description: string | null;
  priceCents: number;
  currency: string;
  fulfillmentType: "physical" | "digital" | "service" | "course";
  inventory: number;
  isActive: boolean;
  fulfillmentTypeConfirmed: boolean;
  checkoutUrl: string | null;
  customCheckoutFields: unknown;
  revision: number;
  deliveryConfig: { status: string; fulfillmentType: string } | null;
};

export type FunnelCheckoutProduct = FunnelCommerceProduct & {
  vendorId: string;
  description: string | null;
  inventory: number;
  revision: number;
  customCheckoutFields: CustomCheckoutFields;
};

export type ResolvedFunnelCheckout = {
  reference: FunnelCheckoutReference;
  vendorId: string;
  projectId: string;
  pageId: string;
  version: number;
  binding: FunnelCommerceBinding;
  product: FunnelCheckoutProduct;
  orderBump?: FunnelCheckoutProduct;
};

const productSelect = {
  id: true, vendorId: true, name: true, description: true, priceCents: true, currency: true,
  fulfillmentType: true, inventory: true, isActive: true, fulfillmentTypeConfirmed: true,
  checkoutUrl: true, customCheckoutFields: true, revision: true,
  deliveryConfig: { select: { status: true, fulfillmentType: true } },
} as const;

function isReady(product: CatalogProduct | undefined, allowReservedInventory = false) {
  if (!product) return false;
  return product.isActive
    && product.fulfillmentTypeConfirmed
    && product.priceCents > 0
    && (allowReservedInventory || product.inventory > 0)
    && !product.checkoutUrl
    && (product.fulfillmentType === "physical" || (
      product.deliveryConfig?.status === "active"
      && product.deliveryConfig.fulfillmentType === product.fulfillmentType
    ));
}

function safeProduct(product: CatalogProduct | undefined, allowReservedInventory = false): FunnelCommerceProduct | null {
  if (!product) return null;
  if (!isReady(product, allowReservedInventory)) return null;
  return {
    id: product.id,
    name: product.name,
    priceCents: product.priceCents,
    currency: product.currency,
    fulfillmentType: product.fulfillmentType,
  };
}

function checkoutProduct(product: CatalogProduct | undefined, allowReservedInventory = false): FunnelCheckoutProduct | null {
  if (!product) return null;
  const publicProduct = safeProduct(product, allowReservedInventory);
  const fields = safeParseCustomCheckoutFields(product.customCheckoutFields);
  if (!publicProduct || !fields.success) return null;
  return {
    ...publicProduct,
    vendorId: product.vendorId,
    description: product.description,
    inventory: product.inventory,
    revision: product.revision,
    customCheckoutFields: fields.data,
  };
}

function documentsIn(content: unknown): PageDocument[] {
  const steps = parseFunnelStepPages(content);
  if (steps) return Object.values(steps.pages);
  const document = parsePageDocument(content);
  return document ? [document] : [];
}

function bindingsIn(content: unknown) {
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

/** Catalog projection used by the editor; it contains no provider or delivery details. */
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
    const product = safeProduct(byId.get(result.data.productId)!);
    const bump = result.data.orderBumpProductId ? safeProduct(byId.get(result.data.orderBumpProductId)!) : undefined;
    if (!product || (result.data.orderBumpProductId && (!bump || bump.currency !== product.currency || (product.fulfillmentType !== "physical" && bump.fulfillmentType === "physical")))) {
      throw new Error("funnel_commerce_product_unavailable");
    }
  }
}

/**
 * Re-resolves an untrusted checkout locator against the currently published
 * immutable Funnel version and the live project-scoped catalog.
 */
export async function resolvePublishedFunnelCheckout(reference: unknown, database = getDb(), options: { allowReservedInventory?: boolean } = {}): Promise<ResolvedFunnelCheckout | null> {
  const parsedReference = FunnelCheckoutReferenceSchema.safeParse(reference);
  if (!parsedReference.success) return null;
  const page = await database.landingPage.findFirst({
    where: {
      slug: parsedReference.data.slug,
      status: "published",
      publishedVersionId: { not: null },
      project: { is: { status: "published", publishedAt: { not: null } } },
    },
    select: {
      id: true, vendorId: true, projectId: true, slug: true, publishedVersionId: true,
      publishedVersion: { select: { id: true, vendorId: true, pageId: true, version: true, content: true } },
    },
  });
  if (!page?.publishedVersion || page.publishedVersion.vendorId !== page.vendorId || page.publishedVersion.pageId !== page.id) return null;
  const steps = parseFunnelStepPages(page.publishedVersion.content);
  const step = steps?.flow.steps.find((candidate) => candidate.id === parsedReference.data.stepId);
  const document = steps?.pages[parsedReference.data.stepId];
  if (!step || step.type !== "order_form" || !document) return null;
  const bindingResult = FunnelCommerceBindingSchema.safeParse(document.commerce);
  if (!bindingResult.success) return null;
  const scope = { vendorId: page.vendorId, projectId: page.projectId };
  const ids = [bindingResult.data.productId, ...(bindingResult.data.orderBumpProductId ? [bindingResult.data.orderBumpProductId] : [])];
  const products = await catalogProducts(database, scope, ids);
  const byId = new Map(products.map((product) => [product.id, product]));
  const product = checkoutProduct(byId.get(bindingResult.data.productId), options.allowReservedInventory);
  const orderBump = bindingResult.data.orderBumpProductId ? checkoutProduct(byId.get(bindingResult.data.orderBumpProductId), options.allowReservedInventory) : undefined;
  if (!product || (bindingResult.data.orderBumpProductId && (!orderBump || orderBump.currency !== product.currency || (product.fulfillmentType !== "physical" && orderBump.fulfillmentType === "physical")))) return null;
  return {
    reference: parsedReference.data,
    vendorId: page.vendorId,
    projectId: page.projectId,
    pageId: page.id,
    version: page.publishedVersion.version,
    binding: bindingResult.data,
    product,
    ...(orderBump ? { orderBump } : {}),
  };
}

/** Public document commerce never leaks a merchant id, delivery data, or fields. */
export async function publicFunnelCommerceViews(scope: CommerceScope, content: unknown, slug: string, database = getDb()): Promise<Record<string, FunnelCommerceView>> {
  const steps = parseFunnelStepPages(content);
  const documents = documentsIn(content);
  const ids = [...new Set(bindingsIn(content).flatMap((binding) => [binding.productId, ...(binding.orderBumpProductId ? [binding.orderBumpProductId] : [])]))];
  if (ids.length === 0) return {};
  const products = (await catalogProducts(database, scope, ids)).flatMap((product) => {
    const safe = safeProduct(product);
    return safe ? [safe] : [];
  });
  return Object.fromEntries(documents.flatMap((document) => {
    const view = commerceViewForBinding(document.commerce, products);
    if (!view) return [];
    const step = steps?.flow.steps.find((candidate) => steps.pages[candidate.id]?.id === document.id);
    return [[document.id, {
      ...view,
      ...(step?.type === "order_form" ? { checkoutPath: funnelCheckoutPath({ slug, stepId: step.id }) } : {}),
    }]];
  }));
}
