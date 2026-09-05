import { affiliatePortalLoginAction } from "@/app/actions/affiliate-portal-actions";
import { CsrfField } from "@/components/csrf-field";
import { FormSubmitButton } from "@/components/form-submit-button";
import { LineQuickLoginForm } from "@/components/line-login-button";

const errors: Record<string, string> = {
  invalid: "登入資料不正確，或這組推廣碼尚未開通 Portal。",
  unauthorized: "這個帳號沒有可用的推廣者工作台權限。",
  rate_limited: "嘗試次數過多，請 15 分鐘後再試。",
  unavailable: "登入保護服務暫時無法使用，請稍後再試。",
};

export default async function AffiliatePortalLoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;

  return (
    <main className="grid min-h-screen place-items-center bg-slate-950 px-4 py-10">
      <section className="w-full max-w-md rounded-2xl border border-white/10 bg-white p-7 shadow-2xl">
        <p className="text-sm font-semibold text-primary">CelebrateDeal Affiliate</p>
        <h1 className="mt-2 text-2xl font-bold text-slate-950">推廣者工作台登入</h1>
        <p className="mt-2 text-sm text-slate-600">使用商家為你開通的 Email、密碼與推廣碼登入。</p>
        {error ? <p role="alert" className="mt-5 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{errors[error] ?? errors.invalid}</p> : null}
        <form action={affiliatePortalLoginAction} className="mt-6 grid gap-4">
          <CsrfField />
          <label className="grid gap-1.5 text-sm font-medium text-slate-700">
            Email
            <input name="email" type="email" required autoComplete="username" className="h-11 rounded-md border border-border px-3" />
          </label>
          <label className="grid gap-1.5 text-sm font-medium text-slate-700">
            密碼
            <input name="password" type="password" required autoComplete="current-password" className="h-11 rounded-md border border-border px-3" />
          </label>
          <label className="grid gap-1.5 text-sm font-medium text-slate-700">
            推廣碼
            <input name="code" required autoCapitalize="characters" maxLength={80} className="h-11 rounded-md border border-border px-3 font-mono uppercase" />
          </label>
          <FormSubmitButton
            pendingChildren="登入中…"
            pendingMessage="正在驗證推廣者身分。"
            className="mt-2 min-h-11 rounded-md bg-primary px-4 font-semibold text-white hover:bg-primary-dark"
          >
            登入工作台
          </FormSubmitButton>
        </form>
        <LineQuickLoginForm />
      </section>
    </main>
  );
}
