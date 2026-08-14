"use client";

import { useTransition } from "react";

export default function AdminBillingError({ unstable_retry }: {
  error: Error & { digest?: string };
  unstable_retry: () => void;
}) {
  const [pending, startTransition] = useTransition();

  return (
    <section role="alert" aria-labelledby="admin-billing-error-title" className="rounded-xl border border-red-200 bg-red-50 p-6 text-red-950">
      <h1 id="admin-billing-error-title" className="text-lg font-semibold">財務作業資料載入失敗</h1>
      <p className="mt-2 text-sm leading-6 text-red-900">畫面沒有送出付款、退款、出款或 webhook 操作。請重新載入最新狀態後再決定下一步。</p>
      <button
        type="button"
        disabled={pending}
        aria-disabled={pending}
        aria-busy={pending}
        onClick={() => startTransition(() => unstable_retry())}
        className="mt-4 inline-flex min-h-11 items-center rounded-md bg-red-800 px-4 py-2 text-sm font-semibold text-white hover:bg-red-900 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {pending ? "重新載入中…" : "重新載入財務資料"}
      </button>
      <span role="status" aria-live="polite" className="sr-only">{pending ? "正在重新載入財務資料。" : ""}</span>
    </section>
  );
}
