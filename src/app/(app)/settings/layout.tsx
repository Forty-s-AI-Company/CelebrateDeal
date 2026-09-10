import { navigationForRole } from "@/components/app-shell";
import { SettingsTabs } from "@/components/settings-tabs";
import { requireVendorContext } from "@/lib/auth";
import { normalizeVendorFeatureModules } from "@/lib/vendor-feature-toggles";

export default async function SettingsLayout({ children }: { children: React.ReactNode }) {
  const { auth, vendor } = await requireVendorContext();
  const allowedHrefs = new Set(
    navigationForRole(auth.member?.role ?? null, false, normalizeVendorFeatureModules(vendor.enabledFeatureModules))
      .flatMap((group) => group.items.map((item) => item.href)),
  );
  const tabs = ["/settings/brand", "/settings/tracking", "/settings/features", "/settings/commissions", "/settings/automations", "/settings/team", "/settings/security"].filter((href) => allowedHrefs.has(href));

  return (
    <div className="mx-auto grid max-w-7xl gap-6 lg:grid-cols-[13rem_minmax(0,1fr)]">
      <aside className="h-fit rounded-2xl border border-slate-200 bg-white p-3 shadow-sm lg:sticky lg:top-6">
        <div className="border-b border-slate-100 px-3 pb-3">
          <p className="text-sm font-semibold text-slate-950">設定</p>
          <p className="mt-1 text-xs leading-5 text-slate-500">管理工作區偏好與安全性。</p>
        </div>
        <SettingsTabs allowedHrefs={tabs} />
      </aside>
      <div className="min-w-0">{children}</div>
    </div>
  );
}
