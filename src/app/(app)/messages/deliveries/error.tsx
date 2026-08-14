"use client";

export default function MessageDeliveriesError({
  unstable_retry,
}: {
  error: Error & { digest?: string };
  unstable_retry: () => void;
}) {
  return (
    <main className="mx-auto max-w-xl rounded-xl border border-orange-200 bg-orange-50 p-6" role="alert">
      <h1 className="text-xl font-bold text-orange-950">暫時無法載入 Email 寄送紀錄</h1>
      <p className="mt-2 text-sm leading-6 text-orange-900">
        系統沒有變更任何寄送排程。請重新載入；若仍失敗，可稍後再回來查看，既有佇列會保留。
      </p>
      <button
        type="button"
        onClick={unstable_retry}
        className="mt-5 min-h-11 rounded-md bg-orange-900 px-4 py-2 text-sm font-semibold text-white hover:bg-orange-800"
      >
        重新載入
      </button>
    </main>
  );
}
