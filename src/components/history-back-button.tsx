"use client";

import { useRouter } from "next/navigation";

/** 沒有上一頁（直接開啟連結）時退回首頁，避免觀眾停在死路。 */
export function HistoryBackButton({ children = "返回上一頁", fallbackHref = "/" }: { children?: React.ReactNode; fallbackHref?: string }) {
  const router = useRouter();
  return (
    <button
      type="button"
      onClick={() => (window.history.length > 1 ? router.back() : router.push(fallbackHref))}
      className="inline-flex min-h-11 items-center justify-center rounded-md border border-border bg-white px-4 text-sm font-semibold text-slate-700 hover:bg-slate-50"
    >
      {children}
    </button>
  );
}
