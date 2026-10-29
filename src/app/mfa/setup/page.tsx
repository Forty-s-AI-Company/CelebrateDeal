import { MfaReturnField } from "@/components/mfa-return-field";
import { safeMfaReturnPath, withMfaReturnPath } from "@/lib/mfa-return-path";
import { cookies } from "next/headers";
import Image from "next/image";
import Link from "next/link";
import QRCode from "qrcode";
import { CheckCircle2, ChevronRight, KeyRound, LockKeyhole, ShieldCheck, Smartphone } from "lucide-react";
import {
  sendPasswordResetSmokeAction,
} from "@/app/actions";
import { CsrfField } from "@/components/csrf-field";
import { FormSubmitButton } from "@/components/form-submit-button";
import { RecoveryCodesActions } from "@/components/recovery-codes-actions";
import { MfaEnrollmentForm } from "@/components/mfa-enrollment-form";
import { Badge, Card } from "@/components/ui";
import { requireAuth } from "@/lib/auth";
import { generateTotpUri, MFA_RECOVERY_COOKIE, MFA_SETUP_COOKIE, parsePendingMfaSetup, parseRecoveryCodes } from "@/lib/mfa";
import { isPasswordResetSmokeEnabled } from "@/lib/password-reset-smoke-policy";

const errorMessages: Record<string, string> = {
  mfa_code: "驗證碼不正確。請看手機 App 上目前的 6 位數數字，它每 30 秒會換一組，輸入前請確認沒有過期。",
  session_stale: "這次登入已失效，兩步驟驗證沒有啟用。請重新登入後再設定。",
  mfa_required: "請先完成雙重驗證設定，再做這個操作。",
  recovery_rate_limited: "重新產生備用救援碼的嘗試次數太多，請 15 分鐘後再試。",
  recovery_unavailable: "目前暫時無法重新產生備用救援碼，請稍後再試。",
  password_reset_smoke: "密碼重設測試信寄送失敗，請檢查 Resend 設定。",
  password_reset_smoke_recipient: "目前帳號不是允許的測試收件人，未寄出測試信。",
  password_reset_smoke_rate_limited: "測試信寄送次數過多，請 15 分鐘後再試。",
  password_reset_smoke_unavailable: "測試信寄送保護暫時無法使用，請稍後再試。",
};

const updatedMessages: Record<string, string> = {
  mfa_started: "已產生 QR code，請接著做第二步和第三步。",
  mfa_enabled: "已開啟雙重驗證，請先保存備用救援碼。",
  mfa_exists: "你已經開啟雙重驗證了，不需要再設定一次。",
  recovery_regenerated: "已重新產生備用救援碼，舊的救援碼已經不能用了，請保存新的。",
  password_reset_smoke: "已寄出 password reset 測試信到目前帳號 Email。",
};

function isOrdersReturn(value: string | undefined) {
  return value === "/orders" || Boolean(value?.startsWith("/orders/"));
}

