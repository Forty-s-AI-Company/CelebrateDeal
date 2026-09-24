import { notFound } from "next/navigation";
import { CommerceCheckoutEntry } from "@/components/commerce-checkout-entry";
import { getDb } from "@/lib/db";
import { resolvePublishedFunnelCheckout } from "@/lib/funnel-commerce-service";

/** Checkout re-resolves the published snapshot; URL segments are never a catalog authority. */
export default async function FunnelCheckoutPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string; stepPath: string }>;
  searchParams?: Promise<{ resume?: string }>;
}) {
  const { slug, stepPath } = await params;
  const resume = (await searchParams)?.resume === "1";
  const checkout = await resolvePublishedFunnelCheckout({ slug, stepId: stepPath }, getDb(), { allowReservedInventory: true });
  if (!checkout) {
    if (!resume) notFound();
    return <main className="mx-auto max-w-xl px-4 py-12"><h1 className="mb-5 text-2xl font-black text-slate-950">恢復待付款訂單</h1><CommerceCheckoutEntry /></main>;
  }
  return (
    <main className="min-h-screen bg-slate-100 px-4 py-8 sm:py-12">
      <CommerceCheckoutEntry summary={{ description: checkout.product.description }} current={{
            vendorId: checkout.vendorId,
            productId: checkout.product.id,
            productName: checkout.product.name,
            fulfillmentType: checkout.product.fulfillmentType,
            customCheckoutFields: checkout.product.customCheckoutFields,
            recoveryOnly: checkout.product.inventory <= 0,
            priceCents: checkout.product.priceCents,
            currency: checkout.product.currency,
            formMode: checkout.binding.formMode,
            ...(checkout.orderBump ? { orderBump: { productId: checkout.orderBump.id, title: checkout.orderBump.name, description: checkout.orderBump.description ?? "", priceCents: checkout.orderBump.priceCents } } : {}),
            funnel: { ...checkout.reference, expectedVersion: checkout.version, expectedProductRevision: checkout.product.revision, ...(checkout.orderBump ? { expectedOrderBumpRevision: checkout.orderBump.revision } : {}) },
            agreementLabel: checkout.binding.agreement?.label,
          }} />
    </main>
  );
}
