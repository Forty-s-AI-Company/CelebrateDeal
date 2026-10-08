"use client";
import { useActionState, useRef, useState } from "react";
import { saveMerchantAffiliatePolicyAction } from "@/app/actions/merchant-affiliate-policy-actions";
import type { MerchantAffiliateTerms } from "@/lib/affiliate-tier-policy";

export function MerchantAffiliatePolicyForm({ initial, revision, csrfToken, csrfFieldName, products }: {
  initial: MerchantAffiliateTerms | null; revision: number; csrfToken: string; csrfFieldName: string; products: Array<{ id: string; name: string }>;
}) {
  const [tiers, setTiers] = useState(initial?.tiers ?? [{ minQuantity: 1, maxQuantity: null, rateBps: 1000 }]);
  const [uplines, setUplines] = useState(initial?.uplines ?? []);
  const [overrides, setOverrides] = useState((initial?.productOverrides ?? []).map((item, index) => ({ ...item, uiId: index })));
  const [maxTotalPercent, setMaxTotalPercent] = useState(String((initial?.maxTotalBps ?? 10000) / 100));
  const nextOverrideId = useRef(overrides.length);
  const [state, action, pending] = useActionState(saveMerchantAffiliatePolicyAction, { message: "", revision: null });
  const inputClass = "min-h-11 w-full rounded border px-3 py-2";
  return <form key={state.revision ?? revision} action={action} className="grid max-w-4xl gap-6 rounded-xl border bg-white p-5">
    <input type="hidden" name={csrfFieldName} value={csrfToken} />
    <input type="hidden" name="expectedRevision" value={state.revision ?? revision} />
    <fieldset disabled={pending} className="grid gap-6">
      <label className="max-w-xs">佣金總比例上限（%）<input className={inputClass} name="maxTotalPercent" type="number" min="0" max="100" step="0.01" required value={maxTotalPercent} onChange={event => setMaxTotalPercent(event.target.value)} /></label>
      <section aria-labelledby="commission-tiers"><h2 id="commission-tiers" className="font-semibold">成交件數階梯</h2><p className="mb-3 text-sm">依新政策開始後累計已付款件數計算，退款不會倒扣件數。最後一階的結束件數留空。</p>
        {tiers.map((tier, index) => <div key={index} className="mb-3 grid gap-3 sm:grid-cols-3">
          <label>第 {index + 1} 階起始件數<input className={inputClass} name="tierStart" aria-label={`第 ${index + 1} 階起始件數`} type="number" min="1" step="1" required value={tier.minQuantity} onChange={event => setTiers(tiers.map((item, position) => position === index ? { ...item, minQuantity: Number(event.target.value) } : item))} /></label>
          <label>第 {index + 1} 階結束件數<input className={inputClass} name="tierEnd" aria-label={`第 ${index + 1} 階結束件數`} type="number" min="1" step="1" value={tier.maxQuantity ?? ""} onChange={event => setTiers(tiers.map((item, position) => position === index ? { ...item, maxQuantity: event.target.value === "" ? null : Number(event.target.value) } : item))} /></label>
          <label>第 {index + 1} 階直接佣金（%）<input className={inputClass} name="tierRate" aria-label={`第 ${index + 1} 階直接佣金（%）`} type="number" min="0" max="100" step="0.01" required value={tier.rateBps / 100} onChange={event => setTiers(tiers.map((item, position) => position === index ? { ...item, rateBps: Math.round(Number(event.target.value) * 100) } : item))} /></label>
        </div>)}
        <div className="flex gap-3"><button type="button" className="min-h-11 rounded border px-3" disabled={tiers.length >= 32} onClick={() => setTiers([...tiers, { minQuantity: (tiers.at(-1)?.maxQuantity ?? tiers.at(-1)!.minQuantity) + 1, maxQuantity: null, rateBps: tiers.at(-1)!.rateBps }])}>新增階梯</button><button type="button" className="min-h-11 rounded border px-3" disabled={tiers.length <= 1} onClick={() => setTiers(tiers.slice(0, -1))}>移除最後階梯</button></div>
      </section>
      <section aria-labelledby="commission-uplines"><h2 id="commission-uplines" className="font-semibold">團隊上線佣金</h2><p className="mb-3 text-sm">沿有效團隊關係固定層級，最多八層；缺少受益人時不會將後續層級往前挪。</p>
        {uplines.map((upline, index) => <label key={index} className="mb-3 block max-w-xs">第 {index + 1} 層佣金（%）<input className={inputClass} name="uplineRate" type="number" min="0" max="100" step="0.01" required value={upline.rateBps / 100} onChange={event => setUplines(uplines.map((item, position) => position === index ? { ...item, rateBps: Math.round(Number(event.target.value) * 100) } : item))} /></label>)}
        <div className="flex gap-3"><button type="button" className="min-h-11 rounded border px-3" disabled={uplines.length >= 8} onClick={() => setUplines([...uplines, { level: uplines.length + 1, rateBps: 0 }])}>新增上線層級</button><button type="button" className="min-h-11 rounded border px-3" disabled={!uplines.length} onClick={() => setUplines(uplines.slice(0, -1))}>移除最後層級</button></div>
      </section>
      <section aria-labelledby="commission-overrides"><h2 id="commission-overrides" className="font-semibold">商品直接佣金</h2><p className="mb-3 text-sm">指定商品取代件數階梯的直接佣金，團隊上線比例仍適用。</p>
        {overrides.map((override, index) => <div key={override.uiId} className="mb-3 grid gap-3 sm:grid-cols-[2fr_1fr_auto]">
          <label>商品 {index + 1}<select name="overrideProduct" aria-label={`佣金商品 ${index + 1}`} className={inputClass} required value={override.productId} onChange={event => setOverrides(overrides.map(item => item.uiId === override.uiId ? { ...item, productId: event.target.value } : item))}><option value="">選擇商品</option>{products.map(product => <option key={product.id} value={product.id}>{product.name}</option>)}</select></label>
          <label>商品 {index + 1} 佣金（%）<input name="overrideRate" className={inputClass} type="number" min="0" max="100" step="0.01" required value={override.rateBps / 100} onChange={event => setOverrides(overrides.map(item => item.uiId === override.uiId ? { ...item, rateBps: Math.round(Number(event.target.value) * 100) } : item))} /></label>
          <button type="button" className="min-h-11 self-end rounded border px-3" onClick={() => setOverrides(overrides.filter((_, position) => position !== index))}>移除商品 {index + 1}</button>
        </div>)}
        <button type="button" className="min-h-11 rounded border px-3" disabled={overrides.length >= 200 || !products.length} onClick={() => setOverrides([...overrides, { productId: "", rateBps: 0, uiId: nextOverrideId.current++ }])}>新增商品佣金</button>
      </section>
      <div className="flex flex-wrap gap-3"><button name="intent" value="publish" className="min-h-11 rounded bg-blue-700 px-4 text-white">{pending ? "處理中…" : "發布佣金政策"}</button><button name="intent" value="pause" formNoValidate className="min-h-11 rounded border px-4" disabled={(state.revision ?? revision) === 0}>暫停新結帳政策</button></div>
    </fieldset>
    {state.message ? <p role="status" aria-live="polite">{state.message}</p> : null}
  </form>;
}
