"use client";

export default function BillingUsageError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <main className="mx-auto max-w-xl rounded-xl border border-orange-200 bg-orange-50 p-6" role="alert">
      <h1 className="text-xl font-bold text-orange-950">暫時無法載入用量資料</h1>
      <p className="mt-2 text-sm leading-6 text-orange-900">
        系統沒有變更任何帳單或 Stream 配額。請重新載入；若仍失敗，再由平台營運檢查對帳狀態。
      </p>
      <button
        type="button"
        onClick={reset}
        className="mt-5 min-h-11 rounded-md bg-orange-900 px-4 py-2 text-sm font-semibold text-white hover:bg-orange-800"
      >
        重新載入
      </button>
    </main>
  );
}
