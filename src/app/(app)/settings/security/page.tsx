import { cookies } from "next/headers";
import {
  confirmMfaEnrollmentAction,
  createVendorMemberAction,
  deactivateVendorMemberAction,
  dismissRecoveryCodesAction,
  logoutAction,
  regenerateRecoveryCodesAction,
  revokeAllSessionsAction,
  revokeOtherSessionsAction,
  sendPasswordResetSmokeAction,
  startMfaEnrollmentAction,
  updatePasswordAction,
} from "@/app/actions";
import { CsrfField } from "@/components/csrf-field";
import { Badge, Card, DangerButton, Field, PageHeader, SelectField, SubmitButton } from "@/components/ui";
import { getDb } from "@/lib/db";
import { generateTotpUri, MFA_RECOVERY_COOKIE, MFA_SETUP_COOKIE, parsePendingMfaSetup, parseRecoveryCodes } from "@/lib/mfa";
import { requireAuth } from "@/lib/auth";

const errorMessages: Record<string, string> = {
  short: "密碼至少需要 12 個字元。",
  owner_required: "只有商家 owner 可以管理成員。",
  member_invalid: "請確認成員姓名、Email 與角色都已填寫。",
  member_invitation: "成員已更新，但邀請信寄送失敗，請稍後重新邀請。",
  platform_user: "平台管理員帳號不能加入商家成員清單。",
  self_role: "不能把自己的 owner 權限降級。",
  self_deactivate: "不能停用自己的帳號。",
  last_owner: "至少要保留一位 active owner。",
  member_not_found: "找不到可停用的成員。",
  mfa_required: "管理後台前需要先完成 MFA 設定。",
  mfa_code: "TOTP 驗證碼不正確。",
  password_reset_smoke: "密碼重設測試信寄送失敗，請檢查 Resend 設定。",
};

const updatedMessages: Record<string, string> = {
  "1": "密碼已更新。",
  member: "商家成員已更新，並已寄出設定密碼邀請信。",
  member_deactivated: "商家成員已停用，相關 session 已撤銷。",
  sessions_revoked: "其他裝置 session 已撤銷。",
  mfa_started: "請用驗證器 App 掃描或手動輸入密鑰，然後輸入 6 位數驗證碼完成啟用。",
  mfa_enabled: "MFA 已啟用，請妥善保存 recovery codes。",
  mfa_exists: "這個帳號已經啟用 MFA。",
  recovery_regenerated: "已重新產生 recovery codes，舊的 codes 已失效。",
  password_reset_smoke: "已寄出 password reset 測試信到目前帳號 Email。",
};

