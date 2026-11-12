"use client";

import Link from "next/link";
import { FunnelCommerceBindingSchema, type FunnelCommerceBinding, type FunnelCommerceProduct } from "@/lib/funnel-commerce";
import { formatCurrency } from "@/lib/format";

const control = "min-h-10 rounded-lg border border-slate-500 bg-white px-3 text-sm disabled:opacity-50";

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
        {products.map((item) => <option key={item.id} value={item.id}>{item.name} — {formatCurrency(item.priceCents, item.currency)}</option>)}
      </select>
    </label>
    {!products.length ? <p role="status" className="text-xs leading-5 text-amber-900">此專案沒有可結帳商品。請先在商品管理建立商品、連結至此專案，並確認庫存與交付設定。</p> : null}
    {binding ? <>
      <label className="grid gap-1 text-xs font-semibold">加購商品（選填）<select className={control} value={binding.orderBumpProductId ?? ""} onChange={(event) => update({ orderBumpProductId: event.currentTarget.value || undefined })}>
        <option value="">不提供加購</option>
        {products.filter((item) => item.id !== binding.productId && item.currency === product?.currency && (product?.fulfillmentType === "physical" || item.fulfillmentType !== "physical")).map((item) => <option key={item.id} value={item.id}>{item.name} — {formatCurrency(item.priceCents, item.currency)}</option>)}
      </select></label>
      <label className="grid gap-1 text-xs font-semibold">結帳版面<select className={control} value={binding.formMode} onChange={(event) => update({ formMode: event.currentTarget.value as FunnelCommerceBinding["formMode"] })}><option value="single">單頁結帳</option><option value="two_step">兩步驟：聯絡資料 → 訂單確認</option></select></label>
      <label className="grid gap-1 text-xs font-semibold">額外同意條款（選填）<textarea className={control} maxLength={500} value={binding.agreement?.label ?? ""} onChange={(event) => update({ agreement: event.currentTarget.value.trim() ? { label: event.currentTarget.value } : undefined })} /></label>
    </> : null}
    <p className="text-xs leading-5 text-slate-600">價格與幣別以商品管理為準。儲存並發布後，付款元件會連往此步驟的安全結帳頁；預覽不會收款。</p>
  </fieldset>;
}

/**
 * In-place product picker in a checkout element's settings. It writes the
 * same page-level binding as 頁面設定 › 商品與結帳 (`document.commerce`), offers
 * only the server's catalog projection for this project (ready, sellable,
 * same vendor) and stores only the product id: prices are display copies, and
 * the server re-validates the binding on every save and publish.
 */
export function FunnelCommerceQuickBind({ enabled, binding, products, disabled, onChange, onOpenSettings }: {
  enabled: boolean;
  binding?: FunnelCommerceBinding;
  products: FunnelCommerceProduct[];
  disabled?: boolean;
  onChange: (binding: FunnelCommerceBinding | undefined) => void;
  onOpenSettings: () => void;
}) {
  if (!enabled) return <p data-funnel-commerce-quick-bind="disabled" className="mb-4 rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs leading-5 text-slate-700">結帳元件只在「訂單表單」步驟連結商品。請在網站管理把這個頁面設為訂單表單步驟，或改在訂單表單步驟加入結帳元件。</p>;
  const product = products.find((item) => item.id === binding?.productId);
  const state = !binding ? "unbound" : product ? "bound" : "unavailable";
  const select = (productId: string) => onChange(productId ? { schemaVersion: 1, productId, formMode: binding?.formMode ?? "single", ...(binding?.agreement ? { agreement: binding.agreement } : {}) } : undefined);
  return <fieldset data-funnel-commerce-quick-bind={state} disabled={disabled} className={`mb-4 grid gap-2 rounded-lg border p-3 ${state === "bound" ? "border-slate-200" : "border-amber-300 bg-amber-50"}`}>
    <legend className="px-1 text-sm font-bold text-slate-900">結帳商品</legend>
    {state === "unbound" ? <p className="text-xs leading-5 text-amber-900">這個頁面還沒有連結商品，訪客無法結帳。選擇商品後會隨草稿儲存，這個頁面的所有結帳元件都使用同一個商品。</p> : null}
    {state === "unavailable" ? <p className="text-xs leading-5 text-amber-900">已連結的商品目前無法販售（可能已下架、售完或不屬於這個專案），請重新選擇。</p> : null}
    <label className="grid gap-1 text-xs font-semibold text-slate-700">{state === "bound" ? "目前商品" : "選擇商品"}
      <select className={control} value={binding?.productId ?? ""} onChange={(event) => select(event.currentTarget.value)}>
        <option value="">{state === "unbound" ? "請選擇商品" : "不連結商品"}</option>
        {binding && !product ? <option value={binding.productId}>已連結商品目前無法販售</option> : null}
        {products.map((item) => <option key={item.id} value={item.id}>{item.name} — {formatCurrency(item.priceCents, item.currency)}</option>)}
      </select>
    </label>
    {!products.length ? <p role="status" className="text-xs leading-5 text-amber-900">這個專案沒有可結帳的商品。請先到<Link className="mx-1 font-semibold underline" href="/products">商品管理</Link>建立商品、連結到這個專案，並確認庫存與交付設定。</p> : null}
    <button type="button" onClick={onOpenSettings} className="justify-self-start text-xs font-semibold text-blue-700 underline">加購、結帳版面與同意條款在頁面設定</button>
  </fieldset>;
}
