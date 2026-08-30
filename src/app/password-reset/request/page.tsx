import Link from "next/link";
import { requestPasswordResetAction } from "@/app/actions";
import { CsrfField } from "@/components/csrf-field";
import { FormSubmitButton } from "@/components/form-submit-button";
import { applyE2eLoadingDelay } from "@/lib/e2e-loading-diagnostic";

const errorMessages: Record<string, string> = {
  invalid: "請輸入有效的 Email。",
  rate_limited: "申請次數過多，請稍候再試。",
  temporarily_unavailable: "目前無法處理申請，請稍候再試。",
};

export default async function PasswordResetRequestPage({
  searchParams,
}: {
  searchParams: Promise<{ updated?: string; error?: string }>;
}) {
  await applyE2eLoadingDelay();
  const params = await searchParams;

  return (
    <main className="grid min-h-screen place-items-center bg-background px-4">
      <section className="w-full max-w-md rounded-lg border border-border bg-white p-6 shadow-sm">
        <div className="mb-6">
          <p className="text-sm font-semibold text-primary">CelebrateDeal</p>
          <h1 className="mt-2 text-2xl font-semibold text-slate-950">申請密碼重設</h1>
          <p className="mt-2 text-sm text-slate-500">輸入登入 Email，系統會寄出 30 分鐘有效的一次性重設連結。</p>
        </div>
        {params.updated ? <p role="status" aria-live="polite" className="mb-4 rounded-md bg-emerald-50 px-3 py-2 text-sm text-emerald-700">如果這個 Email 存在，系統已寄出密碼重設信。</p> : null}
        {params.error ? <p role="alert" className="mb-4 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{errorMessages[params.error] ?? "無法處理請求。"}</p> : null}
        <form action={requestPasswordResetAction} className="grid gap-4">
          <CsrfField />
          <label className="grid gap-1.5 text-sm font-medium text-slate-700">
            Email
            <input name="email" type="email" autoComplete="email" spellCheck={false} required className="h-11 rounded-md border border-border px-3" placeholder="you@example.com" />
          </label>
          <FormSubmitButton
            pendingChildren="申請中…"
            pendingMessage="正在申請密碼重設信，請勿重複送出。"
            className="h-11 rounded-md bg-primary text-sm font-semibold text-white hover:bg-primary-dark"
          >
            寄送重設信
          </FormSubmitButton>
        </form>
        <div className="mt-4 text-sm">
          <Link href="/login" className="font-semibold text-primary hover:underline">返回登入</Link>
        </div>
      </section>
    </main>
  );
}
