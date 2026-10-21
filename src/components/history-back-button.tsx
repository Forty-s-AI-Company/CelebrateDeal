"use client";

import { useRouter } from "next/navigation";

function cameFromThisSite() {
  try {
    return window.history.length > 1 && Boolean(document.referrer) && new URL(document.referrer).origin === window.location.origin;
  } catch {
    return false;
  }
}

/** 沒有上一頁（直接開啟連結）時退回 fallbackHref（預設首頁），避免觀眾停在死路；fallbackHref 為 null 時一律回上一頁。 */
export function HistoryBackButton({ children = "返回上一頁", fallbackHref = "/" }: { children?: React.ReactNode; fallbackHref?: string | null }) {
  const router = useRouter();
  return (
    <button
      type="button"
      onClick={() => (fallbackHref === null || cameFromThisSite() ? router.back() : router.push(fallbackHref))}
      className="inline-flex min-h-11 items-center justify-center rounded-md border border-border bg-white px-4 text-sm font-semibold text-slate-700 hover:bg-slate-50"
    >
      {children}
    </button>
  );
}
