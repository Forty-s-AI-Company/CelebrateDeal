"use client";

import { type KeyboardEvent, useEffect, useRef, useState } from "react";
import {
  DiscountCodePreviewResponseSchema,
  discountCodeErrorMessage,
  readCheckoutErrorCode,
  type DiscountCodePreview,
} from "@/lib/commerce-checkout";
import { formatCurrency } from "@/lib/format";

export const DISCOUNT_CODE_INPUT_NAME = "discountCodeInput";

/**
 * A4-01 buyer input. The preview is display only: the checkout request sends
 * the code plus the shown discount, and the server refuses the order if its
 * own calculation differs.
 */
export function CheckoutDiscountCodeField({
  vendorId,
  productId,
  orderBumpProductId,
  prefillCode,
  disabled,
  applied,
  onAppliedChange,
}: {
  vendorId: string;
  productId: string;
  orderBumpProductId?: string;
  prefillCode?: string;
  disabled: boolean;
  applied: DiscountCodePreview | null;
  onAppliedChange: (preview: DiscountCodePreview | null) => void;
}) {
  const [input, setInput] = useState(prefillCode ?? "");
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState("");
  const appliedCode = applied?.code ?? null;
  const lastBump = useRef(orderBumpProductId);

  async function apply(code: string) {
    const trimmed = code.trim();
    if (!trimmed) {
      setError("請輸入折扣碼。");
      return;
    }
    setChecking(true);
    setError("");
    try {
      const response = await fetch("/api/payments/checkout/discount-code", {
        method: "POST",
        headers: { "content-type": "application/json", "x-celebratedeal-client": "web" },
        body: JSON.stringify({ vendorId, productId, discountCode: trimmed, ...(orderBumpProductId ? { orderBumpProductId } : {}) }),
      });
      if (!response.ok) {
        onAppliedChange(null);
        setError(response.status === 429 ? "嘗試太多次，請稍候再試。" : discountCodeErrorMessage(await readCheckoutErrorCode(response)));
        return;
      }
      const parsed = DiscountCodePreviewResponseSchema.safeParse(await response.json());
      if (!parsed.success) {
        onAppliedChange(null);
        setError(discountCodeErrorMessage(undefined));
        return;
      }
      onAppliedChange(parsed.data);
    } catch {
      onAppliedChange(null);
      setError(discountCodeErrorMessage(undefined));
    } finally {
      setChecking(false);
    }
  }

  // A merchant-chosen code (editor coupon element) is checked once on load.
  useEffect(() => {
    if (!prefillCode) return;
    let cancelled = false;
    queueMicrotask(() => { if (!cancelled) void apply(prefillCode); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only the initial prefill
  }, []);

  // The minimum spend counts the order bump, so re-check when it changes.
  useEffect(() => {
    if (lastBump.current === orderBumpProductId) return;
    lastBump.current = orderBumpProductId;
    if (!appliedCode) return;
    let cancelled = false;
    queueMicrotask(() => { if (!cancelled) void apply(appliedCode); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- re-run only for the bump
  }, [orderBumpProductId]);

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    // Enter applies the code instead of submitting the whole checkout.
    if (event.key !== "Enter") return;
    event.preventDefault();
    if (!checking) void apply(input);
  }

  function remove() {
    setInput("");
    setError("");
    onAppliedChange(null);
  }

  return (
    <fieldset className="grid gap-2 rounded-xl border border-slate-200 bg-white p-4" disabled={disabled}>
      <legend className="px-1 text-base font-bold text-slate-950">折扣碼</legend>
      <div className="flex flex-col gap-2 sm:flex-row">
        <label className="min-w-0 flex-1 text-sm font-semibold text-slate-800">
          <span className="sr-only">折扣碼</span>
          <input
            name={DISCOUNT_CODE_INPUT_NAME}
            value={input}
            onChange={(event) => { setInput(event.currentTarget.value); setError(""); }}
            onKeyDown={handleKeyDown}
            autoComplete="off"
            autoCapitalize="characters"
            spellCheck={false}
            maxLength={32}
            placeholder="輸入折扣碼"
            aria-invalid={error ? true : undefined}
            aria-describedby="checkout-discount-code-status"
            className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-base uppercase text-slate-950 shadow-sm placeholder:normal-case placeholder:text-slate-500 focus:border-blue-500"
          />
        </label>
        {applied && input.trim().toUpperCase() === applied.code.toUpperCase()
          ? <button type="button" onClick={remove} className="min-h-11 rounded-lg border border-slate-300 px-4 text-sm font-semibold text-slate-800">移除</button>
          : <button type="button" onClick={() => void apply(input)} disabled={checking} className="min-h-11 rounded-lg bg-slate-900 px-4 text-sm font-semibold text-white disabled:opacity-60">{checking ? "確認中…" : "套用"}</button>}
      </div>
      <p id="checkout-discount-code-status" role={error ? "alert" : "status"} aria-live="polite" className={`text-sm ${error ? "text-red-700" : "text-emerald-800"}`}>
        {error || (applied ? `已套用 ${applied.code}，折抵 ${formatCurrency(applied.discountAmountCents, applied.currency)}（只折抵主商品）。` : "")}
      </p>
    </fieldset>
  );
}
