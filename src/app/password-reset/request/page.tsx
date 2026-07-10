import { requestPasswordResetAction } from "@/app/actions";
import { CsrfField } from "@/components/csrf-field";

const errorMessages: Record<string, string> = {
  invalid: "請輸入有效的 Email。",
};

export default async function PasswordResetRequestPage({
  searchParams,
}: {
  searchParams: Promise<{ updated?: string; error?: string; preview?: string }>;
}) {
  const params = await searchParams;

  return (
    <main className="grid min-h-screen place-items-center bg-background px-4">
      <section className="w-full max-w-md rounded-lg border border-border bg-white p-6 shadow-sm">
        <div className="mb-6">
          <p className="text-sm font-semibold text-primary">CelebrateDeal</p>
          <h1 className="mt-2 text-2xl font-semibold text-slate-950">申請密碼重設</h1>
          <p className="mt-2 text-sm text-slate-500">輸入登入 Email，系統會寄出 30 分鐘有效的一次性重設連結。</p>
        </div>
        {params.updated ? <p className="mb-4 rounded-md bg-emerald-50 px-3 py-2 text-sm text-emerald-700">如果這個 Email 存在，系統已寄出密碼重設信。</p> : null}
        {params.preview ? <p className="mb-4 break-all rounded-md bg-blue-50 px-3 py-2 text-sm text-blue-700">開發預覽：{params.preview}</p> : null}
        {params.error ? <p className="mb-4 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{errorMessages[params.error] ?? "無法處理請求。"}</p> : null}
        <form action={requestPasswordResetAction} className="grid gap-4">
          <CsrfField />
          <label className="grid gap-1.5 text-sm font-medium text-slate-700">
            Email
            <input name="email" type="email" required className="h-10 rounded-md border border-border px-3" placeholder="you@example.com" />
          </label>
          <button className="h-10 rounded-md bg-primary text-sm font-semibold text-white hover:bg-primary-dark">寄送重設信</button>
        </form>
        <div className="mt-4 text-sm">
          <a href="/login" className="font-semibold text-primary hover:underline">返回登入</a>
        </div>
      </section>
    </main>
  );
}
