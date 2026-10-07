import { saveTrackingCredentialAction } from "@/app/actions/tracking-credential-actions";
import { saveTrackingSettingsAction } from "@/app/actions";
import { CsrfField } from "@/components/csrf-field";
import { Card, Field, PageHeader, SubmitButton } from "@/components/ui";
import { requireVendorManager } from "@/lib/auth";

export default async function TrackingSettingsPage({ searchParams }: { searchParams?: Promise<{ tracking?: string }> }) {
  const vendor = await requireVendorManager();
  const tracking = vendor.tracking;
  const status = (await searchParams)?.tracking;

  return (
    <>
      <PageHeader title="追蹤設定" description="設定 Pixel、GTM 與事件開關；公開頁會先記錄平台內部 analytics_events。" />
      {status === "saved" ? <p role="status">伺服器追蹤設定已儲存。</p> : status === "conflict" ? <p role="alert">設定已被其他人修改，請重新載入後再儲存。</p> : status === "invalid" ? <p role="alert">設定未儲存，請檢查輸入後重試。</p> : null}
      <Card>
        <form action={saveTrackingCredentialAction} className="mb-6 grid gap-4 border-b border-slate-200 pb-6">
          <CsrfField />
          <input type="hidden" name="credentialRevision" value={tracking?.credentialRevision ?? 0} />
          <h2 className="font-bold">Meta 伺服器追蹤</h2>
          <p className="text-sm text-slate-600">{tracking?.facebookAccessTokenEncrypted ? "已設定加密憑證。留白會保留既有憑證。" : "尚未設定憑證。"}</p>
          <Field label="Meta CAPI Access Token" name="facebookAccessToken" type="password" autoComplete="new-password" maxLength={4096} />
          <Field label="Meta Test Event Code" name="facebookTestEventCode" defaultValue={tracking?.facebookTestEventCode ?? ""} maxLength={128} autoComplete="off" />
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="clearTrackingToken" />撤除既有追蹤憑證</label>
          <SubmitButton>儲存伺服器追蹤設定</SubmitButton>
        </form>
        <form action={saveTrackingSettingsAction} className="grid gap-4">
          <CsrfField />
          <div className="grid gap-4 md:grid-cols-3">
            <Field label="Facebook Pixel ID" name="facebookPixelId" defaultValue={tracking?.facebookPixelId} />
            <Field label="TikTok Pixel ID" name="tiktokPixelId" defaultValue={tracking?.tiktokPixelId} />
            <Field label="Google Tag Manager ID" name="googleTagManagerId" defaultValue={tracking?.googleTagManagerId} />
          </div>
          <div className="grid gap-3 rounded-lg bg-slate-50 p-4">
            {[
              ["enablePageView", "記錄頁面瀏覽", tracking?.enablePageView ?? true],
              ["enableLeadEvent", "記錄名單送出", tracking?.enableLeadEvent ?? true],
              ["enablePurchaseEvent", "記錄商品 CTA", tracking?.enablePurchaseEvent ?? true],
            ].map(([name, label, checked]) => (
              <label key={String(name)} className="flex items-center justify-between gap-3 text-sm font-medium text-slate-700">
                {label}
                <input name={String(name)} type="checkbox" defaultChecked={Boolean(checked)} className="h-5 w-5 accent-blue-600" />
              </label>
            ))}
          </div>
          <SubmitButton />
        </form>
      </Card>
    </>
  );
}