export default async function SecuritySettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ updated?: string; error?: string }>;
}) {
  const params = await searchParams;
  const auth = await requireAuth();
  const db = getDb();
  const vendorId = auth.vendor?.id;
  const isOwner = auth.member?.role === "owner";
  const cookieStore = await cookies();
  const pendingMfa = parsePendingMfaSetup(cookieStore.get(MFA_SETUP_COOKIE)?.value);
  const recoveryCodes = parseRecoveryCodes(cookieStore.get(MFA_RECOVERY_COOKIE)?.value);
  const mfaUri = pendingMfa ? generateTotpUri({ email: auth.user.email, secret: pendingMfa.secret }) : null;
  const activeRecoveryCodeCount = auth.user.recoveryCodes.filter((code) => !code.usedAt).length;
  const [members, sessions] = await Promise.all([
    vendorId
      ? db.vendorMember.findMany({
          where: { vendorId },
          include: { user: true },
          orderBy: [{ status: "asc" }, { createdAt: "asc" }],
        })
      : [],
    db.userSession.findMany({
      where: {
        userId: auth.user.id,
        expiresAt: { gt: new Date() },
      },
      orderBy: { createdAt: "desc" },
      take: 8,
    }),
  ]);

  return (
    <>
      <PageHeader title="安全設定" description="管理登入密碼、session、商家成員與最小權限控管。" />
      {params.updated ? <p className="mb-4 rounded-md bg-emerald-50 px-3 py-2 text-sm text-emerald-700">{updatedMessages[params.updated] ?? "已更新。"}</p> : null}
      {params.error ? <p className="mb-4 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{errorMessages[params.error] ?? "操作失敗，請確認權限與輸入內容。"}</p> : null}
      <div className="grid gap-5 lg:grid-cols-2">
        <Card>
          <h2 className="mb-4 text-lg font-semibold text-slate-950">更新密碼</h2>
          <form action={updatePasswordAction} className="grid gap-4">
            <CsrfField />
            <Field label="新密碼" name="password" type="password" required />
            <SubmitButton>更新密碼</SubmitButton>
          </form>
        </Card>
        <Card>
          <h2 className="mb-2 text-lg font-semibold text-slate-950">登出此裝置</h2>
          <p className="mb-4 text-sm text-slate-500">目前使用資料庫 session 搭配 httpOnly cookie；登出會撤銷目前 session 並清除瀏覽器 cookie。</p>
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
              <p className="mt-1 text-sm text-slate-500">平台財務後台會要求管理員先完成 TOTP 驗證；recovery code 只顯示一次。</p>
            </div>
            <Badge tone={auth.user.mfaFactor ? "green" : "orange"}>{auth.user.mfaFactor ? "enabled" : "required for admin"}</Badge>
          </div>

          {auth.user.mfaFactor ? (
            <div className="rounded-lg border border-emerald-100 bg-emerald-50/70 p-4">
              <p className="text-sm font-semibold text-emerald-900">MFA 已啟用</p>
              <p className="mt-1 text-sm text-emerald-800">
                上次使用：{auth.user.mfaFactor.lastUsedAt ? auth.user.mfaFactor.lastUsedAt.toLocaleString("zh-TW") : "尚未記錄"}
              </p>
              <p className="mt-1 text-sm text-emerald-800">目前 session：{auth.isMfaVerified ? "已完成 MFA 驗證" : "尚未完成 MFA 驗證"}</p>
              <p className="mt-1 text-sm text-emerald-800">可用 recovery codes：{activeRecoveryCodeCount}</p>
            </div>
          ) : pendingMfa ? (
            <div className="grid gap-4">
              <div className="rounded-lg border border-blue-100 bg-blue-50/70 p-4">
                <p className="text-sm font-semibold text-slate-900">手動輸入密鑰</p>
                <p className="mt-2 font-mono text-sm text-slate-700">{pendingMfa.secret}</p>
                <p className="mt-3 text-xs text-slate-500">若你的驗證器 App 支援手動輸入，Issuer 請填 `CelebrateDeal`。</p>
                {mfaUri ? <p className="mt-3 break-all text-xs text-slate-500">{mfaUri}</p> : null}
              </div>
              <form action={confirmMfaEnrollmentAction} className="grid gap-3">
                <CsrfField />
                <Field label="6 位數驗證碼" name="code" placeholder="123456" required />
                <SubmitButton>啟用 MFA</SubmitButton>
              </form>
            </div>
          ) : (
            <form action={startMfaEnrollmentAction} className="grid gap-3">
              <CsrfField />
              <p className="rounded-lg border border-orange-100 bg-orange-50 p-4 text-sm text-orange-800">
                尚未啟用 MFA。若這個帳號需要進入 `/admin/*`，啟用後才能繼續操作財務與 webhook 後台。
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
              <form action={dismissRecoveryCodesAction} className="mt-4">
                <CsrfField />
                <SubmitButton>我已保存 recovery codes</SubmitButton>
              </form>
            </>
          ) : (
            <div className="grid gap-3">
              <div className="rounded-lg border border-border bg-slate-50 p-4 text-sm text-slate-500">
                啟用 MFA 後，系統會顯示一次 recovery codes。它們只會以 hash 存在資料庫裡。
              </div>
              {auth.user.mfaFactor ? (
                <form action={regenerateRecoveryCodesAction}>
                  <CsrfField />
                  <button className="h-10 w-full rounded-md border border-orange-200 bg-white text-sm font-semibold text-orange-700 hover:bg-orange-50">
                    重新產生 recovery codes
                  </button>
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
              <h2 className="text-lg font-semibold text-slate-950">目前 session</h2>
              <p className="mt-1 text-sm text-slate-500">可撤銷其他裝置，或一次撤銷所有 session 重新登入。</p>
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
                <p className="mt-1 text-xs text-slate-400">建立：{session.createdAt.toLocaleString("zh-TW")} / 到期：{session.expiresAt.toLocaleString("zh-TW")}</p>
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

        <Card>
          <div className="mb-4 flex items-start justify-between gap-4">
            <div>
              <h2 className="text-lg font-semibold text-slate-950">商家成員</h2>
              <p className="mt-1 text-sm text-slate-500">Owner 可用 Email 邀請或重新啟用成員；平台管理員帳號不會出現在商家端管理名單。</p>
            </div>
            <Badge tone={isOwner ? "green" : "gray"}>{isOwner ? "owner" : auth.member?.role ?? "member"}</Badge>
          </div>

          {isOwner ? (
            <form action={createVendorMemberAction} className="mb-5 grid gap-3 rounded-lg border border-blue-100 bg-blue-50/60 p-4 md:grid-cols-2">
              <CsrfField />
              <Field label="姓名" name="name" placeholder="Ex: 王小明" required />
              <Field label="Email" name="email" type="email" placeholder="member@example.com" required />
              <SelectField label="角色" name="role" defaultValue="accountant">
                <option value="owner">Owner</option>
                <option value="admin">Admin</option>
                <option value="accountant">Accountant</option>
              </SelectField>
              <div className="md:col-span-2">
                <p className="mb-3 text-sm text-blue-800">系統會寄送一次性的設定密碼連結，不會顯示或傳送初始密碼。</p>
                <SubmitButton>寄送邀請 / 重新啟用成員</SubmitButton>
              </div>
            </form>
          ) : (
            <div className="mb-5 rounded-md border border-border bg-slate-50 p-4 text-sm text-slate-600">你的角色可以查看安全資訊，但只有 owner 可以新增或停用成員。</div>
          )}

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
                      <Badge tone={member.status === "active" ? "green" : "gray"}>{member.status}</Badge>
                    </td>
                    <td className="px-4 py-3 text-right">
                      {isOwner && member.status === "active" && member.userId !== auth.user.id ? (
                        <form action={deactivateVendorMemberAction}>
                          <CsrfField />
                          <input type="hidden" name="id" value={member.id} />
                          <button className="rounded-md border border-red-200 px-3 py-1.5 text-xs font-semibold text-red-600 hover:bg-red-50">停用</button>
                        </form>
                      ) : (
                        <span className="text-xs text-slate-400">-</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="mt-5 rounded-lg border border-blue-100 bg-blue-50 p-4">
            <h3 className="text-sm font-semibold text-blue-900">密碼重設 smoke test</h3>
            <p className="mt-1 text-sm text-blue-800">
              忘記密碼時可從登入頁進入 `/password-reset/request`，系統會寄出 Resend 交易信，token 30 分鐘後過期，使用後會撤銷所有 session。
            </p>
            <form action={sendPasswordResetSmokeAction} className="mt-3">
              <CsrfField />
              <button className="h-10 rounded-md bg-primary px-4 text-sm font-semibold text-white hover:bg-primary-dark">
                寄送目前帳號的 reset 測試信
              </button>
            </form>
          </div>
        </Card>
      </div>
    </>
  );
}
