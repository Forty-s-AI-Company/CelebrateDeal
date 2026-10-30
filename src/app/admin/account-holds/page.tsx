import { lookupAccountForMfaRemovalAction, releaseAccountSecurityHoldAction, removeAccountMfaAction } from "@/app/actions/account-security-hold-actions";
import { CsrfField } from "@/components/csrf-field";
import { FormSubmitButton } from "@/components/form-submit-button";
import { StepUpMfaNotice } from "@/components/step-up-mfa-notice";
import { EmptyState, PageHeader } from "@/components/ui";
import {
  ACCOUNT_MFA_REMOVAL_REASON_MAX_LENGTH,
  ACCOUNT_MFA_REMOVAL_REASON_MIN_LENGTH,
  ACCOUNT_SECURITY_HOLD_STATUS,
  ACCOUNT_SECURITY_HOLDS_PATH,
  describeAccountForMfaRemoval,
  listAccountSecurityHolds,
} from "@/lib/account-security-hold";
import { requireFinanceAdmin } from "@/lib/auth";
import { recentMfaStatus } from "@/lib/recent-mfa";

export const dynamic = "force-dynamic";

const USER_ID = /^[A-Za-z0-9_-]{1,64}$/u;
const INPUT = "h-10 w-full rounded-md border border-border bg-white px-3 text-sm";

const MFA_ERRORS: Record<string, string> = {
  not_found: "找不到這個登入 Email 的帳號，未做任何變更。",
  not_active: "這個帳號不是使用中狀態，未做任何變更。暫停中的帳號請用上方的恢復功能。",
  self: "不能移除自己帳號的兩步驟驗證，請依客服手冊的平台管理員程序處理。",
  platform_role: "平台管理員帳號不能用這個工具，請依客服手冊的雙人程序處理，未做任何變更。",
  confirmation_mismatch: "確認欄位與遮罩後的 Email 不一致，未做任何變更。",
  invalid_reason: `請填寫原因（${ACCOUNT_MFA_REMOVAL_REASON_MIN_LENGTH}–${ACCOUNT_MFA_REMOVAL_REASON_MAX_LENGTH} 字），未做任何變更。`,
  nothing_to_remove: "這個帳號沒有兩步驟驗證或備用碼，未做任何變更。",
};

