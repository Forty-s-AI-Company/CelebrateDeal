"use client";

export default function Error({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <section role="alert" aria-labelledby="stream-reconciliation-error-title" className="rounded-lg border border-red-200 bg-red-50 p-6">
      <h1 id="stream-reconciliation-error-title" className="text-lg font-semibold text-red-950">無法載入 Stream 使用量對帳</h1>
      <p className="mt-2 text-sm text-red-800">資料暫時無法讀取；未顯示任何 provider 原始資料。請重試，若持續發生請通知系統管理員。</p>
      <button type="button" onClick={reset} className="mt-4 inline-flex h-10 items-center rounded-md bg-red-700 px-4 text-sm font-semibold text-white hover:bg-red-800">重新載入</button>
    </section>
  );
}
