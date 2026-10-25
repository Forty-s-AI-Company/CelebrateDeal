import Link from "next/link";

const BANNER = "mb-4 flex flex-col gap-3 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900 sm:flex-row sm:items-center sm:justify-between";
const GATE_NOTE = "完成驗證後才能發布「不需發布專案就公開」的名單型網站；其他功能與已公開的頁面不受影響。";

/**
 * Shown in the merchant back office while the vendor's email gate is closed.
 * `self`: the signed-in account is the one whose verification counts, so it
 * gets the resend flow. `other`: someone else must verify; no resend button
 * for an address that is not the viewer's.
 *
 * A persistent, labelled region rather than a live region: it is present on
 * every back-office page, so announcing it (role="status") would compete with
 * each page's own transient status and alert messages.
 */
export function EmailVerificationBanner(props: { mode: "self" } | { mode: "other"; maskedFounderEmail: string | null }) {
  if (props.mode === "other") {
    return (
      <section aria-label="Email 驗證提醒" data-email-verification-banner="other" className={BANNER}>
        <p className="leading-6">
          <strong className="font-semibold">{props.maskedFounderEmail ? `請商家註冊帳號（${props.maskedFounderEmail}）完成 Email 驗證。` : "請商家的擁有者完成 Email 驗證。"}</strong>
          {GATE_NOTE}
        </p>
      </section>
    );
  }
  return (
    <section aria-label="Email 驗證提醒" data-email-verification-banner="self" className={BANNER}>
      <p className="leading-6"><strong className="font-semibold">請先驗證 Email。</strong>{GATE_NOTE}</p>
      <Link href="/verify-email" className="inline-flex min-h-11 shrink-0 items-center justify-center rounded-lg bg-amber-700 px-4 font-semibold text-white hover:bg-amber-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-700 focus-visible:ring-offset-2">驗證或重新寄送</Link>
    </section>
  );
}