function formatTime(value: Date | null) {
  return value ? new Intl.DateTimeFormat("zh-TW", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Taipei" }).format(value) : "—";
}

function statusLabel(status: string) {
  if (status === "active") return "使用中";
  if (status === ACCOUNT_SECURITY_HOLD_STATUS) return "安全暫停";
  return "停用";
}

type SearchParams = { released?: string; error?: string; mfaUser?: string; mfaError?: string; mfaRemoved?: string };

/**
 * 帳號安全暫停: accounts a login email change revert or cancel put on hold
 * because an MFA factor was enabled within its window, plus the support tool
 * that removes MFA from an active account. Platform admins only; addresses
 * are masked. Act only after verifying the owner as the runbook says.
 */
export default async function AdminAccountHoldsPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const { user, session } = await requireFinanceAdmin();
  const params = await searchParams;
  const holds = await listAccountSecurityHolds();
  const message = params.released ? "帳號已恢復。請對方用登入 Email 重設密碼後再登入。" : params.error ? "這個帳號目前沒有暫停，未做任何變更。" : null;
  const mfaStatus = recentMfaStatus({ user, session });
  const target = typeof params.mfaUser === "string" && USER_ID.test(params.mfaUser) ? await describeAccountForMfaRemoval(params.mfaUser) : null;
  const mfaMessage = params.mfaRemoved
    ? "已移除兩步驟驗證與備用碼、停用密碼並登出該帳號所有裝置，登入 Email 會收到通知。請對方用「忘記密碼」重新設定密碼，登入後再設定兩步驟驗證。"
    : params.mfaError ? MFA_ERRORS[params.mfaError] ?? MFA_ERRORS.not_found : null;
  const ownAccount = target?.userId === user.id;

  return (
    <>
      <PageHeader
        title="帳號安全暫停"
        description="舊信箱用「不是我操作」連結還原登入 Email 或取消變更時，若帳號在變更前後一天內新設定了兩步驟驗證，系統無法判斷是誰設定的，會暫停帳號（不能登入、不能重設密碼），等客服確認身分。只顯示遮罩後的 Email。"
      />
      <div className="mb-4"><StepUpMfaNotice status={mfaStatus} nextPath={ACCOUNT_SECURITY_HOLDS_PATH} operation="恢復暫停的帳號或移除兩步驟驗證" /></div>
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

      <section id="mfa-removal" aria-labelledby="mfa-removal-title" className="mt-8 rounded-lg border border-border bg-white p-4 sm:p-6">
        <h2 id="mfa-removal-title" className="text-lg font-semibold text-slate-950">移除兩步驟驗證</h2>
        <p className="mt-1 text-sm leading-6 text-slate-600">
          給沒有被暫停、但無法通過兩步驟驗證的帳號使用（例如手機遺失，或驗證器不是本人設定的）。依客服流程確認本人身分後才能操作；會刪除該帳號的兩步驟驗證與所有備用碼、停用密碼、登出所有裝置，並寄一封沒有連結的通知到登入 Email；對方之後只能用「忘記密碼」重新設定密碼。不能用在自己的帳號或平台管理員帳號。
        </p>
        {mfaMessage ? <p role={params.mfaRemoved ? "status" : "alert"} className={`mt-4 rounded-md px-3 py-2 text-sm ${params.mfaRemoved ? "bg-emerald-50 text-emerald-700" : "bg-red-50 text-red-700"}`}>{mfaMessage}</p> : null}

        <form action={lookupAccountForMfaRemovalAction} className="mt-4 grid gap-2 sm:grid-cols-[1fr_auto] sm:items-end">
          <CsrfField />
          <label className="grid gap-1 text-sm text-slate-700">
            <span className="font-semibold">登入 Email</span>
            <input type="email" name="email" required autoComplete="off" maxLength={254} className={INPUT} />
          </label>
          <FormSubmitButton
            pendingChildren="查詢中…"
            pendingMessage="正在查詢帳號。"
            className="h-10 rounded-md border border-border px-4 text-sm font-semibold text-slate-700 hover:bg-slate-50"
          >
            查詢帳號
          </FormSubmitButton>
        </form>

        {target ? (
          <div className="mt-6 grid gap-4 border-t border-border pt-4">
            <dl className="grid gap-2 text-sm sm:grid-cols-2">
              <div><dt className="text-slate-500">登入 Email（遮罩）</dt><dd className="font-mono text-slate-900">{target.maskedEmail}</dd></div>
              <div><dt className="text-slate-500">帳號 ID</dt><dd className="break-all font-mono text-slate-900">{target.userId}</dd></div>
              <div><dt className="text-slate-500">狀態</dt><dd className="text-slate-900">{statusLabel(target.status)}{target.isPlatformAdmin ? "（平台管理員）" : ""}</dd></div>
              <div><dt className="text-slate-500">兩步驟驗證／備用碼</dt><dd className="text-slate-900">{target.hasMfaFactor ? "已設定" : "未設定"}／{target.recoveryCodeCount} 組</dd></div>
            </dl>
            {ownAccount ? (
              <p role="alert" className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-900">這是你自己的帳號，不能用這個工具移除兩步驟驗證。</p>
            ) : target.isPlatformAdmin ? (
              <p role="alert" className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-900">平台管理員帳號不能用這個工具，請依客服手冊的雙人程序處理。</p>
            ) : target.status !== "active" ? (
              <p role="alert" className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-900">這個帳號不是使用中狀態，不能用這個工具。暫停中的帳號請用上方的恢復功能。</p>
            ) : (
              <form action={removeAccountMfaAction} className="grid gap-3">
                <CsrfField />
                <input type="hidden" name="userId" value={target.userId} />
                <label className="grid gap-1 text-sm text-slate-700">
                  <span className="font-semibold">原因（會寫入稽核紀錄，不要填完整 Email、密碼或驗證碼）</span>
                  <textarea
                    name="reason"
                    required
                    minLength={ACCOUNT_MFA_REMOVAL_REASON_MIN_LENGTH}
                    maxLength={ACCOUNT_MFA_REMOVAL_REASON_MAX_LENGTH}
                    rows={3}
                    className="w-full rounded-md border border-border bg-white px-3 py-2 text-sm"
                  />
                </label>
                <label className="grid gap-1 text-sm text-slate-700">
                  <span className="font-semibold">請輸入上方遮罩後的 Email 確認：<span className="font-mono">{target.maskedEmail}</span></span>
                  <input type="text" name="confirmation" required autoComplete="off" spellCheck={false} className={INPUT} />
                </label>
                <FormSubmitButton
                  pendingChildren="移除中…"
                  pendingMessage="正在移除兩步驟驗證，請勿重複送出。"
                  className="h-10 rounded-md bg-red-600 px-4 text-sm font-semibold text-white hover:bg-red-700"
                >
                  確認身分後移除兩步驟驗證
                </FormSubmitButton>
              </form>
            )}
          </div>
        ) : null}
      </section>
    </>
  );
}
