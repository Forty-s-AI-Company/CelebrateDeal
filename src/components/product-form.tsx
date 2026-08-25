import type { Product } from "@prisma/client";
import { ProductFormClient, type CourseMembershipOption, type ProductFormProduct } from "@/components/product-form-client";
import { Card } from "@/components/ui";
import { getCsrfToken } from "@/lib/csrf";
import { revealProductDeliveryConfig } from "@/lib/product-delivery";
import { safeParseCustomCheckoutFields } from "@/lib/commerce-custom-checkout";

type ProductWithDeliveryConfig = Product & {
  imageAssetId?: string | null;
  deliveryConfig?: {
    id: string;
    productId: string;
    revision: number;
    title: string;
    destinationEncryptedEnvelope: string | null;
    instructionsEncryptedEnvelope: string | null;
  } | null;
};

export async function ProductForm({
  product,
  memberships = [],
  error,
}: {
  product?: ProductWithDeliveryConfig;
  memberships?: CourseMembershipOption[];
  error?: string;
}) {
  const csrfToken = await getCsrfToken();
  const revealedDelivery = product?.deliveryConfig
    ? revealProductDeliveryConfig(product.deliveryConfig, {
        vendorId: product.vendorId,
        productId: product.id,
        configId: product.deliveryConfig.id,
        revision: product.deliveryConfig.revision,
      })
    : { destinationUrl: null, instructions: null };
  const serializedProduct: ProductFormProduct | undefined = product ? {
    id: product.id,
    revision: product.revision,
    name: product.name,
    slug: product.slug,
    description: product.description,
    priceCents: product.priceCents,
    compareAtCents: product.compareAtCents,
    currency: product.currency,
    imageUrl: product.imageUrl,
    imageAssetId: product.imageAssetId,
    checkoutUrl: product.checkoutUrl,
    customCheckoutFields: safeParseCustomCheckoutFields(product.customCheckoutFields).data ?? [],
    inventory: product.inventory,
    isActive: product.isActive,
    commerceDomain: product.commerceDomain,
    fulfillmentType: product.fulfillmentType,
    fulfillmentTypeConfirmed: product.fulfillmentTypeConfirmed,
    courseContentOwnerMembershipId: product.courseContentOwnerMembershipId,
    coursePromoterShareBps: product.coursePromoterShareBps,
    deliveryTitle: product.deliveryConfig?.title ?? "",
    deliveryUrl: revealedDelivery.destinationUrl ?? "",
    deliveryInstructions: revealedDelivery.instructions ?? "",
    deliveryHostConfirmed: Boolean(revealedDelivery.destinationUrl),
  } : undefined;

  return (
    <Card>
      <ProductFormClient
        csrfToken={csrfToken}
        product={serializedProduct}
        memberships={memberships}
        nativeAction="/api/products/upsert"
        initialError={error as Parameters<typeof ProductFormClient>[0]["initialError"]}
      />
    </Card>
  );
}
