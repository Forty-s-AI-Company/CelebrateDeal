import Link from "next/link";
import { resendMerchantEmailVerificationAction } from "@/app/actions/email-verification-actions";
import { CsrfField } from "@/components/csrf-field";
import { FormSubmitButton } from "@/components/form-submit-button";
import { NativePostForm } from "@/components/native-post-form";
import { TurnstileWidget } from "@/components/turnstile-widget";
import { getCurrentAuth } from "@/lib/auth";
import { signedInHomePath } from "@/lib/vendor-roles";
import { maskEmailRecipient } from "@/lib/email-delivery-pii";
import { MERCHANT_EMAIL_VERIFICATION_TTL_HOURS, readMerchantEmailVerificationToken } from "@/lib/merchant-email-verification-token";
import { TURNSTILE_ACTIONS, TURNSTILE_ERROR_MESSAGES, turnstileSiteKey } from "@/lib/turnstile";

export const dynamic = "force-dynamic";
export const metadata = { title: "驗證 Email｜CelebrateDeal" };

const STATUS_MESSAGES = {
  verified: { tone: "success", title: "Email 已完成驗證", body: "謝謝你，帳號的 Email 已確認。現在可以使用所有需要 Email 驗證的功能。" },
  already_verified: { tone: "success", title: "Email 已經驗證過了", body: "這個帳號的 Email 先前已完成驗證，不需要再做一次。" },
  invalid: { tone: "warning", title: "驗證連結無效或已過期", body: `驗證連結只在寄出後 ${MERCHANT_EMAIL_VERIFICATION_TTL_HOURS} 小時內有效，而且帳號 Email 變更後舊連結會失效。請登入後重新寄送驗證信。` },
} as const;

const ERROR_MESSAGES: Record<string, string> = {
  rate_limited: "驗證信寄送次數太多，請過一小時後再試。",
  temporarily_unavailable: "寄送保護服務暫時無法使用，請稍後再試。",
  send_failed: "驗證信暫時無法寄出，請稍後再試；若持續失敗請聯絡客服。",
  ...TURNSTILE_ERROR_MESSAGES,
};

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main className="grid min-h-screen place-items-center bg-gradient-to-b from-blue-50 to-white px-4 py-8">
      <section className="w-full max-w-lg rounded-2xl border border-slate-200 bg-white p-6 shadow-xl sm:p-8">
        <p className="text-sm font-bold text-blue-700">CelebrateDeal</p>
        {children}
      </section>
    </main>
  );
}

const PRIMARY_BUTTON = "inline-flex min-h-11 w-full items-center justify-center rounded-xl bg-blue-600 px-5 font-semibold text-white hover:bg-blue-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-2";

export default async function VerifyEmailPage({ searchParams }: { searchParams: Promise<{ token?: string | string[]; status?: string; error?: string }> }) {
  const query = await searchParams;
  const auth = await getCurrentAuth();
  const homeHref = auth ? signedInHomePath(auth) : "/dashboard";

  // A link from the email: show one confirm button. The POST does the update,
  // so a mail scanner that only fetches the link verifies nothing. The token
  // holds no address and the page shows none; the POST checks the MAC
  // against the account's stored address.
  if (typeof query.token === "string" && !query.status) {
    if (readMerchantEmailVerificationToken(query.token)) {
      return (
        <Shell>
          <h1 className="mt-2 text-3xl font-bold text-slate-950">確認你的 Email</h1>
          <p className="mt-4 text-sm leading-6 text-slate-700">請按下按鈕，確認這封驗證信寄到的 Email 是你本人使用的信箱。</p>
          <NativePostForm
            action="/api/auth/email-verification/confirm"
            idleLabel="確認驗證 Email"
            pendingLabel="確認中…"
            pendingMessage="正在確認 Email，請勿重複送出。"
            className="mt-6"
            buttonClassName={PRIMARY_BUTTON}
          >
            <input type="hidden" name="token" value={query.token} />
          </NativePostForm>
        </Shell>
      );
    }
  }

  const statusKey = query.status && query.status in STATUS_MESSAGES ? query.status as keyof typeof STATUS_MESSAGES : typeof query.token === "string" ? "invalid" : null;
  const status = statusKey ? STATUS_MESSAGES[statusKey] : null;
  const error = query.error ? ERROR_MESSAGES[query.error] ?? "操作失敗，請稍後再試。" : null;
  const unverified = auth && !auth.user.emailVerifiedAt;
  const siteKey = unverified ? turnstileSiteKey() : null;

  return (
    <Shell>
      {status ? (
        <div role={status.tone === "success" ? "status" : "alert"} className={`mt-4 rounded-xl p-4 ${status.tone === "success" ? "bg-emerald-50 text-emerald-800" : "border border-amber-200 bg-amber-50 text-amber-900"}`}>
          <h1 className="text-xl font-bold">{status.title}</h1>
          <p className="mt-2 text-sm leading-6">{status.body}</p>
        </div>
      ) : null}
      {query.status === "sent" && unverified ? (
        <p role="status" className="mt-4 rounded-lg bg-emerald-50 p-3 text-sm text-emerald-800">驗證信已寄出，請到 {maskEmailRecipient(auth.user.email)} 收信，並在 {MERCHANT_EMAIL_VERIFICATION_TTL_HOURS} 小時內開啟信中的連結。沒收到請看看垃圾郵件匣。</p>
      ) : null}
      {error ? <p role="alert" className="mt-4 rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p> : null}

      {unverified ? (
        <div className="mt-4" data-email-verification="required">
          {status ? null : <h1 className="text-3xl font-bold text-slate-950">請先驗證 Email</h1>}
          <p className="mt-3 text-sm leading-6 text-slate-700">我們會把驗證信寄到 <strong className="break-all">{maskEmailRecipient(auth.user.email)}</strong>。完成驗證後，才能發布「不需發布專案就公開」的名單型網站；登入、後台與已公開的頁面都不受影響。</p>
          <form action={resendMerchantEmailVerificationAction} className="mt-5 grid gap-4">
            <CsrfField />
            {siteKey ? <TurnstileWidget siteKey={siteKey} action={TURNSTILE_ACTIONS.resendVerification} /> : null}
            <FormSubmitButton pendingChildren="寄送中…" pendingMessage="正在寄送驗證信，請勿重複送出。" className={PRIMARY_BUTTON}>重新寄送驗證信</FormSubmitButton>
          </form>
          <p className="mt-5 text-center text-sm text-slate-600"><Link href={homeHref} className="font-semibold text-blue-700 hover:underline">先回到後台</Link></p>
        </div>
      ) : auth ? (
        <div className="mt-4">
          {status ? null : <h1 className="text-3xl font-bold text-slate-950">Email 已驗證</h1>}
          {status ? null : <p className="mt-3 text-sm leading-6 text-slate-700">這個帳號的 Email 已完成驗證。</p>}
          <Link href={homeHref} className={`mt-6 ${PRIMARY_BUTTON}`}>回到後台</Link>
        </div>
      ) : (
        <div className="mt-4">
          {status ? null : <h1 className="text-3xl font-bold text-slate-950">驗證 Email</h1>}
          <p className="mt-3 text-sm leading-6 text-slate-700">{statusKey === "verified" || statusKey === "already_verified" ? "可以登入繼續使用。" : "登入後可以在這裡重新寄送驗證信。"}</p>
          <Link href="/login" className={`mt-6 ${PRIMARY_BUTTON}`}>前往登入</Link>
        </div>
      )}
    </Shell>
  );
}
