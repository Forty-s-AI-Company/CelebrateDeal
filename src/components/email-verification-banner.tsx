import Link from "next/link";

/** Shown in the merchant back office while the signed-in account's email is unverified. */
export function EmailVerificationBanner() {
  return (
    <div role="status" data-email-verification-banner="" className="mb-4 flex flex-col gap-3 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900 sm:flex-row sm:items-center sm:justify-between">
      <p className="leading-6"><strong className="font-semibold">請先驗證 Email。</strong>完成驗證後才能發布「不需發布專案就公開」的名單型網站；其他功能與已公開的頁面不受影響。</p>
      <Link href="/verify-email" className="inline-flex min-h-11 shrink-0 items-center justify-center rounded-lg bg-amber-700 px-4 font-semibold text-white hover:bg-amber-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-700 focus-visible:ring-offset-2">驗證或重新寄送</Link>
    </div>
  );
}
