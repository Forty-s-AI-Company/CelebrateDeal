"use client";

import { FunnelCommerceBindingSchema, type FunnelCommerceBinding, type FunnelCommerceProduct } from "@/lib/funnel-commerce";

const control = "min-h-10 rounded-lg border border-slate-300 bg-white px-3 text-sm disabled:opacity-50";

/** Prices are read-only catalog projections; only references enter the document. */
export function FunnelCommerceSettings({ binding, products, disabled, onChange }: {
  binding?: FunnelCommerceBinding;
  products: FunnelCommerceProduct[];
  disabled?: boolean;
  onChange: (binding: FunnelCommerceBinding | undefined) => void;
}) {
  const product = products.find((item) => item.id === binding?.productId);
  const update = (patch: Partial<FunnelCommerceBinding>) => {
    const parsed = FunnelCommerceBindingSchema.safeParse({ ...binding, ...patch });
    if (parsed.success) onChange(parsed.data);
  };
  return <fieldset disabled={disabled} className="grid gap-3 rounded-xl border border-blue-200 bg-blue-50 p-3">
    <legend className="px-1 text-sm font-bold text-blue-900">商品與結帳</legend>
    <label className="grid gap-1 text-xs font-semibold">本步驟商品
      <select className={control} value={binding?.productId ?? ""} onChange={(event) => {
        const productId = event.currentTarget.value;
        onChange(productId ? { schemaVersion: 1, productId, formMode: binding?.formMode ?? "single", ...(binding?.agreement ? { agreement: binding.agreement } : {}) } : undefined);
      }}>
        <option value="">請選擇商品</option>
        {binding && !product ? <option value={binding.productId}>已綁定商品目前不可用，請重新選擇</option> : null}
        {products.map((item) => <option key={item.id} value={item.id}>{item.name} — {item.currency} {(item.priceCents / 100).toLocaleString("zh-TW")}</option>)}
      </select>
    </label>
    {!products.length ? <p role="status" className="text-xs leading-5 text-amber-900">此專案沒有可結帳商品。請先在商品管理建立商品、連結至此專案，並確認庫存與交付設定。</p> : null}
    {binding ? <>
      <label className="grid gap-1 text-xs font-semibold">加購商品（選填）<select className={control} value={binding.orderBumpProductId ?? ""} onChange={(event) => update({ orderBumpProductId: event.currentTarget.value || undefined })}>
        <option value="">不提供加購</option>
        {products.filter((item) => item.id !== binding.productId && item.currency === product?.currency && (product?.fulfillmentType === "physical" || item.fulfillmentType !== "physical")).map((item) => <option key={item.id} value={item.id}>{item.name} — {item.currency} {(item.priceCents / 100).toLocaleString("zh-TW")}</option>)}
      </select></label>
      <label className="grid gap-1 text-xs font-semibold">結帳版面<select className={control} value={binding.formMode} onChange={(event) => update({ formMode: event.currentTarget.value as FunnelCommerceBinding["formMode"] })}><option value="single">單頁結帳</option><option value="two_step">兩步驟：聯絡資料 → 訂單確認</option></select></label>
      <label className="grid gap-1 text-xs font-semibold">額外同意條款（選填）<textarea className={control} maxLength={500} value={binding.agreement?.label ?? ""} onChange={(event) => update({ agreement: event.currentTarget.value.trim() ? { label: event.currentTarget.value } : undefined })} /></label>
    </> : null}
    <p className="text-xs leading-5 text-slate-600">價格與幣別以商品管理為準。儲存並發布後，付款元件會連往此步驟的安全結帳頁；預覽不會收款。</p>
  </fieldset>;
}
