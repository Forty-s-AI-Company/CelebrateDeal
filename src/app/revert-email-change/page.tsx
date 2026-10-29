import Link from "next/link";
import { NativePostForm } from "@/components/native-post-form";
import { ACCOUNT_EMAIL_CHANGE_LOCK_DAYS, describeAccountEmailRevertLink } from "@/lib/account-email-change";
import { ACCOUNT_EMAIL_REVERT_TTL_DAYS } from "@/lib/account-email-change-token";

export const dynamic = "force-dynamic";
export const metadata = { title: "不是我操作，還原 Email｜CelebrateDeal" };

const AFTERWARDS = `所有裝置都已登出，${ACCOUNT_EMAIL_CHANGE_LOCK_DAYS} 天內不能再自行變更登入 Email。請立即用這個信箱到登入頁的「忘記密碼」重設密碼，並檢查帳號設定。`;

const STATUS_MESSAGES = {
  reverted: { tone: "success", title: "登入 Email 已還原", body: `登入 Email 已改回這個信箱。${AFTERWARDS}` },
  cancelled: { tone: "success", title: "已取消變更登入 Email", body: `登入 Email 維持這個信箱，尚未完成的變更已取消。${AFTERWARDS}` },
  invalid: {
    tone: "warning",
    title: "連結無效或已過期",
    body: `這個連結只能使用一次，變更完成後 ${ACCOUNT_EMAIL_REVERT_TTL_DAYS} 天內有效；變更沒有完成時，申請過期後就會失效。如果帳號仍有異狀，請用這個信箱到登入頁重設密碼，或聯絡客服。`,
  },
  conflict: {
    tone: "warning",
    title: "無法自動還原，請聯絡客服",
    body: "這個信箱目前無法還原為登入 Email。為了安全，所有裝置都已登出、尚未完成的變更也已取消。請聯絡客服協助處理，連結在有效期限內仍可再次使用。",
  },
  retry: { tone: "warning", title: "系統忙碌，請重試", body: "這次沒有任何變更。請稍候再從通知信重新開啟連結並按一次按鈕；連結仍然有效。" },
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

const DANGER_BUTTON = "inline-flex min-h-11 w-full items-center justify-center rounded-xl bg-red-600 px-5 font-semibold text-white hover:bg-red-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-red-600 focus-visible:ring-offset-2";
const PRIMARY_BUTTON = "inline-flex min-h-11 w-full items-center justify-center rounded-xl bg-blue-600 px-5 font-semibold text-white hover:bg-blue-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-2";

/**
 * Landing page of the "不是我操作，還原 Email" link in the security notice sent
 * to the previous address. It never changes anything on GET and shows no
 * address; the button POSTs to /api/auth/email-change/revert. No sign-in.
 */
export default async function RevertEmailChangePage({ searchParams }: { searchParams: Promise<{ token?: string | string[]; status?: string }> }) {
  const query = await searchParams;

  const link = typeof query.token === "string" && !query.status ? await describeAccountEmailRevertLink(query.token) : null;
  if (link && typeof query.token === "string") {
    const restore = link.mode === "restore";
    return (
      <Shell>
        <h1 className="mt-2 text-3xl font-bold text-slate-950">不是我操作，還原 Email</h1>
        <p className="mt-4 text-sm leading-6 text-slate-700">
          {restore
            ? "這個帳號的登入 Email 已被改成其他信箱。按下按鈕後，登入 Email 會還原為收到這封通知的信箱。"
            : "這個帳號有一筆尚未完成的登入 Email 變更。按下按鈕後會取消變更，登入 Email 維持收到這封通知的信箱。"}
        </p>
        <p className="mt-3 text-sm leading-6 text-slate-700">同時所有裝置都會登出，{ACCOUNT_EMAIL_CHANGE_LOCK_DAYS} 天內不能再自行變更登入 Email。完成後請立即重設密碼。</p>
        <NativePostForm
          action="/api/auth/email-change/revert"
          idleLabel={restore ? "還原登入 Email" : "取消變更"}
          pendingLabel="處理中…"
          pendingMessage="正在處理，請勿重複送出。"
          className="mt-6"
          buttonClassName={DANGER_BUTTON}
        >
          <input type="hidden" name="token" value={query.token} />
        </NativePostForm>
      </Shell>
    );
  }

  const statusKey = query.status && query.status in STATUS_MESSAGES ? query.status as keyof typeof STATUS_MESSAGES : "invalid";
  const status = STATUS_MESSAGES[statusKey];
  return (
    <Shell>
      <div role={status.tone === "success" ? "status" : "alert"} className={`mt-4 rounded-xl p-4 ${status.tone === "success" ? "bg-emerald-50 text-emerald-800" : "border border-amber-200 bg-amber-50 text-amber-900"}`}>
        <h1 className="text-xl font-bold">{status.title}</h1>
        <p className="mt-2 text-sm leading-6">{status.body}</p>
      </div>
      <Link href="/password-reset/request" className={`mt-6 ${PRIMARY_BUTTON}`}>重設密碼</Link>
      <p className="mt-4 text-center text-sm text-slate-600"><Link href="/login" className="font-semibold text-blue-700 hover:underline">前往登入</Link></p>
    </Shell>
  );
}
