import { LoaderCircle } from "lucide-react";

export default function MerchantBillingLoading() {
  return (
    <section aria-busy="true" aria-live="polite" aria-labelledby="merchant-billing-loading-title" className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
      <div className="flex items-center gap-3 text-slate-700" role="status">
        <LoaderCircle className="animate-spin text-blue-700" size={20} aria-hidden="true" />
        <h1 id="merchant-billing-loading-title" className="font-semibold">正在載入商家帳務資料</h1>
      </div>
      <p className="mt-2 text-sm text-slate-600">系統正在讀取帳單、付款方式、用量與 payout 狀態；完成前不會建立付款或變更設定。</p>
      <div className="mt-5 grid animate-pulse gap-3" aria-hidden="true">
        <div className="h-16 rounded-lg bg-slate-100" />
        <div className="h-32 rounded-lg bg-slate-100" />
      </div>
    </section>
  );
}
