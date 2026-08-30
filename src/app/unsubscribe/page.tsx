import { SubmitButton } from "@/components/ui";
import { verifyEmailUnsubscribeToken } from "@/lib/email-delivery-pii";

export default async function UnsubscribePage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string; status?: string }>;
}) {
  const { token = "", status } = await searchParams;
  const validToken = token.length <= 512 && verifyEmailUnsubscribeToken(token) !== null;

  return (
    <main className="mx-auto flex min-h-screen max-w-xl items-center px-5 py-12">
      <section className="w-full rounded-xl border border-border bg-white p-6 shadow-sm" aria-live="polite">
        <h1 className="text-2xl font-bold text-slate-950">Email 通知設定</h1>
        {status === "done" ? (
          <p className="mt-3 text-slate-700">已停止寄送這個商家的行銷與直播通知。已在途的信件可能仍會送達。</p>
        ) : status === "invalid" || !validToken ? (
          <p className="mt-3 text-red-700" role="alert">這個退訂連結無效或已損壞，請使用最近收到的 Email 連結再試一次。</p>
        ) : (
          <>
            <p className="mt-3 text-slate-700">確認後，我們會停止這個商家的報名、直播與後續導購 Email。</p>
            <form method="post" action="/api/email/unsubscribe" className="mt-5">
              <input type="hidden" name="token" value={token} />
              <SubmitButton pendingChildren="正在停止通知…" pendingMessage="正在更新 Email 通知設定。">確認停止通知</SubmitButton>
            </form>
          </>
        )}
      </section>
    </main>
  );
}
