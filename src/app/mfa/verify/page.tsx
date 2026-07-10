import { verifyMfaAction } from "@/app/actions";
import { CsrfField } from "@/components/csrf-field";
import { requireAuth } from "@/lib/auth";

const errorMessages: Record<string, string> = {
  invalid: "驗證碼不正確，請重新輸入。",
};

function safeInternalPath(value: string | undefined) {
  return value?.startsWith("/") && !value.startsWith("//") ? value : "/admin/billing/dashboard";
}

export default async function MfaVerifyPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; next?: string }>;
}) {
  const params = await searchParams;
  await requireAuth();

  return (
    <main className="grid min-h-screen place-items-center bg-background px-4">
      <section className="w-full max-w-md rounded-lg border border-border bg-white p-6 shadow-sm">
        <div className="mb-6">
          <p className="text-sm font-semibold text-primary">CelebrateDeal</p>
          <h1 className="mt-2 text-2xl font-semibold text-slate-950">管理員二次驗證</h1>
          <p className="mt-2 text-sm text-slate-500">輸入 TOTP 驗證碼，或使用尚未用過的 recovery code。</p>
        </div>
        {params.error ? <p className="mb-4 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{errorMessages[params.error] ?? "驗證失敗。"}</p> : null}
        <form action={verifyMfaAction} className="grid gap-4">
          <CsrfField />
          <input type="hidden" name="next" value={safeInternalPath(params.next)} />
          <label className="grid gap-1.5 text-sm font-medium text-slate-700">
            驗證碼
            <input name="code" required className="h-10 rounded-md border border-border px-3 tracking-[0.2em]" placeholder="123456 或 ABCDE-12345" />
          </label>
          <button className="h-10 rounded-md bg-primary text-sm font-semibold text-white hover:bg-primary-dark">確認並進入後台</button>
        </form>
      </section>
    </main>
  );
}
