"use client";

export default function DashboardError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <main role="alert" className="mx-auto grid max-w-xl gap-4 rounded-xl border border-amber-200 bg-amber-50 p-6 text-slate-800">
      <div>
        <h1 className="text-xl font-semibold text-slate-950">營運資料暫時無法載入</h1>
        <p className="mt-2 text-sm leading-6">
          資料服務可能暫停或連線不穩，報名與直播流程不會因此被重新送出。你可以稍後再試一次。
        </p>
      </div>
      <button
        type="button"
        onClick={reset}
        className="min-h-11 justify-self-start rounded-md bg-primary px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2"
      >
        重新載入營運資料
      </button>
    </main>
  );
}
