"use client";

import { useTransition } from "react";

export default function MerchantBillingError({ unstable_retry }: {
  error: Error & { digest?: string };
  unstable_retry: () => void;
}) {
  const [pending, startTransition] = useTransition();

  return (
    <section role="alert" aria-labelledby="merchant-billing-error-title" className="rounded-xl border border-red-200 bg-red-50 p-6 text-red-950">
      <h1 id="merchant-billing-error-title" className="text-lg font-semibold">商家帳務資料載入失敗</h1>
      <p className="mt-2 text-sm leading-6 text-red-900">畫面沒有建立付款、撤銷付款方式或變更 payout 狀態。請重新載入最新資料後再操作。</p>
      <button
        type="button"
        disabled={pending}
        aria-disabled={pending}
        aria-busy={pending}
        onClick={() => startTransition(() => unstable_retry())}
        className="mt-4 inline-flex min-h-11 items-center rounded-md bg-red-800 px-4 py-2 text-sm font-semibold text-white hover:bg-red-900 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {pending ? "重新載入中…" : "重新載入帳務資料"}
      </button>
      <span role="status" aria-live="polite" className="sr-only">{pending ? "正在重新載入商家帳務資料。" : ""}</span>
    </section>
  );
}
