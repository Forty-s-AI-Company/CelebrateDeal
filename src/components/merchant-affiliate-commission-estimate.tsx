"use client";
import { useId, useState } from "react";
import type { MerchantAffiliateTerms } from "@/lib/affiliate-tier-policy";
import { formatTwd } from "@/lib/format";
import { bpsToPercentText } from "@/lib/percent-bps";
import { estimateMerchantAffiliateCommission, MAX_ESTIMATE_QUANTITY, summarizeEstimateRates, type CommissionEstimateInput } from "@/lib/merchant-affiliate-policy-draft";

const inputClass = "min-h-11 w-full rounded border border-border-control px-3 py-2 focus:border-primary";
const money = (cents: number) => formatTwd(cents, { fractionDigits: 2 });

/**
 * 唯讀佣金試算：依表單目前的設定（`terms`，不合法時為 null），直接呼叫伺服器結算用的
 * `calculateMerchantAffiliatePlan`。放在 `<form>` 外面，所有輸入都沒有 name，不會被送出。
 */
export function MerchantAffiliateCommissionEstimate({ terms, products }: {
  terms: MerchantAffiliateTerms | null;
  /** 目前設有商品佣金的商品，供選擇套用。 */
  products: Array<{ id: string; name: string }>;
}) {
  const id = useId();
  const [input, setInput] = useState<CommissionEstimateInput>({ quantity: "10", unitPrice: "1000", soldBefore: "0", productId: "" });
  // 商品佣金被移除後，自動回到「不指定商品」。
  const productId = products.some(product => product.id === input.productId) ? input.productId : "";
  const result = estimateMerchantAffiliateCommission(terms, { ...input, productId });
  const set = (key: keyof CommissionEstimateInput) => (event: { target: { value: string } }) => setInput(current => ({ ...current, [key]: event.target.value }));
  const errorFor = (field: "quantity" | "unitPrice" | "soldBefore") => result.kind === "invalid-input" && result.field === field ? result.message : null;
  const describedBy = (field: "quantity" | "unitPrice" | "soldBefore") => errorFor(field) ? `${id}-${field}-error` : undefined;
  return <section id="policy-estimate" aria-labelledby={`${id}-title`} className="grid scroll-mt-6 gap-4 rounded-xl border border-slate-200 bg-white p-5 lg:sticky lg:top-6">
    <header className="grid gap-1">
      <h2 id={`${id}-title`} className="text-base font-semibold text-slate-900">佣金試算</h2>
      <p className="text-sm text-slate-600">依左側目前的設定（尚未發布也會反映）估算一筆付款的佣金。</p>
    </header>
    <div className="grid grid-cols-2 gap-3">
      <div className="grid gap-1.5">
        <label className="grid gap-1 text-sm font-medium text-slate-800">賣出件數
          <input className={inputClass} type="text" inputMode="numeric" autoComplete="off" value={input.quantity} onChange={set("quantity")} aria-invalid={errorFor("quantity") ? true : undefined} aria-describedby={describedBy("quantity")} />
        </label>
        {errorFor("quantity") ? <span id={`${id}-quantity-error`} className="text-xs font-medium text-red-700">{errorFor("quantity")}</span> : null}
      </div>
      <div className="grid gap-1.5">
        <label className="grid gap-1 text-sm font-medium text-slate-800">單價（元）
          <input className={inputClass} type="text" inputMode="decimal" autoComplete="off" value={input.unitPrice} onChange={set("unitPrice")} aria-invalid={errorFor("unitPrice") ? true : undefined} aria-describedby={describedBy("unitPrice")} />
        </label>
        {errorFor("unitPrice") ? <span id={`${id}-unitPrice-error`} className="text-xs font-medium text-red-700">{errorFor("unitPrice")}</span> : null}
      </div>
    </div>
    <div className="grid gap-1.5">
      <label className="grid gap-1 text-sm font-medium text-slate-800">推廣者先前已累計件數
        <input className={inputClass} type="text" inputMode="numeric" autoComplete="off" value={input.soldBefore} onChange={set("soldBefore")} aria-invalid={errorFor("soldBefore") ? true : undefined} aria-describedby={[describedBy("soldBefore"), `${id}-sold-hint`].filter(Boolean).join(" ")} />
      </label>
      <span id={`${id}-sold-hint`} className="text-xs text-slate-600">階梯依新政策開始後的累計已付款件數決定；0 代表第一筆。</span>
      {errorFor("soldBefore") ? <span id={`${id}-soldBefore-error`} className="text-xs font-medium text-red-700">{errorFor("soldBefore")}</span> : null}
    </div>
    {products.length ? <div className="grid gap-1">
      {/* 選單不包在 <label> 裡：否則標籤文字會連同選項文字一起算進名稱。 */}
      <label htmlFor={`${id}-product`} className="text-sm font-medium text-slate-800">套用商品佣金</label>
      <select id={`${id}-product`} className={inputClass} value={productId} onChange={set("productId")}>
        <option value="">不指定商品（依件數階梯）</option>
        {products.map(product => <option key={product.id} value={product.id}>{product.name}</option>)}
      </select>
    </div> : null}
    <div aria-live="polite" data-commission-estimate={result.kind} className="grid gap-2 rounded-md bg-slate-50 p-3 text-sm">
      {result.kind === "invalid-policy" ? <p>左側設定有需要修正的欄位，修正後才會顯示試算。</p> : null}
      {result.kind === "invalid-input" ? <p>請先修正試算條件。</p> : null}
      {result.kind === "ok" ? <>
        <dl className="grid gap-1">
          {result.plan.recipients.map(recipient => <div key={recipient.level} className="flex justify-between gap-3">
            <dt>{recipient.level === 0 ? "推廣者（直接）" : `第 ${recipient.level} 層上線`}</dt>
            <dd className="font-semibold tabular-nums" data-estimate-level={recipient.level}>{money(recipient.amountCents)}</dd>
          </div>)}
          <div className="flex justify-between gap-3 border-t border-slate-200 pt-1">
            <dt>佣金合計</dt>
            <dd className="font-semibold tabular-nums" data-estimate-total="">{money(result.plan.commissionAmountCents)}</dd>
          </div>
        </dl>
        <p className="text-xs text-slate-600">訂單金額 {money(result.plan.grossAmountCents)}；{summarizeEstimateRates(result.plan).map(segment => `第 ${segment.from === segment.to ? segment.from : `${segment.from}–${segment.to}`} 件 ${bpsToPercentText(segment.rateBps)}%`).join("、")}。</p>
      </> : null}
    </div>
    <p className="text-xs text-slate-600">僅供估算，實際依結算為準。試算把 {MAX_ESTIMATE_QUANTITY} 件以內視為同一筆付款、假設每一層上線都有人；實際依每筆付款分別計算與四捨五入，退款與團隊關係也會影響金額。</p>
  </section>;
}
