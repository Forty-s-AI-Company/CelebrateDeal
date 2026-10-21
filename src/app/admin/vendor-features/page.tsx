import { updateVendorBetaFeatureGrantsAction } from "@/app/actions/vendor-beta-feature-actions";
import { CsrfField } from "@/components/csrf-field";
import { EmptyState, PageHeader } from "@/components/ui";
import { requireFinanceAdmin } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { BETA_FEATURE_LABELS, BETA_GATED_FEATURES, normalizeBetaFeatureGrants } from "@/lib/vendor-feature-toggles";

const MESSAGES: Record<string, string> = {
  invalid: "設定格式不正確，未做任何變更。",
  not_found: "找不到這個商家，未做任何變更。",
  conflict: "設定在你送出前已被其他人更新，請重新整理後再試。",
};

export default async function AdminVendorFeaturesPage({ searchParams }: { searchParams: Promise<{ q?: string; saved?: string; error?: string }> }) {
  await requireFinanceAdmin();
  const params = await searchParams;
  const search = (params.q ?? "").trim().slice(0, 120);
  const vendors = await getDb().vendor.findMany({
    where: search ? { OR: [{ name: { contains: search, mode: "insensitive" } }, { slug: { contains: search, mode: "insensitive" } }] } : {},
    orderBy: { createdAt: "asc" },
    take: 100,
    select: { id: true, name: true, slug: true, betaFeatureGrants: true },
  });
  const message = params.saved ? "已儲存，商家下次載入頁面即生效。" : params.error ? MESSAGES[params.error] ?? MESSAGES.invalid : null;

  return (
    <>
      <PageHeader title="商家封測模組" description="課程、billing、平台服務綁卡、諮詢預約、瀏覽器直播與彈幕在封測期間預設關閉；只有平台管理員能逐商家開啟，伺服器端的頁面、操作與 API 都會依此設定放行。" />
      {message ? <p role="status" className="mb-4 text-sm font-semibold text-slate-700">{message}</p> : null}
      <form method="get" className="mb-4 flex flex-wrap gap-3">
        <label className="text-sm font-semibold text-slate-700">搜尋商家<input name="q" defaultValue={search} maxLength={120} className="mt-1 block min-h-11 rounded-md border border-border px-3" /></label>
        <button className="min-h-11 self-end rounded-md border border-border px-4 text-sm font-semibold">搜尋</button>
      </form>
      {vendors.length === 0 ? <EmptyState title="沒有符合的商家" description="請換個關鍵字再搜尋。" /> : (
        <div className="grid gap-3">
          {vendors.map((vendor) => {
            const grants = normalizeBetaFeatureGrants(vendor.betaFeatureGrants);
            return (
              <form key={vendor.id} action={updateVendorBetaFeatureGrantsAction} aria-label={`${vendor.name} 的封測模組`} className="rounded-lg border border-border bg-white p-4 shadow-sm">
                <CsrfField />
                <input type="hidden" name="vendorId" value={vendor.id} />
                <h2 className="font-semibold text-slate-950">{vendor.name} <span className="text-sm font-normal text-slate-500">／{vendor.slug}</span></h2>
                <fieldset className="mt-3 flex flex-wrap gap-x-5 gap-y-2">
                  <legend className="sr-only">開啟的模組</legend>
                  {BETA_GATED_FEATURES.map((feature) => (
                    <label key={feature} className="inline-flex min-h-11 items-center gap-2 text-sm text-slate-700">
                      <input type="checkbox" name="grants" value={feature} defaultChecked={grants.includes(feature)} className="h-4 w-4" />
                      {BETA_FEATURE_LABELS[feature]}
                    </label>
                  ))}
                </fieldset>
                <button type="submit" className="mt-3 min-h-11 rounded-md bg-primary px-4 text-sm font-semibold text-white">儲存設定</button>
              </form>
            );
          })}
        </div>
      )}
    </>
  );
}
