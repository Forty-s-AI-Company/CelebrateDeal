import { MfaReturnField } from "@/components/mfa-return-field";
import { safeMfaReturnPath } from "@/lib/mfa-return-path";
import { isPasswordResetSmokeEnabled } from "@/lib/password-reset-smoke-policy";
import { cookies } from "next/headers";
import Image from "next/image";
import QRCode from "qrcode";
import {
  changeVendorMemberRoleAction,
  createVendorMemberAction,
  deactivateVendorMemberAction,
  logoutAction,
  regenerateRecoveryCodesAction,
  revokeAllSessionsAction,
  revokeOtherSessionsAction,
  resendVendorMemberInvitationAction,
  revokeVendorMemberInvitationAction,
  sendPasswordResetSmokeAction,
  updatePasswordAction,
} from "@/app/actions";
import { CsrfField } from "@/components/csrf-field";
import { FormSubmitButton } from "@/components/form-submit-button";
import { MfaEnrollmentForm } from "@/components/mfa-enrollment-form";
import { VendorMemberDeactivationConfirmation } from "@/components/vendor-member-deactivation-confirmation";
import { VendorMemberRoleDowngradeForm } from "@/components/vendor-member-role-downgrade-form";
import { Badge, ButtonLink, Card, DangerButton, Field, PageHeader, SelectField, SubmitButton } from "@/components/ui";
import { getDb } from "@/lib/db";
import { applyE2eLoadingDelay } from "@/lib/e2e-loading-diagnostic";
import { generateTotpUri, MFA_RECOVERY_COOKIE, MFA_SETUP_COOKIE, parsePendingMfaSetup, parseRecoveryCodes } from "@/lib/mfa";
import { requireAuth } from "@/lib/auth";
import { StepUpMfaNotice } from "@/components/step-up-mfa-notice";
import { loadPendingVendorInvitations, PendingVendorInvitations } from "@/components/pending-vendor-invitations";
import { recentMfaStatus } from "@/lib/recent-mfa";
import { statusLabel } from "@/lib/status-labels";

const errorMessages: Record<string, string> = {
  current_password: "目前密碼不正確。",
  short: "密碼至少需要 12 個字元。",
  password_mismatch: "新密碼與確認密碼不一致。",
  password_reuse: "新密碼不能與目前密碼相同。",
  owner_required: "只有商家 owner 可以管理成員。",
  member_invalid: "請確認成員姓名、Email 與角色都已填寫。",
  member_invitation_rate_limited: "邀請次數過多，請稍候再試；未建立邀請。",
  member_invitation_unavailable: "邀請頻率檢查暫時無法使用；未建立邀請，請稍候再試。",
  member_invitation_not_found: "找不到可撤銷的待接受邀請。",
  self_invite: "不能邀請自己的 Email。",
  member_role_invalid: "請選擇有效的角色。",
  member_role_upgrade: "調高角色需寄送邀請並由對方接受。",
  member_invitation_resend_invalid: "找不到可重寄邀請的 active 商家成員。",
  member_invitation_resend_failed: "設定密碼邀請信寄送失敗，請稍後再試。",
  self_role: "不能把自己的 owner 權限降級。",
  self_deactivate: "不能停用自己的帳號。",
  last_owner: "至少要保留一位 active owner。",
  member_not_found: "找不到可停用的成員。",
  member_confirmation: "請輸入要停用成員的 Email 以確認操作。",
  mfa_required: "此操作需要先啟用 MFA。",
  mfa_code: "TOTP 驗證碼不正確。",
  recovery_rate_limited: "Recovery codes 重建嘗試次數過多，請 15 分鐘後再試。",
  recovery_unavailable: "Recovery codes 驗證保護暫時無法使用，請稍後再試。",
  password_reset_smoke: "密碼重設測試信寄送失敗，請檢查 Resend 設定。",
  password_reset_smoke_recipient: "目前帳號不是允許的測試收件人，未寄出測試信。",
  password_reset_smoke_rate_limited: "測試信寄送次數過多，請 15 分鐘後再試。",
  password_reset_smoke_unavailable: "測試信寄送保護暫時無法使用，請稍後再試。",
};

