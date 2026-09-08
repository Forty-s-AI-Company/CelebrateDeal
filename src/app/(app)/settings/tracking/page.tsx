import { saveTrackingSettingsAction } from "@/app/actions";
import { CsrfField } from "@/components/csrf-field";
import { Card, Field, PageHeader, SubmitButton } from "@/components/ui";
import { requireVendorManager } from "@/lib/auth";

export default async function TrackingSettingsPage() {
  const vendor = await requireVendorManager();
  const tracking = vendor.tracking;

  return (
    <>
      <PageHeader title="追蹤設定" description="設定 Pixel、GTM 與事件開關；公開頁會先記錄平台內部 analytics_events。" />
      <Card>
        <form action={saveTrackingSettingsAction} className="grid gap-4">
          <CsrfField />
          <div className="grid gap-4 md:grid-cols-3">
            <Field label="Facebook Pixel ID" name="facebookPixelId" defaultValue={tracking?.facebookPixelId} />
            <Field label="TikTok Pixel ID" name="tiktokPixelId" defaultValue={tracking?.tiktokPixelId} />
            <Field label="Google Tag Manager ID" name="googleTagManagerId" defaultValue={tracking?.googleTagManagerId} />
          </div>
          <section className="grid gap-3 rounded-lg border border-slate-200 bg-slate-50 p-4" aria-labelledby="meta-capi-heading">
            <div>
              <h2 id="meta-capi-heading" className="font-semibold text-slate-900">Meta Conversions API（伺服器端）</h2>
              <p className="mt-1 text-sm text-slate-600">Access Token 會以租戶專屬加密儲存，儲存後不會再次顯示。留白可保留目前設定。</p>
            </div>
            <div className="grid gap-4 md:grid-cols-2">
              <Field
                label={tracking?.facebookAccessTokenEncrypted ? "Facebook Access Token（已設定，留白保留）" : "Facebook Access Token"}
                name="facebookAccessToken"
                type="password"
                autoComplete="new-password"
                placeholder={tracking?.facebookAccessTokenEncrypted ? "••••••••" : "貼上 Meta CAPI Access Token"}
                minLength={16}
                maxLength={4096}
              />
              <Field
                label="Meta Test Event Code（選填）"
                name="facebookTestEventCode"
                defaultValue={tracking?.facebookTestEventCode}
                autoComplete="off"
                maxLength={256}
                placeholder="例如：TEST12345"
              />
            </div>
          </section>
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
