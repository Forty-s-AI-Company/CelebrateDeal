import { loginAction } from "@/app/actions";
import { CsrfField } from "@/components/csrf-field";
import { FormSubmitButton } from "@/components/form-submit-button";
import { PublicResourceLinks } from "@/components/public-policy";

const errorMessages: Record<string, string> = {
  "1": "帳號或密碼不正確。",
  rate_limited: "登入失敗次數過多，請 15 分鐘後再試，或請平台管理員協助重設。",
  temporarily_unavailable: "登入保護服務暫時無法使用，請稍後再試。",
  no_vendor: "此帳號目前沒有可用的商家權限。",
  mfa_required: "這個管理權限帳號需要先完成多因子驗證設定。",
};

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; revoked?: string; reset?: string; password_changed?: string }>;
}) {
  const params = await searchParams;
  const showDemoHint = process.env.NODE_ENV !== "production";

  return (
    <main className="grid min-h-screen place-items-center bg-background px-4">
      <section className="w-full max-w-md rounded-lg border border-border bg-white p-6 shadow-sm">
        <div className="mb-6">
          <p className="text-sm font-semibold text-primary">CelebrateDeal</p>
          <h1 className="mt-2 text-2xl font-semibold text-slate-950">登入直播商務後台</h1>
          <p className="mt-2 text-sm text-slate-500">
            {showDemoHint ? "Demo 帳號：demo@celebratedeal.local / demo1234" : "請使用已開通的管理員或商家帳號登入。"}
          </p>
        </div>
        {params.revoked ? <p role="status" aria-live="polite" className="mb-4 rounded-md bg-blue-50 px-3 py-2 text-sm text-blue-700">所有 session 已撤銷，請重新登入。</p> : null}
        {params.reset ? <p role="status" aria-live="polite" className="mb-4 rounded-md bg-emerald-50 px-3 py-2 text-sm text-emerald-700">密碼已重設，請用新密碼登入。</p> : null}
        {params.password_changed ? <p role="status" aria-live="polite" className="mb-4 rounded-md bg-emerald-50 px-3 py-2 text-sm text-emerald-700">密碼已更新，所有舊 session 已撤銷，請重新登入。</p> : null}
        {params.error ? <p role="alert" className="mb-4 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{errorMessages[params.error] ?? "登入失敗，請稍後再試。"}</p> : null}
        <form action={loginAction} className="grid gap-4">
          <CsrfField />
          <label className="grid gap-1.5 text-sm font-medium text-slate-700">
            Email
            <input name="email" type="email" autoComplete="email" spellCheck={false} required defaultValue={showDemoHint ? "demo@celebratedeal.local" : ""} className="h-11 rounded-md border border-border px-3" />
          </label>
          <label className="grid gap-1.5 text-sm font-medium text-slate-700">
            密碼
            <input name="password" type="password" autoComplete="current-password" required defaultValue={showDemoHint ? "demo1234" : ""} className="h-11 rounded-md border border-border px-3" />
          </label>
          <FormSubmitButton
            pendingChildren="登入中…"
            pendingMessage="正在驗證帳號並登入，請勿重複送出。"
            className="h-11 rounded-md bg-primary text-sm font-semibold text-white hover:bg-primary-dark"
          >
            登入
          </FormSubmitButton>
        </form>
        <div className="mt-4 flex items-center justify-between text-sm">
          <a href="/password-reset/request" className="font-semibold text-primary hover:underline">忘記密碼</a>
          <a href="/dashboard" className="font-medium text-slate-600 hover:text-slate-800">返回首頁</a>
        </div>
        <div className="mt-6 border-t border-border pt-5">
          <p className="mb-3 text-center text-xs font-semibold text-slate-500">公開資訊與客服</p>
          <PublicResourceLinks compact />
        </div>
      </section>
    </main>
  );
}
