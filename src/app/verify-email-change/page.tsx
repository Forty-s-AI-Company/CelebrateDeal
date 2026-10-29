import Link from "next/link";
import { NativePostForm } from "@/components/native-post-form";
import { ACCOUNT_EMAIL_CHANGE_TTL_MINUTES, readAccountEmailChangeToken } from "@/lib/account-email-change-token";
import { getCurrentAuth } from "@/lib/auth";

export const dynamic = "force-dynamic";
export const metadata = { title: "確認新的登入 Email｜CelebrateDeal" };

const STATUS_MESSAGES = {
  changed: {
    tone: "success",
    title: "登入 Email 已變更",
    body: "新的 Email 已完成驗證並成為登入帳號。為了安全，所有裝置的登入狀態都已結束，請用新的 Email 重新登入。",
  },
  invalid: {
    tone: "warning",
    title: "連結無效或已過期",
    body: `變更連結只在寄出後 ${ACCOUNT_EMAIL_CHANGE_TTL_MINUTES} 分鐘內有效、只能使用一次，而且重新申請、變更或重設密碼後，舊連結就會失效。登入 Email 沒有變更；如仍需變更，請登入後到「安全性」重新申請。`,
  },
  email_taken: {
    tone: "warning",
    title: "這個 Email 已被其他帳號使用",
    body: "登入 Email 沒有變更，仍是原本的 Email。如需協助請聯絡客服。",
  },
} as const;

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

/**
 * Landing page of the link e-mailed to the new address. It never changes
 * anything on GET (mail scanners prefetch links) and shows no address; the
 * button POSTs to /api/auth/email-change/confirm. Works signed out and while
 * another account is signed in, and never signs anyone in.
 */
export default async function VerifyEmailChangePage({ searchParams }: { searchParams: Promise<{ token?: string | string[]; status?: string }> }) {
  const query = await searchParams;

  if (typeof query.token === "string" && !query.status && readAccountEmailChangeToken(query.token)) {
    return (
      <Shell>
        <h1 className="mt-2 text-3xl font-bold text-slate-950">確認新的登入 Email</h1>
        <p className="mt-4 text-sm leading-6 text-slate-700">按下按鈕後，帳號的登入 Email 會改成收到這封信的 Email，所有裝置的登入狀態都會結束，之後請用新的 Email 登入。</p>
        <NativePostForm
          action="/api/auth/email-change/confirm"
          idleLabel="確認變更登入 Email"
          pendingLabel="變更中…"
          pendingMessage="正在變更登入 Email，請勿重複送出。"
          className="mt-6"
          buttonClassName={PRIMARY_BUTTON}
        >
          <input type="hidden" name="token" value={query.token} />
        </NativePostForm>
      </Shell>
    );
  }

  const statusKey = query.status && query.status in STATUS_MESSAGES ? query.status as keyof typeof STATUS_MESSAGES : "invalid";
  const status = STATUS_MESSAGES[statusKey];
  // After a change every session of that account has ended, so a signed-in
  // viewer here is someone else (or the account of a link that failed).
  const auth = statusKey === "changed" ? null : await getCurrentAuth();

  return (
    <Shell>
      <div role={status.tone === "success" ? "status" : "alert"} className={`mt-4 rounded-xl p-4 ${status.tone === "success" ? "bg-emerald-50 text-emerald-800" : "border border-amber-200 bg-amber-50 text-amber-900"}`}>
        <h1 className="text-xl font-bold">{status.title}</h1>
        <p className="mt-2 text-sm leading-6">{status.body}</p>
      </div>
      {auth ? (
        <Link href="/settings/security" className={`mt-6 ${PRIMARY_BUTTON}`}>回到安全性設定</Link>
      ) : (
        <Link href="/login" className={`mt-6 ${PRIMARY_BUTTON}`}>前往登入</Link>
      )}
    </Shell>
  );
}
