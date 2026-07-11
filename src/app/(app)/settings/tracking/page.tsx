import { saveTrackingSettingsAction } from "@/app/actions";
import { CsrfField } from "@/components/csrf-field";
import { Card, Field, PageHeader, SubmitButton } from "@/components/ui";
import { requireVendor } from "@/lib/auth";

export default async function TrackingSettingsPage() {
  const vendor = await requireVendor();
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
          <div className="grid gap-4 border-t border-border pt-5 md:grid-cols-2">
            <label className="grid gap-1.5 text-sm font-medium text-slate-700">
              推薦歸因規則
              <select name="attributionPolicy" defaultValue={tracking?.attributionPolicy ?? "last_touch"} className="h-10 rounded-md border border-border bg-white px-3 text-sm">
                <option value="last_touch">Last touch（最後一次有效推薦）</option>
                <option value="first_touch">First touch（第一次有效推薦）</option>
              </select>
            </label>
            <Field label="歸因期限（天）" name="attributionWindowDays" type="number" min={1} max={90} defaultValue={tracking?.attributionWindowDays ?? 30} />
          </div>
          <p className="text-sm text-slate-500">每次來源點擊都會記錄；First touch 會保留期限內第一筆有效推薦，Last touch 會更新為最新一筆。跨裝置不自動合併。</p>
          <SubmitButton />
        </form>
      </Card>
    </>
  );
}
