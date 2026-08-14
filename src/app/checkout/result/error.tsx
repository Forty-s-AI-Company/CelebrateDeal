"use client";

import { LoaderCircle, RotateCcw } from "lucide-react";
import { useTransition } from "react";

export default function PaymentResultError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const [pending, startTransition] = useTransition();

  return (
    <main className="mx-auto max-w-xl rounded-xl border border-orange-200 bg-orange-50 p-6" role="alert" aria-busy={pending}>
      <h1 className="text-xl font-bold text-orange-950">暫時無法載入付款結果</h1>
      <p className="mt-2 text-sm leading-6 text-orange-900">
        系統沒有因此重複付款或建立訂單。請重新載入目前狀態；若仍失敗，請使用原結帳瀏覽器前往客服入口。
      </p>
      <button
        type="button"
        disabled={pending}
        aria-disabled={pending}
        aria-busy={pending}
        onClick={() => startTransition(() => reset())}
        className="mt-5 inline-flex min-h-11 items-center gap-2 rounded-md bg-orange-900 px-4 py-2 text-sm font-semibold text-white hover:bg-orange-800 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {pending ? <LoaderCircle className="animate-spin" size={16} aria-hidden="true" /> : <RotateCcw size={16} aria-hidden="true" />}
        {pending ? "重新載入中…" : "重新載入付款狀態"}
      </button>
      <span role="status" aria-live="polite" className="sr-only">{pending ? "正在重新載入付款與訂單狀態。" : ""}</span>
    </main>
  );
}
