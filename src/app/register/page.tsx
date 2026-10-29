import Link from "next/link";
import { registerAction } from "@/app/actions/registration-actions";
import { CsrfField } from "@/components/csrf-field";
import { FormSubmitButton } from "@/components/form-submit-button";
import { getDb } from "@/lib/db";
import { verifyMerchantRegistrationInvite } from "@/lib/merchant-registration-invite";
import { isMerchantRegistrationInviteRevoked } from "@/lib/merchant-registration-invite-records";
import { PASSWORD_HINT, PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH, PASSWORD_POLICY_MESSAGES } from "@/lib/password-policy";
import { merchantRegistrationPolicyVersions, publicSupportContact } from "@/lib/public-policy-content";
import { REGISTRATION_INVITE_ONLY_MESSAGE, registrationMode } from "@/lib/registration-mode";
import { TurnstileWidget } from "@/components/turnstile-widget";
import { TURNSTILE_ACTIONS, TURNSTILE_ERROR_MESSAGES, turnstileSiteKey } from "@/lib/turnstile";

// The registration Server Action sends the email verification link with
// `after()` inside this limit (see IMMEDIATE_EMAIL_DISPATCH_MAX_DURATION_SECONDS).
export const maxDuration = 60;

const errors: Record<string, string> = { invalid: "請確認資料完整，密碼至少 8 個字元。", common: PASSWORD_POLICY_MESSAGES.common, personal: PASSWORD_POLICY_MESSAGES.personal, exists: "這個 Email 已註冊，請直接登入。", rate_limited: "註冊嘗試過多，請稍後再試。", temporarily_unavailable: "註冊保護服務暫時無法使用。", consent_required: "請先閱讀並勾選同意使用條款與隱私通知。", policy_updated: "使用條款或隱私通知已更新，請重新閱讀後再勾選同意。", invite_mismatch: "Email 必須和邀請連結上的 Email 相同。", ...TURNSTILE_ERROR_MESSAGES };

const INVITE_PROBLEMS = {
  invalid: "這個邀請連結無效或已過期，請聯絡平台重新取得。",
  revoked: "這個邀請連結已被平台撤銷，請聯絡平台重新取得。",
} as const;

function InviteOnlyNotice({ problem }: { problem: keyof typeof INVITE_PROBLEMS | null }) {
  return (
    <main className="grid min-h-screen place-items-center bg-gradient-to-b from-blue-50 to-white px-4 py-8">
      <section className="w-full max-w-lg rounded-2xl border border-slate-200 bg-white p-6 shadow-xl sm:p-8" data-registration-mode="invite">
        <p className="text-sm font-bold text-blue-700">CelebrateDeal</p>
        <h1 className="mt-2 text-3xl font-bold text-slate-950">受邀商家註冊</h1>
        {problem ? <p role="alert" className="mt-4 rounded-lg bg-red-50 p-3 text-sm text-red-700">{INVITE_PROBLEMS[problem]}</p> : null}
        <p className="mt-4 text-sm leading-6 text-slate-700">{REGISTRATION_INVITE_ONLY_MESSAGE}</p>
        <p className="mt-3 text-sm leading-6 text-slate-600">
          還沒收到邀請，或連結打不開？請來信{" "}
          <a href={`mailto:${publicSupportContact.email}`} className="break-all font-semibold text-blue-700 underline-offset-2 hover:underline">{publicSupportContact.email}</a>
          ，或到<Link href="/support" className="font-semibold text-blue-700 underline-offset-2 hover:underline">客服中心</Link>留言。
        </p>
        <p className="mt-6 text-center text-sm text-slate-600">已經有帳號？ <Link href="/login" className="font-semibold text-blue-700 hover:underline">返回登入</Link></p>
      </section>
    </main>
  );
}

function ExistingAccountNotice() {
  return (
    <main className="grid min-h-screen place-items-center bg-gradient-to-b from-blue-50 to-white px-4 py-8">
      <section className="w-full max-w-lg rounded-2xl border border-slate-200 bg-white p-6 shadow-xl sm:p-8" data-registration-state="account_exists">
        <p className="text-sm font-bold text-blue-700">CelebrateDeal</p>
        <h1 className="mt-2 text-3xl font-bold text-slate-950">你已經有帳號了</h1>
        <p className="mt-4 text-sm leading-6 text-slate-700">這個邀請的 Email 已經建立過帳號，請直接登入。忘記密碼可以在登入頁重設。</p>
        <Link href="/login" className="mt-6 inline-flex min-h-11 w-full items-center justify-center rounded-xl bg-blue-600 px-5 font-semibold text-white hover:bg-blue-700">前往登入</Link>
      </section>
    </main>
  );
}

