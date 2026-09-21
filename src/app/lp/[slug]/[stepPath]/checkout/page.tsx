import { notFound } from "next/navigation";
import { CommerceCheckoutForm } from "@/components/commerce-checkout-form";
import type { CommerceCheckoutFulfillmentType } from "@/lib/commerce-checkout";
import { getDb } from "@/lib/db";
import { resolvePublishedFunnelCheckout } from "@/lib/funnel-commerce-service";

const fulfillmentLabels: Record<CommerceCheckoutFulfillmentType, string> = {
  physical: "實體商品 · 付款後由商家安排出貨",
  digital: "數位內容 · 付款後由商家提供存取權",
  service: "預約服務 · 付款後由商家聯繫排程",
  course: "課程 · 付款後由商家開通權益",
};

function formatPrice(priceCents: number, currency: string) {
  return new Intl.NumberFormat("zh-TW", { style: "currency", currency }).format(priceCents / 100);
}

/** Checkout re-resolves the published snapshot; URL segments are never a catalog authority. */
export default async function FunnelCheckoutPage({ params }: { params: Promise<{ slug: string; stepPath: string }> }) {
  const { slug, stepPath } = await params;
  const checkout = await resolvePublishedFunnelCheckout({ slug, stepId: stepPath }, getDb(), { allowReservedInventory: true });
  if (!checkout) notFound();
  const fulfillmentType = checkout.product.fulfillmentType as CommerceCheckoutFulfillmentType;
  return (
    <main className="min-h-screen bg-slate-100 px-4 py-8 sm:py-12">
      <div className="mx-auto grid w-full max-w-5xl gap-6 lg:grid-cols-[minmax(0,0.82fr)_minmax(0,1.18fr)] lg:items-start">
        <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6" aria-labelledby="checkout-product-title">
          <p className="text-xs font-bold uppercase tracking-[0.2em] text-blue-700">安全結帳</p>
          <h1 id="checkout-product-title" className="mt-2 text-2xl font-black tracking-tight text-slate-950 sm:text-3xl">{checkout.product.name}</h1>
          <p className="mt-3 text-2xl font-black text-slate-950">{formatPrice(checkout.product.priceCents, checkout.product.currency)}</p>
          <p className="mt-2 text-sm font-medium text-slate-600">{fulfillmentLabels[fulfillmentType]}</p>
          {checkout.product.description ? <p className="mt-5 whitespace-pre-line text-sm leading-7 text-slate-600">{checkout.product.description}</p> : null}
          <div className="mt-5 rounded-xl bg-slate-50 p-4 text-sm text-slate-700">
            <p className="font-semibold">訂單摘要</p>
            <div className="mt-2 flex items-center justify-between gap-4"><span>{checkout.product.name} × 1</span><span className="font-bold">{formatPrice(checkout.product.priceCents, checkout.product.currency)}</span></div>
            {checkout.orderBump ? <p className="mt-3 text-xs leading-5 text-slate-500">可在下一步選擇加購：{checkout.orderBump.name}。</p> : null}
          </div>
        </section>
        <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-7" aria-labelledby="checkout-form-title">
          <h2 id="checkout-form-title" className="text-2xl font-black text-slate-950">確認購買資料</h2>
          <p className="mt-2 mb-6 text-sm leading-6 text-slate-600">送出前會再次確認商品、銷售專案與已發布 Funnel 版本；商品或版本有變更時會要求重新整理。</p>
          <CommerceCheckoutForm
            vendorId={checkout.vendorId}
            productId={checkout.product.id}
            productName={checkout.product.name}
            fulfillmentType={fulfillmentType}
            customCheckoutFields={checkout.product.customCheckoutFields}
            recoveryOnly={checkout.product.inventory <= 0}
            priceCents={checkout.product.priceCents}
            currency={checkout.product.currency}
            formMode={checkout.binding.formMode}
            {...(checkout.orderBump ? { orderBump: { productId: checkout.orderBump.id, title: checkout.orderBump.name, description: checkout.orderBump.description ?? "", priceCents: checkout.orderBump.priceCents } } : {})}
            funnel={{ ...checkout.reference, expectedVersion: checkout.version, expectedProductRevision: checkout.product.revision, ...(checkout.orderBump ? { expectedOrderBumpRevision: checkout.orderBump.revision } : {}) }}
            agreementLabel={checkout.binding.agreement?.label}
          />
        </section>
      </div>
    </main>
  );
}
