import { cookies } from "next/headers";
import {
  confirmMfaEnrollmentAction,
  dismissRecoveryCodesAction,
  regenerateRecoveryCodesAction,
  sendPasswordResetSmokeAction,
  startMfaEnrollmentAction,
} from "@/app/actions";
import { CsrfField } from "@/components/csrf-field";
import { Badge, Card } from "@/components/ui";
import { requireAuth } from "@/lib/auth";
import { generateTotpUri, MFA_RECOVERY_COOKIE, MFA_SETUP_COOKIE, parsePendingMfaSetup, parseRecoveryCodes } from "@/lib/mfa";

const errorMessages: Record<string, string> = {
  mfa_code: "TOTP 驗證碼不正確。",
  mfa_required: "請先啟用 MFA。",
  password_reset_smoke: "密碼重設測試信寄送失敗，請檢查 Resend 設定。",
};

const updatedMessages: Record<string, string> = {
  mfa_started: "請用驗證器 App 建立 TOTP，然後輸入 6 位數驗證碼完成啟用。",
  mfa_enabled: "MFA 已啟用，請先保存 recovery codes。",
  mfa_exists: "這個帳號已經啟用 MFA。",
  recovery_regenerated: "已重新產生 recovery codes，舊的 codes 已失效。",
  password_reset_smoke: "已寄出 password reset 測試信到目前帳號 Email。",
};

export default async function MfaSetupPage({
  searchParams,
}: {
  searchParams: Promise<{ updated?: string; error?: string }>;
}) {
  const params = await searchParams;
  const auth = await requireAuth();
  const cookieStore = await cookies();
  const pendingMfa = parsePendingMfaSetup(cookieStore.get(MFA_SETUP_COOKIE)?.value);
  const recoveryCodes = parseRecoveryCodes(cookieStore.get(MFA_RECOVERY_COOKIE)?.value);
  const mfaUri = pendingMfa ? generateTotpUri({ email: auth.user.email, secret: pendingMfa.secret }) : null;
  const activeRecoveryCodeCount = auth.user.recoveryCodes.filter((code) => !code.usedAt).length;

  return (
    <main className="grid min-h-screen place-items-center bg-background px-4 py-10">
      <section className="w-full max-w-2xl">
        <div className="mb-6">
          <p className="text-sm font-semibold text-primary">CelebrateDeal</p>
          <h1 className="mt-2 text-3xl font-semibold text-slate-950">設定管理員 MFA</h1>
          <p className="mt-2 text-sm text-slate-500">進入 `/admin/*` 之前，先完成一次 TOTP 設定與驗證。</p>
        </div>
        {params.updated ? <p className="mb-4 rounded-md bg-emerald-50 px-3 py-2 text-sm text-emerald-700">{updatedMessages[params.updated] ?? "已更新。"}</p> : null}
        {params.error ? <p className="mb-4 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{errorMessages[params.error] ?? "設定失敗。"}</p> : null}

        <div className="grid gap-5 lg:grid-cols-[1.2fr_0.8fr]">
          <Card>
            <div className="mb-4 flex items-start justify-between gap-4">
              <div>
                <h2 className="text-lg font-semibold text-slate-950">TOTP 設定</h2>
                <p className="mt-1 text-sm text-slate-500">可使用 Google Authenticator、1Password、Authy 或其他支援 TOTP 的 App。</p>
              </div>
              <Badge tone={auth.user.mfaFactor ? "green" : "orange"}>{auth.user.mfaFactor ? "enabled" : "setup required"}</Badge>
            </div>

            {auth.user.mfaFactor ? (
              <div className="rounded-lg border border-emerald-100 bg-emerald-50/70 p-4 text-sm text-emerald-900">
                MFA 已啟用，目前 session {auth.isMfaVerified ? "已完成二次驗證" : "尚未完成二次驗證"}。
                <br />
                可用 recovery codes：{activeRecoveryCodeCount}。完成 recovery code 保存後，前往 <a href="/mfa/verify" className="font-semibold underline">二次驗證頁</a>。
              </div>
            ) : pendingMfa ? (
              <div className="grid gap-4">
                <div className="rounded-lg border border-blue-100 bg-blue-50/70 p-4">
                  <p className="text-sm font-semibold text-slate-900">手動密鑰</p>
                  <p className="mt-2 font-mono text-sm text-slate-700">{pendingMfa.secret}</p>
                  {mfaUri ? <p className="mt-3 break-all text-xs text-slate-500">{mfaUri}</p> : null}
                </div>
                <form action={confirmMfaEnrollmentAction} className="grid gap-3">
                  <CsrfField />
                  <label className="grid gap-1.5 text-sm font-medium text-slate-700">
                    6 位數驗證碼
                    <input name="code" required className="h-10 rounded-md border border-border px-3 tracking-[0.2em]" placeholder="123456" />
                  </label>
                  <button className="h-10 rounded-md bg-primary text-sm font-semibold text-white hover:bg-primary-dark">啟用 MFA</button>
                </form>
              </div>
            ) : (
              <form action={startMfaEnrollmentAction} className="grid gap-3">
                <CsrfField />
                <button className="h-10 rounded-md bg-primary text-sm font-semibold text-white hover:bg-primary-dark">開始建立 TOTP</button>
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
                  <button className="h-10 w-full rounded-md bg-primary text-sm font-semibold text-white hover:bg-primary-dark">我已保存 recovery codes</button>
                </form>
              </>
            ) : (
              <div className="grid gap-3">
                <div className="rounded-lg border border-border bg-slate-50 p-4 text-sm text-slate-500">
                  啟用後會顯示一次 recovery codes。資料庫只保存 hash，不保存明碼。
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

        <Card className="mt-5">
          <h2 className="text-lg font-semibold text-slate-950">Password reset email smoke</h2>
          <p className="mt-1 text-sm text-slate-500">
            寄送一封密碼重設測試信到目前登入帳號，驗證 Resend、reset link、token TTL 與 session revoke 流程。
          </p>
          <form action={sendPasswordResetSmokeAction} className="mt-4">
            <CsrfField />
            <button className="h-10 rounded-md bg-primary px-4 text-sm font-semibold text-white hover:bg-primary-dark">
              寄送 password reset 測試信
            </button>
          </form>
        </Card>
      </section>
    </main>
  );
}
