"use client";

import { useMemo, useState } from "react";
import { simulateTieredCommission, type TieredCommissionTier } from "@/lib/tiered-commission-engine";

const NHI_WITHHOLDING_RATE = 0.0211;
const DEFAULT_TIERS: readonly TieredCommissionTier[] = [
  { minQuantity: 1, maxQuantity: 5, rateBps: 1_500 },
  { minQuantity: 6, maxQuantity: 20, rateBps: 2_000 },
  { minQuantity: 21, maxQuantity: null, rateBps: 2_500 },
];

function formatTwd(cents: number) {
  return new Intl.NumberFormat("zh-TW", { style: "currency", currency: "TWD", maximumFractionDigits: 0 }).format(cents / 100);
}

export function CommissionSimulator({
  policyVersion = 1,
  tiers = DEFAULT_TIERS,
}: {
  policyVersion?: number;
  tiers?: readonly TieredCommissionTier[];
}) {
  const [unitPrice, setUnitPrice] = useState(3_000);
  const [orderCount, setOrderCount] = useState(20);
  const result = useMemo(() => {
    const commission = simulateTieredCommission({
      unitPriceCents: unitPrice * 100,
      quantity: orderCount,
      policy: { version: policyVersion, tiers },
    });
    const nhiWithholdingCents = Math.round(commission.totalCommissionAmountCents * NHI_WITHHOLDING_RATE);
    const netMerchantProfitCents = commission.grossSalesAmount - commission.totalCommissionAmountCents - nhiWithholdingCents;
    return {
      ...commission,
      nhiWithholdingCents,
      netMerchantProfitCents,
      profitMargin: commission.grossSalesAmount === 0 ? 0 : (netMerchantProfitCents / commission.grossSalesAmount) * 100,
    };
  }, [orderCount, policyVersion, tiers, unitPrice]);
  const commissionShare = (result.totalCommissionAmountCents / result.grossSalesAmount) * 100;
  const nhiShare = (result.nhiWithholdingCents / result.grossSalesAmount) * 100;
  const netShare = Math.max(0, (result.netMerchantProfitCents / result.grossSalesAmount) * 100);

  return (
    <section aria-labelledby="commission-simulator-title" className="rounded-xl border border-border bg-white p-5 shadow-sm">
      <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 id="commission-simulator-title" className="text-lg font-semibold text-slate-950">即時利潤試算模擬器</h2>
          <p className="mt-1 text-sm text-slate-600">拖動滑桿即可在瀏覽器內試算，不會建立訂單或呼叫伺服器。</p>
        </div>
        <span className="rounded-full bg-indigo-50 px-3 py-1 text-xs font-semibold text-indigo-700">規則 v{policyVersion}</span>
      </div>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
        <div className="grid gap-5">
          <label className="grid gap-2 text-sm font-medium text-slate-800">
            <span className="flex justify-between gap-3"><span>課程單價</span><output htmlFor="course-price">{formatTwd(unitPrice * 100)}</output></span>
            <input id="course-price" aria-label="課程單價" type="range" min={500} max={50_000} step={100} value={unitPrice} onChange={(event) => setUnitPrice(Number(event.currentTarget.value))} className="w-full accent-indigo-600" />
            <span className="flex justify-between text-xs font-normal text-slate-500"><span>NT$500</span><span>NT$50,000</span></span>
          </label>
          <label className="grid gap-2 text-sm font-medium text-slate-800">
            <span className="flex justify-between gap-3"><span>預估推廣成交單數</span><output htmlFor="order-count">{orderCount} 件</output></span>
            <input id="order-count" aria-label="預估推廣成交單數" type="range" min={1} max={200} step={1} value={orderCount} onChange={(event) => setOrderCount(Number(event.currentTarget.value))} className="w-full accent-indigo-600" />
            <span className="flex justify-between text-xs font-normal text-slate-500"><span>1 件</span><span>200 件</span></span>
          </label>
        </div>

        <div>
          <dl className="grid grid-cols-2 gap-3 text-sm">
            <div className="rounded-lg bg-slate-50 p-3"><dt className="text-slate-500">總營業額</dt><dd data-testid="gross-revenue" className="mt-1 text-lg font-semibold text-slate-950">{formatTwd(result.grossSalesAmount)}</dd></div>
            <div className="rounded-lg bg-amber-50 p-3"><dt className="text-amber-700">夥伴分潤總支出</dt><dd data-testid="affiliate-commission" className="mt-1 text-lg font-semibold text-amber-900">{formatTwd(result.totalCommissionAmountCents)}</dd></div>
            <div className="rounded-lg bg-rose-50 p-3"><dt className="text-rose-700">預估二代健保代扣費（2.11%）</dt><dd data-testid="nhi-withholding" className="mt-1 text-lg font-semibold text-rose-900">{formatTwd(result.nhiWithholdingCents)}</dd></div>
            <div className="rounded-lg bg-emerald-50 p-3"><dt className="text-emerald-700">主辦方淨收益</dt><dd data-testid="merchant-profit" className="mt-1 text-lg font-semibold text-emerald-900">{formatTwd(result.netMerchantProfitCents)}</dd></div>
          </dl>
          <p className="mt-4 text-sm text-slate-600">淨毛利率 <strong data-testid="profit-margin" className="text-base text-slate-950">{result.profitMargin.toFixed(2)}%</strong></p>
          <div aria-label="營業額分配比例" className="mt-2 flex h-4 overflow-hidden rounded-full bg-slate-100">
            <div title={`分潤支出 ${commissionShare.toFixed(2)}%`} data-testid="commission-bar" className="bg-amber-400 transition-[width]" style={{ width: `${commissionShare}%` }} />
            <div title={`二代健保 ${nhiShare.toFixed(2)}%`} data-testid="nhi-bar" className="bg-rose-400 transition-[width]" style={{ width: `${nhiShare}%` }} />
            <div title={`淨收入 ${netShare.toFixed(2)}%`} data-testid="net-bar" className="bg-emerald-500 transition-[width]" style={{ width: `${netShare}%` }} />
          </div>
          <div className="mt-2 flex flex-wrap justify-between gap-2 text-xs text-slate-500"><span>分潤支出 {commissionShare.toFixed(2)}%</span><span>二代健保 {nhiShare.toFixed(2)}%</span><span>淨收入 {netShare.toFixed(2)}%</span></div>
        </div>
      </div>
    </section>
  );
}
