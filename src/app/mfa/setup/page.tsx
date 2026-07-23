import { cookies } from "next/headers";
import Image from "next/image";
import QRCode from "qrcode";
import {
  confirmMfaEnrollmentAction,
  dismissRecoveryCodesAction,
  regenerateRecoveryCodesAction,
  sendPasswordResetSmokeAction,
  startMfaEnrollmentAction,
} from "@/app/actions";
import { CsrfField } from "@/components/csrf-field";
import { FormSubmitButton } from "@/components/form-submit-button";
import { Badge, Card } from "@/components/ui";
import { requireAuth } from "@/lib/auth";
import { generateTotpUri, MFA_RECOVERY_COOKIE, MFA_SETUP_COOKIE, parsePendingMfaSetup, parseRecoveryCodes } from "@/lib/mfa";

const errorMessages: Record<string, string> = {
  mfa_code: "TOTP 驗證碼不正確。",
  mfa_required: "請先啟用 MFA。",
  recovery_rate_limited: "Recovery codes 重建嘗試次數過多，請 15 分鐘後再試。",
  recovery_unavailable: "Recovery codes 驗證保護暫時無法使用，請稍後再試。",
  password_reset_smoke: "密碼重設測試信寄送失敗，請檢查 Resend 設定。",
  password_reset_smoke_recipient: "目前帳號不是允許的測試收件人，未寄出測試信。",
  password_reset_smoke_rate_limited: "測試信寄送次數過多，請 15 分鐘後再試。",
  password_reset_smoke_unavailable: "測試信寄送保護暫時無法使用，請稍後再試。",
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
  const mfaQrCode = mfaUri
    ? await QRCode.toDataURL(mfaUri, {
      errorCorrectionLevel: "M",
      margin: 1,
      width: 224,
      color: { dark: "#0f172a", light: "#ffffff" },
    })
    : null;
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
                <div className="grid justify-items-center gap-3 rounded-lg border border-blue-100 bg-blue-50/70 p-4 text-center">
                  <p className="text-sm font-semibold text-slate-900">使用驗證器 App 掃描 QR Code</p>
                  {mfaQrCode ? (
                    <Image
                      src={mfaQrCode}
                      alt="CelebrateDeal TOTP 設定 QR Code"
                      width={224}
                      height={224}
                      unoptimized
                      className="rounded-md bg-white p-2"
                    />
                  ) : null}
                  <p className="text-xs text-slate-600">掃描後，請輸入 App 顯示的 6 位數驗證碼完成啟用。</p>
                </div>
                <details className="rounded-lg border border-border bg-white p-4 text-left">
                  <summary className="cursor-pointer text-sm font-semibold text-slate-700">無法掃描 QR Code？顯示手動密鑰</summary>
                  <p className="mt-3 font-mono text-sm text-slate-700">{pendingMfa.secret}</p>
                </details>
                <form action={startMfaEnrollmentAction} className="justify-self-start">
                  <CsrfField />
                  <FormSubmitButton
                    className="text-sm font-semibold text-primary underline underline-offset-4"
                    pendingChildren="重新建立中…"
                    pendingMessage="正在建立新的 TOTP 設定。"
                  >
                    重新建立 TOTP 設定
                  </FormSubmitButton>
                </form>
                <form action={confirmMfaEnrollmentAction} className="grid gap-3">
                  <CsrfField />
                  <label className="grid gap-1.5 text-sm font-medium text-slate-700">
                    6 位數驗證碼
                    <input name="code" required className="h-10 rounded-md border border-border px-3 tracking-[0.2em]" placeholder="123456" />
                  </label>
                  <FormSubmitButton
                    className="h-10 rounded-md bg-primary text-sm font-semibold text-white hover:bg-primary-dark"
                    pendingChildren="啟用中…"
                    pendingMessage="正在啟用 MFA，請勿重複送出。"
                  >
                    啟用 MFA
                  </FormSubmitButton>
                </form>
              </div>
            ) : (
              <form action={startMfaEnrollmentAction} className="grid gap-3">
                <CsrfField />
                <FormSubmitButton
                  className="h-10 rounded-md bg-primary text-sm font-semibold text-white hover:bg-primary-dark"
                  pendingChildren="建立中…"
                  pendingMessage="正在建立 TOTP 設定。"
                >
                  開始建立 TOTP
                </FormSubmitButton>
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
                  <FormSubmitButton
                    className="h-10 w-full rounded-md bg-primary text-sm font-semibold text-white hover:bg-primary-dark"
                    pendingChildren="確認中…"
                    pendingMessage="正在確認保存狀態。"
                  >
                    我已保存 recovery codes
                  </FormSubmitButton>
                </form>
              </>
            ) : (
              <div className="grid gap-3">
                <div className="rounded-lg border border-border bg-slate-50 p-4 text-sm text-slate-500">
                  啟用後會顯示一次 recovery codes。資料庫只保存 hash，不保存明碼。
                </div>
                {auth.user.mfaFactor ? (
                  <form action={regenerateRecoveryCodesAction} className="grid gap-3">
                    <CsrfField />
                    <label className="grid gap-1.5 text-sm font-medium text-slate-700">
                      目前 TOTP 驗證碼
                      <input name="code" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" required className="h-10 rounded-md border border-border px-3 tracking-[0.2em]" placeholder="123456" />
                    </label>
                    <FormSubmitButton
                      className="h-10 w-full rounded-md border border-orange-200 bg-white text-sm font-semibold text-orange-700 hover:bg-orange-50"
                      pendingChildren="重新產生中…"
                      pendingMessage="正在重新產生 recovery codes。"
                    >
                      重新產生 recovery codes
                    </FormSubmitButton>
                  </form>
                ) : null}
              </div>
            )}
          </Card>
        </div>

        <Card className="mt-5">
          <h2 className="text-lg font-semibold text-slate-950">Password reset email smoke</h2>
          <p className="mt-1 text-sm text-slate-500">
            僅寄送到環境設定的測試收件人，驗證 Resend、reset link、token TTL 與 session revoke 流程。
          </p>
          <form action={sendPasswordResetSmokeAction} className="mt-4">
            <CsrfField />
            <FormSubmitButton
              className="h-10 rounded-md bg-primary px-4 text-sm font-semibold text-white hover:bg-primary-dark"
              pendingChildren="寄送中…"
              pendingMessage="正在寄送測試信，請稍候。"
            >
              寄送 password reset 測試信
            </FormSubmitButton>
          </form>
        </Card>
      </section>
    </main>
  );
}
