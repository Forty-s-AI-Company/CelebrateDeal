"use client";

import { LoaderCircle } from "lucide-react";
import Link from "next/link";
import { useTransition } from "react";

/** 路由錯誤邊界共用的繁中畫面：提供重試與回首頁，不顯示技術細節。 */
export function RouteErrorFallback({
  title,
  description,
  retry,
  homeHref = "/",
}: {
  title: string;
  description: string;
  retry: () => void;
  homeHref?: string;
}) {
  const [isPending, startTransition] = useTransition();

  return (
    <main className="grid min-h-screen place-items-center bg-slate-50 px-4 py-8">
      <section className="w-full max-w-lg rounded-xl border border-slate-200 bg-white p-6 text-center shadow-sm" role="alert">
        <h1 className="text-xl font-bold text-slate-950">{title}</h1>
        <p className="mt-2 text-sm leading-6 text-slate-600">{description}</p>
        <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
          <button
            type="button"
            disabled={isPending}
            aria-busy={isPending}
            onClick={() => startTransition(retry)}
            className="inline-flex min-h-11 items-center justify-center gap-2 rounded-md bg-primary px-4 text-sm font-semibold text-white hover:bg-primary-dark disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isPending ? <LoaderCircle className="animate-spin" size={18} aria-hidden="true" /> : null}
            {isPending ? "正在重新載入…" : "重新載入"}
          </button>
          <Link href={homeHref} className="inline-flex min-h-11 items-center justify-center rounded-md border border-border bg-white px-4 text-sm font-semibold text-slate-700 hover:bg-slate-50">
            回首頁
          </Link>
        </div>
        <span role="status" aria-live="polite" className="sr-only">{isPending ? "正在重新載入頁面" : ""}</span>
      </section>
    </main>
  );
}
