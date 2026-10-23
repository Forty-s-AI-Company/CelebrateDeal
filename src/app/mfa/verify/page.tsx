import { safeInternalPathOr } from "@/lib/safe-internal-path";
import { verifyMfaAction } from "@/app/actions";
import { CsrfField } from "@/components/csrf-field";
import { FormSubmitButton } from "@/components/form-submit-button";
import { requireAuth } from "@/lib/auth";

const errorMessages: Record<string, string> = {
  invalid: "驗證碼不正確。請看手機 App 上目前的 6 位數數字（每 30 秒會換一組），或確認備用救援碼沒有輸入錯誤、沒有用過。",
  rate_limited: "輸入錯誤的次數太多了，請稍後再試。",
  locked: "輸入錯誤的次數太多，已暫停 1 小時。如果不是你本人操作，請盡快變更密碼。請稍後再試，或聯絡平台客服。",
  temporarily_unavailable: "驗證功能暫時無法使用，請稍後再試，或聯絡平台客服。",
};

function safeNextPath(value: string | undefined) {
  return safeInternalPathOr(value, "/admin/billing/dashboard");
}

export default async function MfaVerifyPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; next?: string; reason?: string }>;
}) {
  const params = await searchParams;
  await requireAuth({ allowUnverifiedMfa: true });

  return (
    <main className="grid min-h-screen place-items-center bg-background px-4">
      <section className="w-full max-w-md rounded-lg border border-border bg-white p-6 shadow-sm">
        <div className="mb-6">
          <p className="text-sm font-semibold text-primary">CelebrateDeal</p>
          <h1 className="mt-2 text-2xl font-semibold text-slate-950">輸入驗證碼</h1>
          <p className="mt-2 text-sm text-slate-600">打開手機上的驗證碼 App，輸入畫面上目前的 6 位數數字。</p>
        </div>
        {params.reason === "step_up" ? <p role="status" className="mb-4 rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-900">這個操作會動到收款或客戶資料，所以要先確認是你本人。輸入驗證碼後，會回到剛才的頁面，請再按一次送出。</p> : null}
        {params.error ? <p role="alert" className="mb-4 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{errorMessages[params.error] ?? "驗證沒有成功，請再試一次。"}</p> : null}
        <form action={verifyMfaAction} className="grid gap-4">
          <CsrfField />
          <input type="hidden" name="next" value={safeNextPath(params.next)} />
          <label className="grid gap-1.5 text-sm font-medium text-slate-700">
            驗證碼
            <input name="code" autoComplete="one-time-code" required className="h-11 rounded-md border border-border px-3 tracking-[0.2em]" placeholder="123456" />
            <span className="text-xs font-normal leading-5 text-slate-600">手機遺失？可改輸入備用救援碼（格式像 ABCDE-12345）。</span>
          </label>
          <FormSubmitButton
            className="h-11 rounded-md bg-primary text-sm font-semibold text-white hover:bg-primary-dark"
            pendingChildren="驗證中…"
            pendingMessage="正在驗證，請勿重複送出。"
          >
            確認並繼續
          </FormSubmitButton>
        </form>
      </section>
    </main>
  );
}