export default async function RegisterPage({ searchParams }: { searchParams: Promise<{ error?: string; invite?: string | string[] }> }) {
  const { error, invite: inviteParam } = await searchParams;
  const inviteOnly = registrationMode() === "invite";
  const inviteToken = typeof inviteParam === "string" ? inviteParam : null;
  // The page only decides what to show; the action verifies the token again.
  const verified = verifyMerchantRegistrationInvite(inviteToken);
  const revoked = verified ? await isMerchantRegistrationInviteRevoked(verified.jti) : false;
  const invite = verified && !revoked ? verified : null;
  if (inviteOnly && !invite) {
    const problem = revoked || error === "invite_revoked" ? "revoked" : inviteParam !== undefined || error === "invite_required" ? "invalid" : null;
    return <InviteOnlyNotice problem={problem} />;
  }
  // Only the token holder reaches this, so it reveals nothing new about the address.
  if (invite && await getDb().user.findUnique({ where: { email: invite.email }, select: { id: true } })) return <ExistingAccountNotice />;

  const { consentVersion } = merchantRegistrationPolicyVersions();
  const siteKey = turnstileSiteKey();
  return <main className="grid min-h-screen place-items-center bg-gradient-to-b from-blue-50 to-white px-4 py-8"><section className="w-full max-w-lg rounded-2xl border border-slate-200 bg-white p-6 shadow-xl sm:p-8" data-registration-mode={inviteOnly ? "invite" : "open"}><p className="text-sm font-bold text-blue-700">CelebrateDeal</p><h1 className="mt-2 text-3xl font-bold text-slate-950">建立你的商家帳號</h1><p className="mt-2 text-sm leading-6 text-slate-600">{invite ? "你已受邀加入 CelebrateDeal 封測。" : null}完成註冊後，我們會用 60 秒問卷替你準備第一個銷售專案。</p>{error ? <p role="alert" className="mt-4 rounded-lg bg-red-50 p-3 text-sm text-red-700">{errors[error] ?? "註冊失敗，請稍後再試。"}</p> : null}<form action={registerAction} className="mt-6 grid gap-4"><CsrfField />{invite && inviteToken ? <input type="hidden" name="invite" value={inviteToken} /> : null}<label className="grid gap-1.5 text-sm font-semibold text-slate-700">你的姓名<input name="name" required minLength={2} maxLength={120} autoComplete="name" className="h-11 rounded-lg border border-slate-200 px-3" /></label><label className="grid gap-1.5 text-sm font-semibold text-slate-700">商家名稱<input name="workspaceName" required minLength={2} maxLength={120} autoComplete="organization" className="h-11 rounded-lg border border-slate-200 px-3" /></label>{invite ? <div className="grid gap-1.5"><label className="grid gap-1.5 text-sm font-semibold text-slate-700">Email<input name="email" type="email" required readOnly defaultValue={invite.email} maxLength={320} autoComplete="email" aria-describedby="register-invite-email-hint" className="h-11 rounded-lg border border-slate-200 bg-slate-50 px-3 text-slate-700" /></label><span id="register-invite-email-hint" className="text-sm font-normal text-slate-500">這是受邀的 Email，無法修改。</span></div> : <label className="grid gap-1.5 text-sm font-semibold text-slate-700">Email<input name="email" type="email" required maxLength={320} autoComplete="email" className="h-11 rounded-lg border border-slate-200 px-3" /></label>}<div className="grid gap-1.5"><label className="grid gap-1.5 text-sm font-semibold text-slate-700">密碼<input name="password" type="password" required minLength={PASSWORD_MIN_LENGTH} maxLength={PASSWORD_MAX_LENGTH} autoComplete="new-password" aria-describedby="register-password-hint" className="h-11 rounded-lg border border-slate-200 px-3" /></label><span id="register-password-hint" className="text-sm font-normal text-slate-500">{PASSWORD_HINT}</span></div><input type="hidden" name="policyVersion" value={consentVersion} /><label className="flex items-start gap-2 text-sm leading-6 text-slate-700"><input name="acceptPolicies" type="checkbox" required className="mt-1 h-4 w-4 shrink-0 rounded border-slate-300" /><span>我已閱讀並同意<Link href="/policies/terms" target="_blank" rel="noopener noreferrer" className="font-semibold text-blue-700 underline-offset-2 hover:underline">使用條款</Link>與<Link href="/policies/privacy" target="_blank" rel="noopener noreferrer" className="font-semibold text-blue-700 underline-offset-2 hover:underline">隱私通知</Link><span className="text-slate-500">（版本 {consentVersion}）</span></span></label>{siteKey ? <TurnstileWidget siteKey={siteKey} action={TURNSTILE_ACTIONS.register} /> : null}<p className="text-sm leading-6 text-slate-500">註冊後我們會寄一封驗證信到這個 Email，請在 24 小時內開啟信中的連結完成驗證。</p><FormSubmitButton pendingChildren="建立中…" pendingMessage="正在安全建立帳號與工作空間，請勿重複送出。" className="min-h-11 rounded-xl bg-blue-600 px-5 font-semibold text-white hover:bg-blue-700">建立帳號並開始設定</FormSubmitButton></form><p className="mt-5 text-center text-sm text-slate-600">已經有帳號？ <Link href="/login" className="font-semibold text-blue-700 hover:underline">返回登入</Link></p></section></main>;
}
