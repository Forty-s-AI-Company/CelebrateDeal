import { requestAccountEmailChangeAction } from "@/app/actions/account-email-change-actions";
import { CsrfField } from "@/components/csrf-field";
import { FormSubmitButton } from "@/components/form-submit-button";
import { StepUpMfaNotice } from "@/components/step-up-mfa-notice";
import { Card, Field } from "@/components/ui";
import { ACCOUNT_EMAIL_CHANGE_TTL_MINUTES, LOGIN_EMAIL_MAX_LENGTH } from "@/lib/account-email-change-token";
import type { RecentMfaStatus } from "@/lib/recent-mfa";

/**
 * 「變更登入 Email」 on the security page. The form names no user; the action
 * takes the account from the session. Pending requests are deliberately not
 * shown here: a request for an address another account uses stores nothing,
 * so listing pending ones would reveal which addresses are taken.
 */
export function AccountEmailChangeCard({ currentEmail, mfaStatus }: { currentEmail: string; mfaStatus: RecentMfaStatus }) {
  return (
    <Card>
      <h2 className="mb-2 text-lg font-semibold text-slate-950">變更登入 Email</h2>
      <p className="mb-4 text-sm text-slate-500">目前的登入 Email：<strong className="break-all font-semibold text-slate-700">{currentEmail}</strong></p>
      {/* Only an account with a factor must re-verify; one without is not asked to enrol. */}
      {mfaStatus === "verification_required" ? <div className="mb-4"><StepUpMfaNotice status={mfaStatus} nextPath="/settings/security" operation="變更登入 Email" /></div> : null}
      <form action={requestAccountEmailChangeAction} className="grid gap-4">
        <CsrfField />
        <Field label="新的 Email" name="newEmail" type="email" autoComplete="email" maxLength={LOGIN_EMAIL_MAX_LENGTH} placeholder="name@example.com" required />
        <Field label="目前密碼" name="currentPassword" type="password" autoComplete="current-password" required />
        <p className="text-xs text-slate-500">我們會寄驗證連結到新的 Email（{ACCOUNT_EMAIL_CHANGE_TTL_MINUTES} 分鐘內有效），並通知目前的 Email。開啟連結後才會變更，所有裝置也會登出，之後請用新的 Email 登入。</p>
        <FormSubmitButton
          pendingChildren="寄送中…"
          pendingMessage="正在送出變更登入 Email 的要求，請勿重複送出。"
          className="h-10 rounded-md bg-primary px-4 text-sm font-semibold text-white hover:bg-primary-dark"
        >
          寄送驗證信到新的 Email
        </FormSubmitButton>
      </form>
    </Card>
  );
}
