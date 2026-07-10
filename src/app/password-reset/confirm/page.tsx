import { confirmPasswordResetAction } from "@/app/actions";
import { CsrfField } from "@/components/csrf-field";

const errorMessages: Record<string, string> = {
  short: "密碼至少需要 12 個字元。",
  mismatch: "兩次輸入的密碼不一致。",
  expired: "這個重設連結已失效，請重新申請。",
};

export default async function PasswordResetConfirmPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string; error?: string }>;
}) {
  const params = await searchParams;

  return (
    <main className="grid min-h-screen place-items-center bg-background px-4">
      <section className="w-full max-w-md rounded-lg border border-border bg-white p-6 shadow-sm">
        <div className="mb-6">
          <p className="text-sm font-semibold text-primary">CelebrateDeal</p>
          <h1 className="mt-2 text-2xl font-semibold text-slate-950">設定新密碼</h1>
          <p className="mt-2 text-sm text-slate-500">請輸入新的登入密碼；成功後所有舊 session 都會失效。</p>
        </div>
        {params.error ? <p className="mb-4 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{errorMessages[params.error] ?? "無法重設密碼。"}</p> : null}
        <form action={confirmPasswordResetAction} className="grid gap-4">
          <CsrfField />
          <input type="hidden" name="token" value={params.token ?? ""} />
          <label className="grid gap-1.5 text-sm font-medium text-slate-700">
            新密碼
            <input name="password" type="password" required className="h-10 rounded-md border border-border px-3" />
          </label>
          <label className="grid gap-1.5 text-sm font-medium text-slate-700">
            確認密碼
            <input name="confirmPassword" type="password" required className="h-10 rounded-md border border-border px-3" />
          </label>
          <button className="h-10 rounded-md bg-primary text-sm font-semibold text-white hover:bg-primary-dark">更新密碼</button>
        </form>
      </section>
    </main>
  );
}
