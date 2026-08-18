import Image from "next/image";
import { notFound, redirect } from "next/navigation";
import { CommerceCheckoutForm } from "@/components/commerce-checkout-form";
import type { CommerceCheckoutFulfillmentType } from "@/lib/commerce-checkout";
import { safeParseCustomCheckoutFields } from "@/lib/commerce-custom-checkout";
import { getDb } from "@/lib/db";
import { parseSafeExternalHttpUrl } from "@/lib/external-url";

const fulfillmentLabels: Record<CommerceCheckoutFulfillmentType, string> = {
  physical: "實體商品 · 付款後由商家安排出貨",
  digital: "數位內容 · 付款後由商家提供存取權",
  service: "預約服務 · 付款後由商家聯繫排程",
  course: "課程 · 付款後由商家開通權益",
};

function formatPrice(priceCents: number, currency: string) {
  return new Intl.NumberFormat("zh-TW", {
    style: "currency",
    currency,
    maximumFractionDigits: 0,
  }).format(priceCents / 100);
}

export default async function CommerceCheckoutPage({
  params,
}: {
  params: Promise<{ vendorId: string; productId: string }>;
}) {
  const { vendorId, productId } = await params;
  const product = await getDb().product.findFirst({
    where: { id: productId, vendorId, isActive: true, fulfillmentTypeConfirmed: true, priceCents: { gt: 0 } },
    select: {
      id: true,
      vendorId: true,
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
  if (product.checkoutUrl) {
    const externalCheckoutUrl = parseSafeExternalHttpUrl(product.checkoutUrl);
    if (!externalCheckoutUrl) notFound();
    redirect(externalCheckoutUrl);
  }
  if (
    product.fulfillmentType !== "physical"
    && (
      product.deliveryConfig?.status !== "active"
      || product.deliveryConfig.fulfillmentType !== product.fulfillmentType
    )
  ) {
    notFound();
  }

  const fulfillmentType = product.fulfillmentType as CommerceCheckoutFulfillmentType;
  const isAvailable = product.inventory > 0;
  const customCheckoutFields = safeParseCustomCheckoutFields(product.customCheckoutFields);
  if (!customCheckoutFields.success) notFound();

  return (
    <main className="min-h-screen bg-slate-100 px-4 py-8 sm:py-12">
      <div className="mx-auto grid w-full max-w-5xl gap-6 lg:grid-cols-[minmax(0,0.82fr)_minmax(0,1.18fr)] lg:items-start">
        <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm" aria-labelledby="checkout-product-title">
          {product.imageUrl ? (
            <div className="relative aspect-[4/3] bg-slate-100">
              <Image src={product.imageUrl} alt={product.name} fill unoptimized className="object-cover" priority />
            </div>
          ) : (
            <div className="grid aspect-[4/3] place-items-center bg-gradient-to-br from-blue-100 to-slate-100 px-8 text-center text-sm font-semibold text-slate-500">
              商品圖片尚未提供
            </div>
          )}
          <div className="p-5 sm:p-6">
            <p className="text-sm font-semibold text-blue-700">{product.vendor.name}</p>
            <h1 id="checkout-product-title" className="mt-2 text-2xl font-black tracking-tight text-slate-950 sm:text-3xl">
              {product.name}
            </h1>
            <p className="mt-3 text-2xl font-black text-slate-950">{formatPrice(product.priceCents, product.currency)}</p>
            <p className="mt-2 text-sm font-medium text-slate-600">{fulfillmentLabels[fulfillmentType]}</p>
            {product.description ? <p className="mt-5 whitespace-pre-line text-sm leading-7 text-slate-600">{product.description}</p> : null}
            <div className="mt-5 rounded-xl bg-slate-50 p-4 text-sm text-slate-700">
              <p className="font-semibold">訂單摘要</p>
              <div className="mt-2 flex items-center justify-between gap-4">
                <span>{product.name} × 1</span>
                <span className="font-bold">{formatPrice(product.priceCents, product.currency)}</span>
              </div>
            </div>
          </div>
        </section>

        <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-7" aria-labelledby="checkout-form-title">
          <p className="text-xs font-bold uppercase tracking-[0.2em] text-blue-700">安全結帳</p>
          <h2 id="checkout-form-title" className="mt-2 text-2xl font-black text-slate-950">確認購買資料</h2>
          <p className="mt-2 mb-6 text-sm leading-6 text-slate-600">先建立可追蹤訂單，再前往金流商付款。重新送出相同請求不會重複建立訂單。</p>

          <CommerceCheckoutForm
            vendorId={product.vendorId}
            productId={product.id}
            productName={product.name}
            fulfillmentType={fulfillmentType}
            customCheckoutFields={customCheckoutFields.data}
            recoveryOnly={!isAvailable}
          />
        </section>
      </div>
    </main>
  );
}