const updatedMessages: Record<string, string> = {
  "1": "密碼已更新。",
  member_invited: "已建立邀請。若這個 Email 可以加入，對方會收到邀請信；對方接受後才會成為成員。",
  member_invitation_revoked: "邀請已撤銷，原連結不能再使用。",
  member_role_downgraded: "成員角色已調降。",
  member_invitation_resent: "已重新寄出設定密碼邀請信。",
  member_deactivated: "商家成員已停用，相關登入狀態已結束。",
  sessions_revoked: "其他裝置的登入狀態已結束。",
  mfa_started: "請用驗證器 App 掃描或手動輸入密鑰，然後輸入 6 位數驗證碼完成啟用。",
  mfa_enabled: "MFA 已啟用，請妥善保存 recovery codes。",
  mfa_exists: "這個帳號已經啟用 MFA。",
  recovery_regenerated: "已重新產生 recovery codes，舊的 codes 已失效。",
  password_reset_smoke: "已寄出 password reset 測試信到目前帳號 Email。",
};

export default async function SecuritySettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ updated?: string; error?: string; next?: string }>;
}) {
  await applyE2eLoadingDelay();
  const params = await searchParams;
  const nextPath = safeMfaReturnPath(params.next);
  const auth = await requireAuth({ nextPath });
  const db = getDb();
  const vendorId = auth.vendor?.id;
  const isOwner = auth.member?.role === "owner";
  const cookieStore = await cookies();
  const parsedPendingMfa = parsePendingMfaSetup(cookieStore.get(MFA_SETUP_COOKIE)?.value);
  const pendingMfa = parsedPendingMfa?.userId === auth.user.id ? parsedPendingMfa : null;
  const recoveryCodes = parseRecoveryCodes(cookieStore.get(MFA_RECOVERY_COOKIE)?.value);
  const mfaUri = pendingMfa ? generateTotpUri({ email: auth.user.email, secret: pendingMfa.secret }) : null;
  // Generate locally from this user's pending setup; never send the secret to an external QR service.
  const mfaQrCode = mfaUri
    ? await QRCode.toDataURL(mfaUri, {
        errorCorrectionLevel: "M",
        margin: 1,
        width: 224,
        color: { dark: "#0f172a", light: "#ffffff" },
      })
    : null;
  const activeRecoveryCodeCount = auth.user.recoveryCodes.filter((code) => !code.usedAt).length;
  // The local and E2E PostgreSQL instances intentionally use a one-connection
  // pool. Keep these independent reads serial so a Server Action cannot wait
  // behind a sibling query while this page is still rendering.
  const members = isOwner && vendorId
    ? await db.vendorMember.findMany({
        where: { vendorId },
        include: { user: true },
        orderBy: [{ status: "asc" }, { createdAt: "asc" }],
      })
    : [];
  const pendingInvitations = await loadPendingVendorInvitations(isOwner, vendorId);
  const sessions = await db.userSession.findMany({
    where: {
      userId: auth.user.id,
      expiresAt: { gt: new Date() },
    },
    orderBy: { createdAt: "desc" },
    take: 8,
  });

  return (
    <>
      <PageHeader title="安全性" description={isOwner ? "管理登入密碼、登入狀態、商家成員與最小權限控管。" : "管理自己的登入密碼、登入狀態與多因子驗證。"} action={isOwner ? <ButtonLink href="/settings/team" tone="secondary">前往團隊管理</ButtonLink> : undefined} />
      {params.updated ? <p role="status" aria-live="polite" className="mb-4 rounded-md bg-emerald-50 px-3 py-2 text-sm text-emerald-700">{updatedMessages[params.updated] ?? "已更新。"}</p> : null}
      {params.error ? <p role="alert" className="mb-4 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{errorMessages[params.error] ?? "操作失敗，請確認權限與輸入內容。"}</p> : null}
      <div className="grid gap-5 lg:grid-cols-2">
        <Card>
          <h2 className="mb-4 text-lg font-semibold text-slate-950">更新密碼</h2>
          <form action={updatePasswordAction} className="grid gap-4">
            <CsrfField />
            <Field label="目前密碼" name="currentPassword" type="password" autoComplete="current-password" required />
            <Field label="新密碼" name="password" type="password" autoComplete="new-password" minLength={12} required />
            <Field label="確認新密碼" name="confirmPassword" type="password" autoComplete="new-password" minLength={12} required />
            <p className="text-xs text-slate-500">更新後會撤銷所有裝置的登入狀態，請用新密碼重新登入。</p>
            <SubmitButton>更新密碼並全部登出</SubmitButton>
          </form>
        </Card>
        <Card>
          <h2 className="mb-2 text-lg font-semibold text-slate-950">登出此裝置</h2>
          <p className="mb-4 text-sm text-slate-500">登入狀態儲存在伺服器並以安全 Cookie 識別；登出會結束目前登入並清除瀏覽器 Cookie。</p>
          <form action={logoutAction}>
            <CsrfField />
            <DangerButton>登出</DangerButton>
          </form>
        </Card>
      </div>

      <div className="mt-5 grid gap-5 lg:grid-cols-[1.1fr_0.9fr]">
        <Card>
          <div className="mb-4 flex items-start justify-between gap-4">
            <div>
              <h2 className="text-lg font-semibold text-slate-950">多因子驗證</h2>
              <p className="mt-1 text-sm text-slate-500">你可以自行啟用 TOTP；啟用後，每次新登入都需要驗證。Recovery code 只顯示一次。</p>
            </div>
            <Badge tone={auth.user.mfaFactor ? "green" : "blue"}>{auth.user.mfaFactor ? "已啟用" : "可自行啟用"}</Badge>
          </div>

          {auth.user.mfaFactor ? (
            <div className="rounded-lg border border-emerald-100 bg-emerald-50/70 p-4">
              <p className="text-sm font-semibold text-emerald-900">MFA 已啟用</p>
              <p className="mt-1 text-sm text-emerald-800">
                上次使用：{auth.user.mfaFactor.lastUsedAt ? auth.user.mfaFactor.lastUsedAt.toLocaleString("zh-TW") : "尚未記錄"}
              </p>
              <p className="mt-1 text-sm text-emerald-800">目前登入狀態：{auth.isMfaVerified ? "已完成 MFA 驗證" : "尚未完成 MFA 驗證"}</p>
              <p className="mt-1 text-sm text-emerald-800">可用 recovery codes：{activeRecoveryCodeCount}</p>
            </div>
          ) : pendingMfa ? (
            <div className="grid gap-4">
              <div className="grid justify-items-center gap-3 rounded-lg border border-blue-100 bg-blue-50/70 p-5 text-center">
                <p className="text-sm font-semibold text-slate-900">使用驗證器 App 掃描 QR Code</p>
                {mfaQrCode ? (
                  <Image
                    src={mfaQrCode}
                    alt="CelebrateDeal TOTP 設定 QR Code"
                    width={224}
                    height={224}
                    unoptimized
                    className="rounded-xl bg-white p-2 shadow-sm"
                  />
                ) : null}
                <p className="text-xs text-slate-600">掃描後，請輸入 App 顯示的 6 位數驗證碼完成啟用。</p>
              </div>
              <details className="rounded-lg border border-slate-200 bg-slate-50/70 p-4">
                <summary className="cursor-pointer text-sm font-semibold text-slate-700">無法掃描 QR Code？顯示手動密鑰</summary>
                <p className="mt-3 font-mono text-sm text-slate-700">{pendingMfa.secret}</p>
                <p className="mt-2 text-xs text-slate-500">Issuer 請填 `CelebrateDeal`。</p>
              </details>
              <MfaEnrollmentForm csrfField={<CsrfField />} nextPath={nextPath} />
            </div>
          ) : (
            <form action="/api/settings/security/mfa/start" method="post" className="grid gap-3">
              <CsrfField />
                  <MfaReturnField nextPath={nextPath} />
              <p className="rounded-lg border border-orange-100 bg-orange-50 p-4 text-sm text-orange-800">
                尚未啟用 MFA。你可以繼續使用目前的帳號權限，也可以選擇啟用以加強登入保護。
              </p>
              <SubmitButton>開始設定 TOTP</SubmitButton>
            </form>
          )}
        </Card>

        <Card>
          <h2 className="mb-3 text-lg font-semibold text-slate-950">Recovery Codes</h2>
          {recoveryCodes?.length ? (
            <>
              <div className="grid gap-2 rounded-lg border border-blue-100 bg-blue-50/70 p-4">
                {recoveryCodes.map((code: string) => (
                  <div key={code} className="font-mono text-sm font-semibold text-slate-800">{code}</div>
                ))}
              </div>
                <form action="/api/settings/security/mfa/recovery-codes/dismiss" method="post" className="mt-4">
                <CsrfField />
                  <MfaReturnField nextPath={nextPath} />
                <SubmitButton>我已保存 recovery codes</SubmitButton>
              </form>
            </>
          ) : (
            <div className="grid gap-3">
              <div className="rounded-lg border border-border bg-slate-50 p-4 text-sm text-slate-500">
                啟用 MFA 後，系統會顯示一次 recovery codes。它們只會以 hash 存在資料庫裡。
              </div>
              {auth.user.mfaFactor ? (
                <form action={regenerateRecoveryCodesAction} className="grid gap-3">
                  <CsrfField />
                  <MfaReturnField nextPath={nextPath} />
                  <label className="grid gap-1.5 text-sm font-medium text-slate-700">
                    目前 TOTP 驗證碼
                    <input name="code" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" required className="h-10 rounded-md border border-border px-3 tracking-[0.2em]" placeholder="123456" />
                  </label>
                  <FormSubmitButton
                    pendingChildren="重新產生中…"
                    pendingMessage="正在驗證 TOTP 並重新產生 recovery codes，請勿重複送出。"
                    confirmMessage="重新產生後，舊 recovery codes 會立即失效。確定繼續？"
                    className="h-10 w-full rounded-md border border-orange-200 bg-white text-sm font-semibold text-orange-700 hover:bg-orange-50"
                  >
                    重新產生 recovery codes
                  </FormSubmitButton>
                </form>
              ) : null}
            </div>
          )}
        </Card>
      </div>

      <div className="mt-5 grid gap-5 lg:grid-cols-[1fr_1.2fr]">
        <Card>
          <div className="mb-4 flex items-start justify-between gap-4">
            <div>
              <h2 className="text-lg font-semibold text-slate-950">目前登入狀態</h2>
              <p className="mt-1 text-sm text-slate-500">可撤銷其他裝置，或一次結束所有登入狀態並重新登入。</p>
            </div>
            <Badge tone="blue">{sessions.filter((session) => !session.revokedAt).length} active</Badge>
          </div>
          <div className="grid gap-3">
            {sessions.map((session) => (
              <div key={session.id} className="rounded-md border border-border bg-slate-50 p-3">
                <div className="flex items-center justify-between gap-3">
                  <p className="text-sm font-semibold text-slate-800">{session.id === auth.session.id ? "目前裝置" : "其他裝置"}</p>
                  <Badge tone={session.revokedAt ? "gray" : "green"}>{session.revokedAt ? "revoked" : "active"}</Badge>
                </div>
                <p className="mt-1 truncate text-xs text-slate-500">{session.userAgent ?? "unknown user agent"}</p>
                <p className="mt-1 text-xs text-slate-600">建立：{session.createdAt.toLocaleString("zh-TW")} / 到期：{session.expiresAt.toLocaleString("zh-TW")}</p>
              </div>
            ))}
          </div>
          <div className="mt-4 flex flex-wrap gap-2">
            <form action={revokeOtherSessionsAction}>
              <CsrfField />
              <SubmitButton>撤銷其他裝置</SubmitButton>
            </form>
            <form action={revokeAllSessionsAction}>
              <CsrfField />
              <DangerButton>全部登出</DangerButton>
            </form>
          </div>
        </Card>

        {isOwner ? <Card>
          <div className="mb-4 flex items-start justify-between gap-4">
            <div>
              <h2 className="text-lg font-semibold text-slate-950">商家成員</h2>
              <p className="mt-1 text-sm text-slate-500">Owner 以 Email 寄出邀請，對方開啟邀請信並接受後才會加入；調高角色或重新啟用已停用成員也用邀請。調降角色可直接在名單中執行。</p>
            </div>
            <Badge tone="green">owner</Badge>
          </div>

          <div className="mb-4"><StepUpMfaNotice status={recentMfaStatus(auth)} nextPath="/settings/security" operation="邀請、重寄或停用商家成員" /></div>
          {isOwner ? (
            <form action={createVendorMemberAction} className="mb-5 grid gap-3 rounded-lg border border-blue-100 bg-blue-50/60 p-4 md:grid-cols-2">
              <CsrfField />
              <Field label="姓名" name="name" placeholder="Ex: 王小明" required />
              <Field label="Email" name="email" type="email" placeholder="member@example.com" required />
              <SelectField label="角色" name="role" defaultValue="accountant">
                <option value="owner">Owner</option>
                <option value="admin">Admin</option>
                <option value="accountant">Accountant</option>
                <option value="support">Support</option>
              </SelectField>
              <div className="md:col-span-2">
                <p className="mb-3 text-sm text-blue-800">系統會寄送 72 小時內有效的一次性邀請連結；對方接受前不會建立或變更任何成員資格。</p>
                <SubmitButton>寄送邀請</SubmitButton>
              </div>
            </form>
          ) : null}

          <PendingVendorInvitations invitations={pendingInvitations} action={revokeVendorMemberInvitationAction} csrfField={<CsrfField />} />

          <div className="overflow-hidden rounded-lg border border-border">
            <table className="w-full text-left text-sm">
              <thead className="bg-slate-50 text-xs uppercase text-slate-500">
                <tr>
                  <th className="px-4 py-3">成員</th>
                  <th className="px-4 py-3">角色</th>
                  <th className="px-4 py-3">狀態</th>
                  <th className="px-4 py-3 text-right">操作</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {members.map((member) => (
                  <tr key={member.id}>
                    <td className="px-4 py-3">
                      <p className="font-semibold text-slate-900">{member.user.name}</p>
                      <p className="text-xs text-slate-500">{member.user.email}</p>
                    </td>
                    <td className="px-4 py-3 capitalize text-slate-600">{member.role}</td>
                    <td className="px-4 py-3">
                      <Badge tone={member.status === "active" ? "green" : "gray"}>{statusLabel("teamMember", member.status)}</Badge>
                    </td>
                    <td className="px-4 py-3 text-right">
                      {member.status === "active" && member.userId !== auth.user.id ? (
                        <div className="flex flex-wrap justify-end gap-2">
                          <form action={resendVendorMemberInvitationAction}>
                            <CsrfField />
                            <input type="hidden" name="id" value={member.id} />
                            <FormSubmitButton
                              pendingChildren="重寄中…"
                              pendingMessage={`正在重新寄送 ${member.user.name} 的設定密碼邀請，請勿重複送出。`}
                              className="rounded-md border border-blue-200 px-3 py-1.5 text-xs font-semibold text-blue-700 hover:bg-blue-50"
                            >
                              重寄設定密碼邀請
                            </FormSubmitButton>
                          </form>
                          <VendorMemberRoleDowngradeForm action={changeVendorMemberRoleAction} csrfField={<CsrfField />} member={member} />
                          <VendorMemberDeactivationConfirmation
                            action={deactivateVendorMemberAction}
                            currentUserId={auth.user.id}
                            isOwner={isOwner}
                            member={member}
                          />
                        </div>
                      ) : (
                        <span className="text-xs text-slate-500">-</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {isPasswordResetSmokeEnabled() ? <div className="mt-5 rounded-lg border border-blue-100 bg-blue-50 p-4">
            <h3 className="text-sm font-semibold text-blue-900">密碼重設 smoke test</h3>
            <p className="mt-1 text-sm text-blue-800">
              忘記密碼時可從登入頁進入 `/password-reset/request`；此 smoke test 僅允許寄到環境設定的測試收件人。
            </p>
            <form action={sendPasswordResetSmokeAction} className="mt-3">
              <CsrfField />
              <FormSubmitButton
                pendingChildren="寄送中…"
                pendingMessage="正在寄送 password reset 測試信，請勿重複送出。"
                className="h-10 rounded-md bg-primary px-4 text-sm font-semibold text-white hover:bg-primary-dark"
              >
                寄送目前帳號的 reset 測試信
              </FormSubmitButton>
            </form>
          </div> : null}
        </Card> : null}
      </div>
    </>
  );
}
