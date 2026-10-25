import Link from "next/link";
import { acceptVendorMemberInvitationAction } from "@/app/actions/vendor-member-invitation-actions";
import { CsrfField } from "@/components/csrf-field";
import { FormSubmitButton } from "@/components/form-submit-button";
import { getCurrentAuth, requireAuth } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { PASSWORD_HINT, PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH, PASSWORD_POLICY_MESSAGES } from "@/lib/password-policy";
import { merchantRegistrationPolicyVersions } from "@/lib/public-policy-content";
import { findPendingVendorMemberInvitation } from "@/lib/vendor-member-invitation";
import { vendorMemberRoleLabel } from "@/lib/vendor-roles";


const errorMessages: Record<string, string> = {
  invalid: "邀請連結無效、已使用或已過期。請向商家索取新的邀請。",
  login_required: "這個 Email 已有帳號，請先登入後再開啟邀請連結。",
  wrong_account: "目前登入的帳號不是受邀的 Email。請登出後以受邀帳號登入，再開啟邀請連結。",
  account_exists: "這個 Email 剛建立了帳號，請先登入後再開啟邀請連結。",
  last_owner: "接受後商家將沒有任何 owner，請先請其他 owner 處理。",
  retry: "剛好有其他操作同時進行，邀請還沒有接受。請再按一次接受邀請。",
  ...PASSWORD_POLICY_MESSAGES,
  mismatch: "兩次輸入的密碼不一致。",
  consent_required: "請先閱讀並勾選同意使用條款與隱私通知。",
  policy_updated: "使用條款或隱私通知已更新，請重新閱讀後再勾選同意。",
  rate_limited: "嘗試次數過多，請稍後再試。",
  temporarily_unavailable: "服務暫時無法使用，請稍後再試。",
};

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main className="grid min-h-screen place-items-center bg-background px-4 py-8">
      <section className="w-full max-w-md rounded-lg border border-border bg-white p-6 shadow-sm">
        <p className="text-sm font-semibold text-primary">CelebrateDeal</p>
        {children}
      </section>
    </main>
  );
}

/**
 * F-029 / B02-06: the invitee's side of a vendor member invitation. Nothing
 * here changes data; acceptance is a separate, CSRF-protected POST.
 */
