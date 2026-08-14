import { LoaderCircle } from "lucide-react";

export default function CommerceCheckoutLoading() {
  return (
    <main className="grid min-h-screen place-items-center bg-slate-100 px-4" aria-busy="true" aria-live="polite">
      <div role="status" className="flex items-center gap-3 rounded-xl border border-slate-200 bg-white px-5 py-4 text-sm font-semibold text-slate-700 shadow-sm">
        <LoaderCircle className="animate-spin text-blue-600" size={20} aria-hidden="true" />
        正在載入商品與結帳資料…
      </div>
    </main>
  );
}
