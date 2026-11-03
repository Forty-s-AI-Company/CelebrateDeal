import { updateVendorBetaFeatureGrantsAction } from "@/app/actions/vendor-beta-feature-actions";
import { resumeVendorAction, suspendVendorAction } from "@/app/actions/vendor-suspension-actions";
import { CsrfField } from "@/components/csrf-field";
import { FormSubmitButton } from "@/components/form-submit-button";
import { StepUpMfaNotice } from "@/components/step-up-mfa-notice";
import { EmptyState, PageHeader } from "@/components/ui";
import { requireFinanceAdmin } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { formatDateTime } from "@/lib/format";
import { recentMfaStatus } from "@/lib/recent-mfa";
import { BETA_FEATURE_LABELS, BETA_GATED_FEATURES, normalizeBetaFeatureGrants } from "@/lib/vendor-feature-toggles";
import { VENDOR_SUSPENSION_REASON_MAX_LENGTH } from "@/lib/vendor-suspension-state";

const ADMIN_PATH = "/admin/vendor-features";

const MESSAGES: Record<string, string> = {
  invalid: "設定格式不正確，未做任何變更。",
  not_found: "找不到這個商家，未做任何變更。",
  conflict: "設定在你送出前已被其他人更新，請重新整理後再試。",
};

const SUSPENSION_MESSAGES: Record<string, string> = {
  suspended: "已凍結商家：後台只顯示「商家已暫停」，公開頁不再顯示，學員登入已全部撤銷。",
  resumed: "已解除凍結：商家恢復使用，暫停期間已付款但未開通的權限已開通。",
};

const SUSPENSION_ERRORS: Record<string, string> = {
  invalid: "資料格式不正確，未做任何變更。",
  reason_required: `請填寫凍結原因（1–${VENDOR_SUSPENSION_REASON_MAX_LENGTH} 字），未做任何變更。`,
  not_found: "找不到這個商家，未做任何變更。",
  already_suspended: "這個商家已經是凍結狀態，未做任何變更。",
  not_suspended: "這個商家目前沒有凍結，未做任何變更。",
  conflict: "狀態在你送出前已被其他人更新，請重新整理後再試。",
};

type SearchParams = { q?: string; saved?: string; error?: string; vendor?: string; suspension?: string; suspensionError?: string };

