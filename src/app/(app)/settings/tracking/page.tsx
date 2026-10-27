import { saveTrackingCredentialAction } from "@/app/actions/tracking-credential-actions";
import { saveTrackingSettingsAction } from "@/app/actions/tracking-settings-actions";
import { CsrfField } from "@/components/csrf-field";
import { Card, Field, PageHeader, SubmitButton } from "@/components/ui";
import { requireVendorManagerContext } from "@/lib/auth";
import { StepUpMfaNotice } from "@/components/step-up-mfa-notice";
import { recentMfaStatus } from "@/lib/recent-mfa";
import { getDb } from "@/lib/db";

export default async function TrackingSettingsPage({ searchParams }: { searchParams?: Promise<{ tracking?: string }> }) {
  const { auth, vendor } = await requireVendorManagerContext("/settings/tracking");
  const tracking = vendor.tracking;
  const status = (await searchParams)?.tracking;
  const deliveries = await getDb().trackingDelivery.findMany({
    where: { vendorId: vendor.id }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: 20,
    select: { id: true, eventName: true, status: true, attemptCount: true, createdAt: true },
  });
  const eventLabels: Record<string, string> = { Purchase: "付款", Lead: "驗證名單", ViewContent: "內容觀看", Schedule: "預約" };
  const deliveryLabels: Record<string, string> = { queued: "待傳送", processing: "傳送中", accepted: "平台已接受", rejected: "傳送失敗", cancelled: "已取消" };

  return (
    <>
      <PageHeader title="追蹤設定" description="設定 Pixel、GTM 與事件開關；公開頁會先記錄平台內部 analytics_events。" />
      {status === "saved" ? <p role="status">伺服器追蹤設定已儲存。</p> : status === "conflict" ? <p role="alert">設定已被其他人修改，請重新載入後再儲存。</p> : status === "invalid" ? <p role="alert">設定未儲存。請確認 ID 格式：Meta Pixel 為 5–32 位數字、GA4 為 G- 開頭、GTM 為 GTM- 開頭、TikTok 為英數字。</p> : null}
      <Card>
        <form action={saveTrackingCredentialAction} className="mb-6 grid gap-4 border-b border-slate-200 pb-6">
          <CsrfField />
          <input type="hidden" name="credentialRevision" value={tracking?.credentialRevision ?? 0} />
          <h2 className="font-bold">Meta 伺服器追蹤</h2>
          <StepUpMfaNotice status={recentMfaStatus(auth)} nextPath="/settings/tracking" operation="儲存 Meta 憑證" />
          <p className="text-sm text-slate-600">{tracking?.facebookAccessTokenEncrypted ? "已設定加密憑證。留白會保留既有憑證。" : "尚未設定憑證。"}</p>
          <Field label="Meta CAPI Access Token" name="facebookAccessToken" type="password" autoComplete="new-password" maxLength={4096} />
          <Field label="Meta Test Event Code" name="facebookTestEventCode" defaultValue={tracking?.facebookTestEventCode ?? ""} maxLength={128} autoComplete="off" />
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="clearTrackingToken" />撤除既有追蹤憑證</label>
          <SubmitButton>儲存伺服器追蹤設定</SubmitButton>
        </form>
        <form action={saveTrackingSettingsAction} className="grid gap-4">
          <CsrfField />
          <h2 className="font-bold">整合設定（只填 ID）</h2>
          <p className="text-sm text-slate-600">平台會依 ID 產生標準追蹤碼，不接受自行貼上的 script。</p>
          <div className="grid gap-4 md:grid-cols-2">
            <Field label="Meta（Facebook）Pixel ID" name="facebookPixelId" defaultValue={tracking?.facebookPixelId} maxLength={32} placeholder="例如 123456789012345" autoComplete="off" />
            <Field label="GA4 評估 ID" name="ga4MeasurementId" defaultValue={tracking?.ga4MeasurementId} placeholder="G-XXXXXXXXXX" autoComplete="off" />
            <Field label="TikTok Pixel ID" name="tiktokPixelId" defaultValue={tracking?.tiktokPixelId} autoComplete="off" />
            <Field label="Google Tag Manager ID" name="googleTagManagerId" defaultValue={tracking?.googleTagManagerId} placeholder="GTM-XXXXXXX" autoComplete="off" />
          </div>
          <p className="text-xs leading-5 text-slate-600">Google Tag Manager 容器可以執行任意自訂 HTML 與 JavaScript，為了保護訪客與後台帳號，公開頁不會載入 GTM；請改用 GA4 評估 ID 與 Meta Pixel ID。TikTok Pixel 目前只保留設定值。</p>
          <label className="flex items-start justify-between gap-3 rounded-lg border border-slate-200 p-4 text-sm font-medium text-slate-700">
            <span>在一頁式網站公開頁載入 GA4 與 Meta Pixel 瀏覽器追蹤碼<span className="block text-xs font-normal text-slate-600">需同時開啟「記錄頁面瀏覽」。追蹤碼由 Google 與 Meta 提供，會在訪客瀏覽器設定它們的 Cookie。</span></span>
            <input name="enableBrowserTags" type="checkbox" defaultChecked={tracking?.enableBrowserTags ?? false} className="h-5 w-5 accent-blue-600" />
          </label>
          <div className="grid gap-3 rounded-lg bg-slate-50 p-4">
            {[
              ["enablePageView", "記錄頁面瀏覽", tracking?.enablePageView ?? true],
              ["enableLeadEvent", "記錄名單送出", tracking?.enableLeadEvent ?? true],
              ["enablePurchaseEvent", "記錄商品 CTA 與已確認付款事件", tracking?.enablePurchaseEvent ?? true],
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
      <Card>
        <h2 className="mb-3 font-bold">最近的伺服器追蹤事件</h2>
        <p className="mb-3 text-sm text-slate-600">付款確認、名單驗證、內容觀看與預約建立後記錄事件。平台接受事件不代表廣告歸因或額外的付款證明。</p>
        {deliveries.length === 0 ? <p className="text-sm text-slate-500">目前沒有伺服器追蹤事件。</p> : <ul className="divide-y divide-slate-200">
          {deliveries.map(delivery => <li key={delivery.id} className="flex flex-wrap justify-between gap-2 py-3 text-sm">
            <span>{eventLabels[delivery.eventName] ?? "事件"}</span>
            <span>{deliveryLabels[delivery.status] ?? "狀態待確認"}</span>
            <span>已嘗試 {delivery.attemptCount} 次</span>
            <time dateTime={delivery.createdAt.toISOString()}>{delivery.createdAt.toISOString().replace("T", " ").slice(0, 19)} UTC</time>
          </li>)}
        </ul>}
      </Card>
    </>
  );
}