export default async function MfaSetupPage({
  searchParams,
}: {
  searchParams: Promise<{ updated?: string; error?: string; next?: string; reason?: string }>;
}) {
  const params = await searchParams;
  const nextPath = safeMfaReturnPath(params.next);
  const returningToOrders = isOrdersReturn(nextPath);
  const auth = await requireAuth({ nextPath });
  const showPasswordResetSmoke = isPasswordResetSmokeEnabled();
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
            <span><span className="block text-sm font-bold tracking-tight text-slate-950">CelebrateDeal</span><span className="block text-[11px] font-medium text-slate-600">帳號安全</span></span>
          </Link>
          <span className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-600 shadow-sm"><LockKeyhole className="size-3.5 text-blue-600" aria-hidden="true" />安全設定</span>
        </header>

        <div className="mb-7 max-w-2xl">
          <h1 className="text-3xl font-bold tracking-tight text-slate-950 sm:text-4xl">設定雙重驗證</h1>
          <p className="mt-3 text-base leading-7 text-slate-700">為了保護你的收款與客戶資料，做幾個重要操作時，我們會請你輸入手機上的 6 位數驗證碼。登入帳號時不需要。這件事只要做一次，大約 3 分鐘，照下面的步驟做就好。</p>
        </div>
        {params.reason === "step_up" && !returningToOrders ? (
          <Card className="mb-6 border-amber-200 bg-amber-50/70 p-4 shadow-none">
            <p className="font-semibold text-slate-950">你剛才的操作需要先設定雙重驗證</p>
            <p className="mt-1 text-sm leading-6 text-slate-700">綁定信用卡、選擇付費方案、管理成員、撥款銀行資料、儲存 LINE 或 Meta 的連線資料，以及匯出客戶個資，都需要先完成這個設定。設定好之後會自動回到剛才的頁面。</p>
          </Card>
        ) : null}
        {returningToOrders ? (
          <Card className="mb-6 border-blue-200 bg-blue-50/70 p-4 shadow-none">
            <p className="font-semibold text-slate-950">為什麼現在要設定？</p>
            <p className="mt-1 text-sm leading-6 text-slate-700">訂單裡有買家的個人資料，所以管理者要先開啟雙重驗證。照下面四步做，大約 2 到 3 分鐘，完成後會自動回到「訂單與履約」。</p>
          </Card>
        ) : null}
        {params.updated ? <p role="status" aria-live="polite" className="mb-4 rounded-md bg-emerald-50 px-3 py-2 text-sm text-emerald-700">{updatedMessages[params.updated] ?? "已更新。"}</p> : null}
        {params.error ? <p role="alert" className="mb-4 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{errorMessages[params.error] ?? "設定沒有成功，請再試一次。"}</p> : null}

        <div className="grid gap-6 lg:grid-cols-[1.25fr_0.75fr]">
          <Card className="rounded-2xl border-slate-200 p-5 shadow-[0_10px_30px_rgba(15,23,42,0.06)] sm:p-7">
            <div className="mb-5 flex items-center justify-between gap-4">
              <div className="flex items-center gap-3">
                <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-blue-50 text-blue-600"><Smartphone className="size-5" aria-hidden="true" /></span>
                <h2 className="text-lg font-semibold text-slate-950">{auth.user.mfaFactor ? "雙重驗證狀態" : "用手機設定，共 3 步"}</h2>
              </div>
              <Badge tone={auth.user.mfaFactor ? "green" : "orange"}>{auth.user.mfaFactor ? "已開啟" : "尚未開啟"}</Badge>
            </div>

            {auth.user.mfaFactor ? (
              <div className="rounded-xl border border-emerald-100 bg-emerald-50/70 p-4 text-sm leading-6 text-emerald-900">
                <div className="flex gap-2"><CheckCircle2 className="mt-0.5 size-4 shrink-0" aria-hidden="true" /><span>雙重驗證已開啟。{auth.isMfaVerified ? "這次登入你已經通過驗證。" : "這次登入你還沒輸入驗證碼。"}</span></div>
                <p className="mt-2">你還有 {activeRecoveryCodeCount} 組備用救援碼可用。{auth.isMfaVerified ? null : <>請前往 <Link href={withMfaReturnPath("/mfa/verify", nextPath)} className="font-semibold underline">輸入驗證碼</Link> 頁面完成驗證。</>}</p>
              </div>
            ) : (
              <ol className="grid gap-4">
                <li className="rounded-xl border border-slate-200 bg-white p-4">
                  <h3 className="text-base font-semibold text-slate-950">第一步：在手機安裝「驗證碼 App」</h3>
                  <p className="mt-2 text-sm leading-6 text-slate-700">建議安裝 Google Authenticator 或 Microsoft Authenticator。iPhone 到 App Store、Android 到 Google Play，搜尋 App 名稱就能安裝。已經裝好了就直接跳到第二步。</p>
                </li>
                <li className="rounded-xl border border-slate-200 bg-white p-4">
                  <h3 className="text-base font-semibold text-slate-950">第二步：用 App 掃描 QR code</h3>
                  <p className="mt-2 text-sm leading-6 text-slate-700">打開驗證碼 App，按「＋」或「新增」，選「掃描 QR code」，再把手機鏡頭對準下方的圖片。</p>
                  {pendingMfa ? (
                    <div className="mt-4 grid gap-3">
                      <div className="grid justify-items-center gap-3 rounded-xl border border-blue-100 bg-blue-50/70 p-4 text-center">
                        {mfaQrCode ? (
                          <Image
                            src={mfaQrCode}
                            alt="雙重驗證設定用的 QR code，請用驗證碼 App 掃描"
                            width={224}
                            height={224}
                            unoptimized
                            className="rounded-xl bg-white p-2 shadow-sm"
                          />
                        ) : null}
                        <p className="text-xs text-slate-600">掃描成功後，App 裡會多出一個 CelebrateDeal 項目。</p>
                      </div>
                      <details className="rounded-xl border border-slate-200 bg-slate-50/70 p-4 text-left">
                        <summary className="flex min-h-11 cursor-pointer items-center text-sm font-semibold text-slate-700">掃不了？改用手動輸入</summary>
                        <p className="mt-2 text-sm leading-6 text-slate-700">在 App 裡選「輸入設定金鑰」，帳號名稱隨你填，再把下面這串密鑰輸入進去。密鑰的大小寫不用特別區分。</p>
                        <p className="mt-3 break-all font-mono text-sm text-slate-700">{pendingMfa.secret}</p>
                      </details>
                      <form action="/api/settings/security/mfa/start" method="post" className="justify-self-start">
                        <CsrfField />
                        <MfaReturnField nextPath={nextPath} />
                        <FormSubmitButton
                          className="inline-flex min-h-11 items-center text-sm font-semibold text-blue-600 underline underline-offset-4"
                          pendingChildren="重新產生中…"
                          pendingMessage="正在重新產生 QR code。"
                        >
                          QR code 有問題？重新產生一個
                        </FormSubmitButton>
                      </form>
                    </div>
                  ) : (
                    <form action="/api/settings/security/mfa/start" method="post" className="mt-4 grid gap-3">
                      <CsrfField />
                      <MfaReturnField nextPath={nextPath} />
                      <FormSubmitButton
                        className="min-h-11 rounded-xl bg-blue-600 px-4 text-sm font-semibold text-white shadow-sm shadow-blue-200 transition hover:bg-blue-700"
                        pendingChildren="產生中…"
                        pendingMessage="正在產生 QR code。"
                      >
                        開始設定雙重驗證
                      </FormSubmitButton>
                      <p className="text-xs leading-5 text-slate-600">安裝好 App 後，按這個按鈕，這裡就會出現 QR code。</p>
                    </form>
                  )}
                </li>
                <li className="rounded-xl border border-slate-200 bg-white p-4">
                  <h3 className="text-base font-semibold text-slate-950">第三步：輸入 App 上的 6 位數數字</h3>
                  <p className="mt-2 text-sm leading-6 text-slate-700">App 會顯示一組 6 位數數字，每 30 秒換一次。把目前看到的數字輸入下面的欄位，再按「完成設定」。</p>
                  {pendingMfa ? (
                    <div className="mt-4"><MfaEnrollmentForm csrfField={<CsrfField />} nextPath={nextPath} /></div>
                  ) : (
                    <p className="mt-3 text-xs leading-5 text-slate-600">完成第二步後，這裡會出現輸入欄位。</p>
                  )}
                </li>
              </ol>
            )}
          </Card>

          <Card className="rounded-2xl border-slate-200 p-5 shadow-[0_10px_30px_rgba(15,23,42,0.06)] sm:p-6">
            <div className="flex items-center gap-3"><span className="grid size-10 shrink-0 place-items-center rounded-xl bg-violet-50 text-violet-600"><KeyRound className="size-5" aria-hidden="true" /></span><h2 className="text-lg font-semibold text-slate-950">{auth.user.mfaFactor ? "備用救援碼" : "第四步：保存備用救援碼"}</h2></div>
            {recoveryCodes?.length ? (
              <>
                <p className="mt-4 text-sm leading-6 text-slate-700">手機遺失或換新手機時，可以用這些救援碼救回帳號。每一組只能用一次。請現在就截圖、抄在紙上，或存進密碼管理員。離開這個頁面後就不會再顯示。建議先下載或複製，再按「我已保存」。</p>
                <div className="mt-4 grid gap-2 rounded-xl border border-blue-100 bg-blue-50/70 p-4">
                  {recoveryCodes.map((code: string) => (
                    <div key={code} className="font-mono text-sm font-semibold text-slate-800">{code}</div>
                  ))}
                </div>
                <RecoveryCodesActions codes={recoveryCodes} />
                <form action="/api/settings/security/mfa/recovery-codes/dismiss" method="post" className="mt-4">
                  <CsrfField />
                  <MfaReturnField nextPath={nextPath} />
                  <FormSubmitButton
                    className="min-h-11 w-full rounded-xl bg-blue-600 text-sm font-semibold text-white hover:bg-blue-700"
                    pendingChildren="確認中…"
                    pendingMessage="正在確認保存狀態。"
                  >
                    我已保存備用救援碼
                  </FormSubmitButton>
                </form>
              </>
            ) : (
              <div className="grid gap-3">
                <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm leading-6 text-slate-600">
                  {auth.user.mfaFactor
                    ? "備用救援碼只會在產生的當下顯示一次，之後我們也看不到內容。如果弄丟了，可以在下方重新產生一批，舊的會同時失效。"
                    : "完成前三步後，這裡會出現備用救援碼。手機遺失或換機時，用它就能救回帳號，只會顯示一次，請務必保存。"}
                </div>
                {auth.user.mfaFactor ? (
                  <form action="/api/settings/security/mfa/recovery-codes/regenerate" method="post" className="grid gap-3">
                    <CsrfField />
                    <MfaReturnField nextPath={nextPath} />
                    <label className="grid gap-1.5 text-sm font-medium text-slate-700">
                      目前 App 上的 6 位數驗證碼
                      <input name="code" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" required className="h-11 rounded-md border border-border px-3 tracking-[0.2em]" placeholder="123456" />
                    </label>
                    <FormSubmitButton
                      className="min-h-11 w-full rounded-xl border border-orange-200 bg-white text-sm font-semibold text-orange-800 hover:bg-orange-50"
                      pendingChildren="重新產生中…"
                      pendingMessage="正在重新產生備用救援碼。"
                      confirmMessage="重新產生後，舊的備用救援碼會立刻失效。確定要繼續嗎？"
                    >
                      重新產生備用救援碼
                    </FormSubmitButton>
                  </form>
                ) : null}
              </div>
            )}
          </Card>
        </div>

        {showPasswordResetSmoke ? <Card className="mt-6 rounded-2xl border-slate-200 bg-white/80 p-6 shadow-sm">
          <div className="flex items-center gap-2"><ChevronRight className="size-4 text-slate-500" aria-hidden="true" /><h2 className="text-base font-semibold text-slate-950">Password reset email smoke</h2></div>
          <p className="mt-1 text-sm text-slate-600">
            僅寄送到環境設定的測試收件人，驗證寄信、重設連結、連結有效期限與登入狀態結束流程。
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
        </Card> : null}
      </section>
    </main>
  );
}