export default async function AcceptVendorInvitationPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string; error?: string }>;
}) {
  const params = await searchParams;
  const token = typeof params.token === "string" ? params.token : "";
  const error = params.error ? <p role="alert" className="mt-4 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{errorMessages[params.error] ?? "無法接受邀請。"}</p> : null;
  // No vendor context is required: an invitee may have no active membership
  // yet (#462 M1). A session whose factor is not verified finishes MFA first
  // and comes back here.
  const session = await getCurrentAuth({ allowUnverifiedMfa: true });
  const returnPath = token ? `/invitations/accept?token=${encodeURIComponent(token)}` : "/invitations/accept";
  const auth = session ? await requireAuth({ nextPath: returnPath }) : null;
  const invitation = token ? await findPendingVendorMemberInvitation(getDb(), token) : null;
  const invitee = invitation
    ? await getDb().user.findUnique({ where: { email: invitation.email }, select: { id: true, status: true, platformRole: true } })
    : null;
  // Platform administrators and suspended accounts can never accept; they see
  // the same message as an expired link.
  if (!invitation || (invitee && (invitee.status !== "active" || invitee.platformRole !== "none"))) {
    return (
      <Shell>
        <h1 className="mt-2 text-2xl font-semibold text-slate-950">{!token && auth ? "接受商家邀請" : "邀請已失效"}</h1>
        <p className="mt-2 text-sm text-slate-600">{!token && auth ? "你已登入。請開啟邀請信中的連結以檢視並接受邀請。" : errorMessages.invalid}</p>
        <p className="mt-6 text-sm"><Link href="/login" className="font-semibold text-primary hover:underline">前往登入</Link></p>
      </Shell>
    );
  }

  const loginHref = `/login?next=${encodeURIComponent(returnPath)}`;
  const summary = (
    <>
      <h1 className="mt-2 text-2xl font-semibold text-slate-950">加入 {invitation.vendor.name}</h1>
      <p className="mt-2 text-sm text-slate-600">
        受邀 Email：<span className="font-semibold text-slate-900">{invitation.email}</span>，角色：{vendorMemberRoleLabel(invitation.role)}。接受後才會加入，連結在 {invitation.expiresAt.toLocaleString("zh-TW", { timeZone: "Asia/Taipei" })} 前有效。
      </p>
      {error}
    </>
  );
  const hidden = <><CsrfField /><input type="hidden" name="token" value={token} /></>;

  if (invitee) {
    if (auth?.user.id === invitee.id) {
      return (
        <Shell>
          {summary}
          <form action={acceptVendorMemberInvitationAction} className="mt-6 grid gap-3">
            {hidden}
            <FormSubmitButton pendingChildren="加入中…" pendingMessage="正在加入商家，請勿重複送出。" className="h-11 rounded-md bg-primary text-sm font-semibold text-white hover:bg-primary-dark">
              接受邀請
            </FormSubmitButton>
          </form>
        </Shell>
      );
    }
    return (
      <Shell>
        {summary}
        <p className="mt-4 rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-900">
          {auth ? errorMessages.wrong_account : "請先以受邀的 Email 登入（若已啟用雙重驗證也需完成驗證），登入後會回到這個邀請。"}
        </p>
        {auth ? null : <p className="mt-6 text-sm"><Link href={loginHref} className="font-semibold text-primary hover:underline">登入並接受邀請</Link></p>}
      </Shell>
    );
  }

  if (auth) {
    return (
      <Shell>
        {summary}
        <p className="mt-4 rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-900">{errorMessages.wrong_account}</p>
      </Shell>
    );
  }

  const { consentVersion } = merchantRegistrationPolicyVersions();
  return (
    <Shell>
      {summary}
      <form action={acceptVendorMemberInvitationAction} className="mt-6 grid gap-4">
        {hidden}
        <label className="grid gap-1.5 text-sm font-medium text-slate-700">
          姓名
          <input name="name" defaultValue={invitation.name} required maxLength={120} autoComplete="name" className="h-10 rounded-md border border-border px-3" />
        </label>
        <div className="grid gap-1.5">
          <label className="grid gap-1.5 text-sm font-medium text-slate-700">
            設定密碼
            <input name="password" type="password" autoComplete="new-password" minLength={PASSWORD_MIN_LENGTH} maxLength={PASSWORD_MAX_LENGTH} required aria-describedby="invitation-password-hint" className="h-10 rounded-md border border-border px-3" />
          </label>
          <span id="invitation-password-hint" className="text-xs font-normal text-slate-600">{PASSWORD_HINT}</span>
        </div>
        <label className="grid gap-1.5 text-sm font-medium text-slate-700">
          確認密碼
          <input name="confirmPassword" type="password" autoComplete="new-password" minLength={PASSWORD_MIN_LENGTH} maxLength={PASSWORD_MAX_LENGTH} required className="h-10 rounded-md border border-border px-3" />
        </label>
        <input type="hidden" name="policyVersion" value={consentVersion} />
        <label className="flex items-start gap-2 text-sm leading-6 text-slate-700">
          <input name="acceptPolicies" type="checkbox" required className="mt-1 h-4 w-4 shrink-0 rounded border-slate-300" />
          <span>我已閱讀並同意<Link href="/policies/terms" target="_blank" rel="noopener noreferrer" className="font-semibold text-blue-700 underline-offset-2 hover:underline">使用條款</Link>與<Link href="/policies/privacy" target="_blank" rel="noopener noreferrer" className="font-semibold text-blue-700 underline-offset-2 hover:underline">隱私通知</Link><span className="text-slate-500">（版本 {consentVersion}）</span></span>
        </label>
        <FormSubmitButton pendingChildren="建立中…" pendingMessage="正在建立帳號並加入商家，請勿重複送出。" className="h-11 rounded-md bg-primary text-sm font-semibold text-white hover:bg-primary-dark">
          建立帳號並接受邀請
        </FormSubmitButton>
      </form>
    </Shell>
  );
}
