import { notFound, redirect } from "next/navigation";
import { CommerceCheckoutEntry } from "@/components/commerce-checkout-entry";
import type { CommerceCheckoutFulfillmentType } from "@/lib/commerce-checkout";
import { safeParseCustomCheckoutFields } from "@/lib/commerce-custom-checkout";
import { getDb } from "@/lib/db";
import { parseSafeExternalHttpUrl } from "@/lib/external-url";

export default async function CommerceCheckoutPage({
  params,
  searchParams,
}: {
  params: Promise<{ vendorId: string; productId: string }>;
  searchParams?: Promise<{ resume?: string }>;
}) {
  const { vendorId, productId } = await params;
  const resume = (await searchParams)?.resume === "1";
  const product = await getDb().product.findFirst({
    where: { id: productId, vendorId },
    select: {
      id: true,
      vendorId: true,
      isActive: true,
      fulfillmentTypeConfirmed: true,
      name: true,
      description: true,
      priceCents: true,
      currency: true,
      imageUrl: true,
      inventory: true,
      checkoutUrl: true,
      customCheckoutFields: true,
      fulfillmentType: true,
      deliveryConfig: { select: { status: true, fulfillmentType: true } },
      vendor: { select: { name: true } },
    },
  });
  if (!product) notFound();
  if (product.checkoutUrl && product.isActive && !resume) {
    const externalCheckoutUrl = parseSafeExternalHttpUrl(product.checkoutUrl);
    if (!externalCheckoutUrl) notFound();
    redirect(externalCheckoutUrl);
  }

  const fulfillmentType = product.fulfillmentType as CommerceCheckoutFulfillmentType;
  const deliveryReady = product.fulfillmentType === "physical"
    || (product.deliveryConfig?.status === "active" && product.deliveryConfig.fulfillmentType === product.fulfillmentType);
  const canRenderNewCheckout = product.isActive
    && product.fulfillmentTypeConfirmed
    && product.priceCents > 0
    && !product.checkoutUrl
    && deliveryReady;
  const customCheckoutFields = safeParseCustomCheckoutFields(product.customCheckoutFields);
  const currentCheckout = canRenderNewCheckout && customCheckoutFields.success ? {
    vendorId: product.vendorId,
    productId: product.id,
    productName: product.name,
    priceCents: product.priceCents,
    currency: product.currency,
    fulfillmentType,
    customCheckoutFields: customCheckoutFields.data,
    recoveryOnly: product.inventory <= 0,
  } : undefined;
  if (!currentCheckout) {
    // A stopped product is no longer public catalog content. The client can
    // recover only the non-sensitive terms of its own saved pending order.
    return <main className="mx-auto max-w-xl px-4 py-12"><h1 className="mb-5 text-2xl font-black text-slate-950">恢復待付款訂單</h1><CommerceCheckoutEntry externalCheckoutUrl={product.isActive && product.checkoutUrl ? parseSafeExternalHttpUrl(product.checkoutUrl) ?? undefined : undefined} /></main>;
  }

  return (
    <main className="min-h-screen bg-slate-100 px-4 py-8 sm:py-12">
      <CommerceCheckoutEntry current={currentCheckout} summary={{ vendorName: product.vendor.name, description: product.description, imageUrl: product.imageUrl }} />
    </main>
  );
}
