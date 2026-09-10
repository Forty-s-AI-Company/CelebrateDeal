import { cookies } from "next/headers";
import Image from "next/image";
import Link from "next/link";
import QRCode from "qrcode";
import { CheckCircle2, ChevronRight, KeyRound, LockKeyhole, ShieldCheck, Smartphone } from "lucide-react";
import {
  regenerateRecoveryCodesAction,
  sendPasswordResetSmokeAction,
} from "@/app/actions";
import { CsrfField } from "@/components/csrf-field";
import { FormSubmitButton } from "@/components/form-submit-button";
import { MfaEnrollmentForm } from "@/components/mfa-enrollment-form";
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
  const parsedPendingMfa = parsePendingMfaSetup(cookieStore.get(MFA_SETUP_COOKIE)?.value);
  const pendingMfa = parsedPendingMfa?.userId === auth.user.id ? parsedPendingMfa : null;
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
    <main className="min-h-screen bg-slate-100 px-4 py-8 sm:px-6 lg:py-12">
      <section className="mx-auto w-full max-w-5xl">
        <header className="mb-7 flex items-center justify-between gap-4">
          <Link href="/dashboard" className="inline-flex items-center gap-2.5 rounded-xl px-2 py-1.5 transition-colors hover:bg-white/70">
            <span className="grid size-9 place-items-center rounded-xl bg-gradient-to-br from-blue-500 to-indigo-600 text-white shadow-lg shadow-blue-200"><ShieldCheck className="size-5" aria-hidden="true" /></span>
            <span><span className="block text-sm font-bold tracking-tight text-slate-950">CelebrateDeal</span><span className="block text-[11px] font-medium text-slate-500">Security Center</span></span>
          </Link>
          <span className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-600 shadow-sm"><LockKeyhole className="size-3.5 text-blue-600" aria-hidden="true" />安全設定</span>
        </header>

        <div className="mb-7 max-w-2xl">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-blue-600">Two-factor authentication</p>
          <h1 className="mt-2 text-3xl font-bold tracking-tight text-slate-950 sm:text-4xl">保護你的管理工作區</h1>
          <p className="mt-3 text-sm leading-6 text-slate-600">在進入敏感管理操作前，先完成 TOTP 雙重驗證。整個流程只需要驗證器 App 與幾分鐘。</p>
        </div>
        {params.updated ? <p role="status" aria-live="polite" className="mb-4 rounded-md bg-emerald-50 px-3 py-2 text-sm text-emerald-700">{updatedMessages[params.updated] ?? "已更新。"}</p> : null}
        {params.error ? <p role="alert" className="mb-4 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{errorMessages[params.error] ?? "設定失敗。"}</p> : null}

        <div className="grid gap-6 lg:grid-cols-[1.25fr_0.75fr]">
          <Card className="rounded-2xl border-slate-200 p-6 shadow-[0_10px_30px_rgba(15,23,42,0.06)] sm:p-7">
            <div className="mb-4 flex items-start justify-between gap-4">
              <div className="flex gap-3">
                <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-blue-50 text-blue-600"><Smartphone className="size-5" aria-hidden="true" /></span>
                <div>
                <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">步驟 1／2</p>
                <h2 className="mt-1 text-lg font-semibold text-slate-950">設定驗證器 App</h2>
                <p className="mt-1 text-sm text-slate-600">可使用 Google Authenticator、1Password、Authy 或其他支援 TOTP 的 App。</p>
                </div>
              </div>
              <Badge tone={auth.user.mfaFactor ? "green" : "orange"}>{auth.user.mfaFactor ? "enabled" : "setup required"}</Badge>
            </div>

            {auth.user.mfaFactor ? (
              <div className="rounded-xl border border-emerald-100 bg-emerald-50/70 p-4 text-sm text-emerald-900">
                <div className="flex gap-2"><CheckCircle2 className="mt-0.5 size-4 shrink-0" aria-hidden="true" /><span>MFA 已啟用，目前 session {auth.isMfaVerified ? "已完成二次驗證" : "尚未完成二次驗證"}。</span></div>
                <br />
                可用 recovery codes：{activeRecoveryCodeCount}。完成 recovery code 保存後，前往 <Link href="/mfa/verify" className="font-semibold underline">二次驗證頁</Link>。
              </div>
            ) : pendingMfa ? (
              <div className="grid gap-4">
                <div className="grid justify-items-center gap-3 rounded-xl border border-blue-100 bg-blue-50/70 p-5 text-center">
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
                <details className="rounded-xl border border-slate-200 bg-slate-50/70 p-4 text-left">
                  <summary className="cursor-pointer text-sm font-semibold text-slate-700">無法掃描 QR Code？顯示手動密鑰</summary>
                  <p className="mt-3 font-mono text-sm text-slate-700">{pendingMfa.secret}</p>
                </details>
                <form action="/api/settings/security/mfa/start" method="post" className="justify-self-start">
                  <CsrfField />
                  <FormSubmitButton
                  className="inline-flex min-h-10 items-center text-sm font-semibold text-blue-600 underline underline-offset-4"
                    pendingChildren="重新建立中…"
                    pendingMessage="正在建立新的 TOTP 設定。"
                  >
                    重新建立 TOTP 設定
                  </FormSubmitButton>
                </form>
                <MfaEnrollmentForm csrfField={<CsrfField />} />
              </div>
            ) : (
              <form action="/api/settings/security/mfa/start" method="post" className="grid gap-3">
                <CsrfField />
                <FormSubmitButton
                  className="h-11 rounded-xl bg-blue-600 text-sm font-semibold text-white shadow-sm shadow-blue-200 transition hover:bg-blue-700"
                  pendingChildren="建立中…"
                  pendingMessage="正在建立 TOTP 設定。"
                >
                  開始建立 TOTP
                </FormSubmitButton>
              </form>
            )}
          </Card>

          <Card className="rounded-2xl border-slate-200 p-6 shadow-[0_10px_30px_rgba(15,23,42,0.06)]">
            <div className="flex gap-3"><span className="grid size-10 shrink-0 place-items-center rounded-xl bg-violet-50 text-violet-600"><KeyRound className="size-5" aria-hidden="true" /></span><div><p className="text-xs font-semibold uppercase tracking-wider text-slate-500">備援存取</p><h2 className="mt-1 text-lg font-semibold text-slate-950">Recovery Codes</h2></div></div>
            {recoveryCodes?.length ? (
              <>
                <div className="mt-5 grid gap-2 rounded-xl border border-blue-100 bg-blue-50/70 p-4">
                  {recoveryCodes.map((code: string) => (
                    <div key={code} className="font-mono text-sm font-semibold text-slate-800">{code}</div>
                  ))}
                </div>
                <form action="/api/settings/security/mfa/recovery-codes/dismiss" method="post" className="mt-4">
                  <CsrfField />
                  <FormSubmitButton
                    className="h-10 w-full rounded-xl bg-blue-600 text-sm font-semibold text-white hover:bg-blue-700"
                    pendingChildren="確認中…"
                    pendingMessage="正在確認保存狀態。"
                  >
                    我已保存 recovery codes
                  </FormSubmitButton>
                </form>
              </>
            ) : (
              <div className="grid gap-3">
                <div className="mt-5 rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm leading-6 text-slate-600">
                  啟用後會顯示一次 recovery codes。資料庫只保存 hash，不保存明碼。
                </div>
                {auth.user.mfaFactor ? (
                  <form action={regenerateRecoveryCodesAction} className="grid gap-3">
                    <CsrfField />
                    <label className="grid gap-1.5 text-sm font-medium text-slate-700">
                      目前 TOTP 驗證碼
                      <input name="code" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" required className="h-11 rounded-md border border-border px-3 tracking-[0.2em]" placeholder="123456" />
                    </label>
                    <FormSubmitButton
                      className="h-11 w-full rounded-xl border border-orange-200 bg-white text-sm font-semibold text-orange-800 hover:bg-orange-50"
                      pendingChildren="重新產生中…"
                      pendingMessage="正在重新產生 recovery codes。"
                      confirmMessage="重新產生後，舊 recovery codes 會立即失效。確定繼續？"
                    >
                      重新產生 recovery codes
                    </FormSubmitButton>
                  </form>
                ) : null}
              </div>
            )}
          </Card>
        </div>

        <Card className="mt-6 rounded-2xl border-slate-200 bg-white/80 p-6 shadow-sm">
          <div className="flex items-center gap-2"><ChevronRight className="size-4 text-slate-400" aria-hidden="true" /><h2 className="text-base font-semibold text-slate-950">Password reset email smoke</h2></div>
          <p className="mt-1 text-sm text-slate-600">
            僅寄送到環境設定的測試收件人，驗證 Resend、reset link、token TTL 與 session revoke 流程。
          </p>
          <form action={sendPasswordResetSmokeAction} className="mt-4">
            <CsrfField />
            <FormSubmitButton
              className="h-11 rounded-xl bg-slate-900 px-4 text-sm font-semibold text-white hover:bg-slate-800"
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