export default async function AdminVendorFeaturesPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const { user, session } = await requireFinanceAdmin();
  const params = await searchParams;
  const search = (params.q ?? "").trim().slice(0, 120);
  const vendors = await getDb().vendor.findMany({
    where: search ? { OR: [{ name: { contains: search, mode: "insensitive" } }, { slug: { contains: search, mode: "insensitive" } }] } : {},
    orderBy: { createdAt: "asc" },
    take: 100,
    select: { id: true, name: true, slug: true, betaFeatureGrants: true, suspendedAt: true, suspendedReason: true },
  });
  const message = params.saved ? "已儲存，商家下次載入頁面即生效。" : params.error ? MESSAGES[params.error] ?? MESSAGES.invalid : null;
  const suspensionMessage = params.suspension ? SUSPENSION_MESSAGES[params.suspension] ?? null
    : params.suspensionError ? SUSPENSION_ERRORS[params.suspensionError] ?? SUSPENSION_ERRORS.invalid : null;
  const suspensionIsError = !params.suspension && Boolean(params.suspensionError);
  // The vendor parameter is only honoured when it matches a card that is actually rendered.
  const focusedVendorId = typeof params.vendor === "string" && vendors.some((vendor) => vendor.id === params.vendor) ? params.vendor : null;
  const isError = !params.saved && Boolean(params.error);
  const mfaStatus = recentMfaStatus({ user, session });

  return (
    <>
      <PageHeader title="商家封測模組與凍結" description="課程、billing、平台服務綁卡、諮詢預約、瀏覽器直播與彈幕在封測期間預設關閉；只有平台管理員能逐商家開啟，伺服器端的頁面、操作與 API 都會依此設定放行。凍結商家會讓整個租戶暫停服務：後台只顯示「商家已暫停」、公開頁 404、排程不再寄信或推播 LINE；已付款的回呼仍會入帳，但不開通權限，解除凍結時才開通。" />
      <div className="mb-4"><StepUpMfaNotice status={mfaStatus} nextPath={ADMIN_PATH} operation="凍結或解除凍結商家" /></div>
      {message && !focusedVendorId ? <p role="status" className="mb-4 text-sm font-semibold text-slate-700">{message}</p> : null}
      {suspensionMessage && !focusedVendorId ? <p role={suspensionIsError ? "alert" : "status"} className={`mb-4 text-sm font-semibold ${suspensionIsError ? "text-red-700" : "text-slate-700"}`}>{suspensionMessage}</p> : null}
      <form method="get" className="mb-4 flex flex-wrap gap-3">
        <label className="text-sm font-semibold text-slate-700">搜尋商家<input name="q" defaultValue={search} maxLength={120} className="mt-1 block min-h-11 rounded-md border border-border px-3" /></label>
        <button className="min-h-11 self-end rounded-md border border-border px-4 text-sm font-semibold">搜尋</button>
      </form>
      {vendors.length === 0 ? <EmptyState title="沒有符合的商家" description="請換個關鍵字再搜尋。" /> : (
        <div className="grid gap-3">
          {vendors.map((vendor) => {
            const grants = normalizeBetaFeatureGrants(vendor.betaFeatureGrants);
            const focused = vendor.id === focusedVendorId;
            const suspendedAt = vendor.suspendedAt instanceof Date ? vendor.suspendedAt : null;
            return (
              <div key={vendor.id} className="grid gap-2">
                <form
                  id={`vendor-${vendor.id}`}
                  action={updateVendorBetaFeatureGrantsAction}
                  aria-label={`${vendor.name} 的封測模組`}
                  data-feedback={focused && message ? (isError ? "error" : "saved") : undefined}
                  className={`scroll-mt-4 rounded-lg border bg-white p-4 shadow-sm ${focused && message ? (isError ? "border-red-600" : "border-emerald-600 ring-2 ring-emerald-200") : "border-border"}`}
                >
                  <CsrfField />
                  <input type="hidden" name="vendorId" value={vendor.id} />
                  <h2 className="font-semibold text-slate-950">
                    {vendor.name} <span className="text-sm font-normal text-slate-500">／{vendor.slug}</span>
                    {suspendedAt ? <span className="ml-2 rounded bg-red-50 px-2 py-0.5 text-xs font-semibold text-red-700">已凍結</span> : null}
                  </h2>
                  <fieldset className="mt-3 flex flex-wrap gap-x-5 gap-y-2">
                    <legend className="sr-only">開啟的模組</legend>
                    {BETA_GATED_FEATURES.map((feature) => (
                      <label key={feature} className="inline-flex min-h-11 items-center gap-2 text-sm text-slate-700">
                        <input type="checkbox" name="grants" value={feature} defaultChecked={grants.includes(feature)} className="h-4 w-4" />
                        {BETA_FEATURE_LABELS[feature]}
                      </label>
                    ))}
                  </fieldset>
                  <div className="mt-3 flex flex-wrap items-center gap-3">
                    <FormSubmitButton
                      className="min-h-11 rounded-md bg-primary px-4 text-sm font-semibold text-white hover:bg-primary-dark"
                      pendingChildren="儲存中…"
                      pendingMessage="正在儲存，請勿重複送出。"
                    >
                      儲存設定
                    </FormSubmitButton>
                    {focused && message ? <p role="status" className={`text-sm font-semibold ${isError ? "text-red-700" : "text-emerald-700"}`}>{message}</p> : null}
                  </div>
                </form>
                <form
                  id={`vendor-suspension-${vendor.id}`}
                  action={suspendedAt ? resumeVendorAction : suspendVendorAction}
                  aria-label={`${vendor.name} 的凍結狀態`}
                  className={`rounded-lg border bg-white p-4 shadow-sm ${suspendedAt ? "border-red-300" : "border-border"}`}
                >
                  <CsrfField />
                  <input type="hidden" name="vendorId" value={vendor.id} />
                  {suspendedAt ? (
                    <>
                      <p className="text-sm text-slate-700">凍結時間：{formatDateTime(suspendedAt)}</p>
                      {vendor.suspendedReason ? <p className="mt-1 whitespace-pre-wrap text-sm text-slate-700">原因：{vendor.suspendedReason}</p> : null}
                      <div className="mt-3 flex flex-wrap items-center gap-3">
                        <FormSubmitButton
                          className="min-h-11 rounded-md border border-border px-4 text-sm font-semibold text-slate-800"
                          pendingChildren="解除中…"
                          pendingMessage="正在解除凍結，請勿重複送出。"
                        >
                          解除凍結
                        </FormSubmitButton>
                        {focused && suspensionMessage ? <p role={suspensionIsError ? "alert" : "status"} className={`text-sm font-semibold ${suspensionIsError ? "text-red-700" : "text-emerald-700"}`}>{suspensionMessage}</p> : null}
                      </div>
                    </>
                  ) : (
                    <>
                      <label className="block text-sm font-semibold text-slate-700">
                        凍結原因（平台內部紀錄）
                        <textarea name="reason" required minLength={1} maxLength={VENDOR_SUSPENSION_REASON_MAX_LENGTH} rows={2} className="mt-1 block w-full rounded-md border border-border px-3 py-2 font-normal" />
                      </label>
                      <div className="mt-3 flex flex-wrap items-center gap-3">
                        <FormSubmitButton
                          className="min-h-11 rounded-md bg-red-700 px-4 text-sm font-semibold text-white hover:bg-red-800"
                          pendingChildren="凍結中…"
                          pendingMessage="正在凍結商家，請勿重複送出。"
                        >
                          凍結商家
                        </FormSubmitButton>
                        {focused && suspensionMessage ? <p role={suspensionIsError ? "alert" : "status"} className={`text-sm font-semibold ${suspensionIsError ? "text-red-700" : "text-emerald-700"}`}>{suspensionMessage}</p> : null}
                      </div>
                    </>
                  )}
                </form>
              </div>
            );
          })}
        </div>
      )}
    </>
  );
}
