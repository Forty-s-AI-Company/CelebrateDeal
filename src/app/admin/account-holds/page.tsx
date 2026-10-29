import { releaseAccountSecurityHoldAction } from "@/app/actions/account-security-hold-actions";
import { CsrfField } from "@/components/csrf-field";
import { FormSubmitButton } from "@/components/form-submit-button";
import { StepUpMfaNotice } from "@/components/step-up-mfa-notice";
import { EmptyState, PageHeader } from "@/components/ui";
import { ACCOUNT_SECURITY_HOLDS_PATH, listAccountSecurityHolds } from "@/lib/account-security-hold";
import { requireFinanceAdmin } from "@/lib/auth";
import { recentMfaStatus } from "@/lib/recent-mfa";

export const dynamic = "force-dynamic";

function formatTime(value: Date | null) {
  return value ? new Intl.DateTimeFormat("zh-TW", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Taipei" }).format(value) : "—";
}

/**
 * 帳號安全暫停: accounts a login email change revert put on hold because an
 * MFA factor was enabled within its window. Platform admins only; addresses
 * are masked. Release only after verifying the owner as the runbook says.
 */
export default async function AdminAccountHoldsPage({ searchParams }: { searchParams: Promise<{ released?: string; error?: string }> }) {
  const { user, session } = await requireFinanceAdmin();
  const params = await searchParams;
  const holds = await listAccountSecurityHolds();
  const message = params.released ? "帳號已恢復。請對方用登入 Email 重設密碼後再登入。" : params.error ? "這個帳號目前沒有暫停，未做任何變更。" : null;

  return (
    <>
      <PageHeader
        title="帳號安全暫停"
        description="登入 Email 被舊信箱還原時，若帳號在變更前後一天內新設定了兩步驟驗證，系統無法判斷是誰設定的，會暫停帳號（不能登入、不能重設密碼），等客服確認身分。只顯示遮罩後的 Email。"
      />
      <div className="mb-4"><StepUpMfaNotice status={recentMfaStatus({ user, session })} nextPath={ACCOUNT_SECURITY_HOLDS_PATH} operation="恢復暫停的帳號" /></div>
      {message ? <p role={params.released ? "status" : "alert"} className={`mb-4 rounded-md px-3 py-2 text-sm ${params.released ? "bg-emerald-50 text-emerald-700" : "bg-red-50 text-red-700"}`}>{message}</p> : null}
      {holds.length === 0 ? <EmptyState title="目前沒有暫停的帳號" description="被暫停的帳號會列在這裡。" /> : (
        <div className="overflow-x-auto rounded-lg border border-border bg-white">
          <table className="w-full min-w-[640px] text-left text-sm">
            <thead className="bg-slate-50 text-slate-600">
              <tr>
                <th scope="col" className="px-4 py-3 font-semibold">登入 Email</th>
                <th scope="col" className="px-4 py-3 font-semibold">暫停時間</th>
                <th scope="col" className="px-4 py-3 font-semibold">兩步驟驗證</th>
                <th scope="col" className="px-4 py-3 font-semibold">恢復</th>
              </tr>
            </thead>
            <tbody>
              {holds.map((hold) => (
                <tr key={hold.userId} className="border-t border-border align-top">
                  <td className="px-4 py-3 font-mono text-slate-800">{hold.maskedEmail}</td>
                  <td className="px-4 py-3 text-slate-700">{formatTime(hold.heldAt)}</td>
                  <td className="px-4 py-3 text-slate-700">{hold.hasMfaFactor ? "已設定" : "未設定"}</td>
                  <td className="px-4 py-3">
                    <form action={releaseAccountSecurityHoldAction} className="grid gap-2">
                      <CsrfField />
                      <input type="hidden" name="userId" value={hold.userId} />
                      {hold.hasMfaFactor ? (
                        <label className="flex items-start gap-2 text-xs text-slate-700">
                          <input type="checkbox" name="removeMfaFactor" className="mt-0.5" />
                          <span>同時移除兩步驟驗證（無法確認是本人設定時勾選，對方之後需重新設定）</span>
                        </label>
                      ) : null}
                      <FormSubmitButton
                        pendingChildren="恢復中…"
                        pendingMessage="正在恢復帳號，請勿重複送出。"
                        className="h-9 rounded-md bg-primary px-3 text-sm font-semibold text-white hover:bg-primary-dark"
                      >
                        確認身分後恢復帳號
                      </FormSubmitButton>
                    </form>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
