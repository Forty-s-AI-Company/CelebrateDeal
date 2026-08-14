"use client";

import { LoaderCircle } from "lucide-react";
import { useTransition } from "react";

export default function CommerceCheckoutError({ reset }: { reset: () => void }) {
  const [isPending, startTransition] = useTransition();

  return (
    <main className="grid min-h-screen place-items-center bg-slate-100 px-4">
      <section role="alert" className="w-full max-w-lg rounded-2xl border border-red-200 bg-white p-7 text-center shadow-sm">
        <h1 className="text-2xl font-black text-slate-950">結帳頁暫時無法載入</h1>
        <p className="mt-3 text-sm leading-6 text-slate-600">尚未建立訂單，也不會向你收款。你可以安全地再試一次。</p>
        <button
          type="button"
          disabled={isPending}
          aria-disabled={isPending}
          aria-busy={isPending}
          onClick={() => startTransition(reset)}
          className="mt-6 inline-flex min-h-11 items-center gap-2 rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-bold text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {isPending ? <LoaderCircle className="animate-spin" size={18} aria-hidden="true" /> : null}
          {isPending ? "正在重新載入…" : "重新載入"}
        </button>
        <span role="status" aria-live="polite" className="sr-only">{isPending ? "正在重新載入結帳頁" : ""}</span>
      </section>
    </main>
  );
}
