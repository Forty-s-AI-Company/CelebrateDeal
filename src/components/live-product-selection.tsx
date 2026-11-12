"use client";

import { useId, useState, useSyncExternalStore, type ReactNode } from "react";

export type LiveProductSelectionOption = { id: string; name: string; inventory: number };

const subscribeNever = () => () => {};
const productIdSelectorPattern = /^[A-Za-z0-9_-]{1,128}$/u;

/** The checkbox of one product option, for focusing it; the products block when the id is not selector-safe. */
export function productCheckboxSelector(productId: string) {
  return productIdSelectorPattern.test(productId)
    ? `input[type="checkbox"][data-live-product-option="${productId}"]`
    : '[data-readiness-focus="products"]';
}

/**
 * The selection keeps the order the merchant ticked the products in; the first
 * one is bound as the Live's pinned (主打) product. Ticking appends, unticking
 * removes, so the pinned product only changes when the merchant unticks it or
 * pins another one.
 */
export function updateSelectedProductIds(currentIds: string[], productId: string, checked: boolean) {
  if (!checked) return currentIds.filter((currentProductId) => currentProductId !== productId);
  return currentIds.includes(productId) ? currentIds : [...currentIds, productId];
}

/** Moves one selected product to the front, which makes it the pinned product; the rest keep their order. */
export function pinSelectedProductId(currentIds: string[], productId: string) {
  if (!currentIds.includes(productId) || currentIds[0] === productId) return currentIds;
  return [productId, ...currentIds.filter((currentProductId) => currentProductId !== productId)];
}

/** The selected products that are offered, in selection order: exactly what the form submits. */
export function submittedProductIds(products: LiveProductSelectionOption[], selectedProductIds: string[]) {
  const listed = new Set(products.map((product) => product.id));
  return [...new Set(selectedProductIds)].filter((productId) => listed.has(productId));
}

const pinBadgeClass = "inline-flex min-h-7 items-center rounded-full border border-blue-200 bg-blue-50 px-2.5 text-xs font-semibold text-blue-900";
const pinButtonClass = "inline-flex min-h-11 items-center justify-center rounded-md border border-border bg-white px-3 text-sm font-semibold text-slate-700 hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50";

/**
 * 成交 step's product list. The visible checkboxes have no `name`: the
 * submitted `productIds` are hidden fields in selection order, so the first
 * one, the pinned product, is the merchant's choice and not the list order.
 * Those hidden fields follow the checkboxes only once React runs, so before
 * hydration the checkboxes and pin buttons are disabled and a submit sends the
 * server's selection unchanged.
 */
export function LiveProductSelection({
  products,
  selectedProductIds,
  onSelectionChange,
  onPin,
  actions,
}: {
  products: LiveProductSelectionOption[];
  selectedProductIds: string[];
  onSelectionChange: (productId: string, checked: boolean) => void;
  onPin: (productId: string) => void;
  /** 新增商品 and the full editor link, below the list. */
  actions?: ReactNode;
}) {
  const hydrated = useSyncExternalStore(subscribeNever, () => true, () => false);
  const idPrefix = useId();
  const [message, setMessage] = useState("");
  const orderedIds = submittedProductIds(products, selectedProductIds);
  const names = new Map(products.map((product) => [product.id, product.name]));
  const nameOf = (productId: string | undefined) => (productId ? names.get(productId) ?? "" : "");

  function toggle(productId: string, checked: boolean) {
    const pinnedId = orderedIds[0];
    if (!checked && productId === pinnedId && orderedIds[1]) {
      setMessage(`已取消勾選「${nameOf(productId)}」，「${nameOf(orderedIds[1])}」成為置頂商品。`);
    } else if (checked && orderedIds.length === 0) {
      setMessage(`「${nameOf(productId)}」是置頂商品。`);
    } else {
      setMessage("");
    }
    onSelectionChange(productId, checked);
  }

  function pin(productId: string, checkbox: HTMLInputElement | null) {
    onPin(productId);
    setMessage(`已將「${nameOf(productId)}」設為置頂商品。`);
    // The pin button leaves this row once it is pinned; keep focus on the row.
    checkbox?.focus();
  }

  return (
    <>
      {orderedIds.map((productId) => <input key={productId} type="hidden" name="productIds" value={productId} />)}
      {products.length === 0 ? (
        <p className="rounded-md bg-slate-50 px-4 py-3 text-sm text-slate-600">
          目前沒有可綁定的啟用商品，可以在這裡直接建立；內容型直播也可以不選商品，先建立草稿。
        </p>
      ) : (
        <>
          <p className="text-sm text-slate-600">
            商品依勾選順序排列，第一個是直播間的置頂（主打）商品；按「設為置頂」可以改變置頂商品。
          </p>
          {hydrated ? null : <p data-live-product-loading="" className="text-xs text-slate-600">頁面載入完成後才能修改商品勾選。</p>}
          <ul className="grid gap-2">
            {products.map((product, index) => {
              const position = orderedIds.indexOf(product.id);
              const checkboxId = `${idPrefix}-option-${index}`;
              const orderId = `${checkboxId}-order`;
              return (
                <li key={product.id} data-live-product-row={product.id} className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-border p-3">
                  <label htmlFor={checkboxId} className="flex min-w-0 flex-1 items-center gap-3">
                    {/* Controlled and without a name: the hidden productIds fields above carry the order. */}
                    <input
                      id={checkboxId}
                      type="checkbox"
                      value={product.id}
                      data-live-product-option={product.id}
                      checked={position >= 0}
                      disabled={!hydrated}
                      aria-describedby={position >= 0 ? orderId : undefined}
                      onChange={(event) => toggle(product.id, event.target.checked)}
                      className="h-5 w-5 shrink-0 accent-blue-600"
                    />
                    <span className="min-w-0">
                      <span className="block text-sm font-semibold text-slate-900">{product.name}</span>
                      <span className="block text-xs text-slate-500">庫存 {product.inventory}</span>
                    </span>
                  </label>
                  {position === 0 ? (
                    <span id={orderId} data-live-product-pinned="" className={pinBadgeClass}>置頂</span>
                  ) : position > 0 ? (
                    <span className="flex items-center gap-2">
                      <span id={orderId} className="text-xs text-slate-600">第 {position + 1} 個</span>
                      <button
                        type="button"
                        disabled={!hydrated}
                        onClick={(event) => pin(product.id, event.currentTarget.closest("li")?.querySelector<HTMLInputElement>('input[type="checkbox"]') ?? null)}
                        className={pinButtonClass}
                      >
                        設為置頂<span className="sr-only">：{product.name}</span>
                      </button>
                    </span>
                  ) : null}
                </li>
              );
            })}
          </ul>
          <p role="status" aria-live="polite" data-live-product-order-status="" className="sr-only">{message}</p>
        </>
      )}
      {actions}
    </>
  );
}
