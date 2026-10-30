import Link from "next/link";
import { redirect } from "next/navigation";
import { PageHeader } from "@/components/ui";
import { settingsHubForRole } from "@/lib/app-navigation";
import { requireVendorContext } from "@/lib/auth";
import { enabledFeaturesForVendor } from "@/lib/vendor-feature-toggles";

/**
 * Hub for every settings and billing page. The list comes from the same role
 * and feature filter as the sidebar, so a page the member cannot open is
 * never linked here; each target still enforces its own server-side guard.
 */
export default async function SettingsHubPage() {
  const { auth, vendor } = await requireVendorContext();
  const groups = settingsHubForRole(auth.member?.role ?? null, false, enabledFeaturesForVendor(vendor));
  if (groups.length === 0) redirect("/dashboard?error=insufficient_role");

  return (
    <>
      <PageHeader title="設定" description="品牌、系統、帳務與帳號安全的所有設定都集中在這裡。" />
      <div className="grid gap-8">
        {groups.map((group) => {
          const headingId = `settings-group-${group.label}`;
          return (
            <section key={group.label} aria-labelledby={headingId}>
              <h2 id={headingId} className="mb-3 text-sm font-semibold text-slate-700">{group.label}</h2>
              <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                {group.items.map((item) => {
                  const Icon = item.icon;
                  return (
                    <li key={item.href} className="min-w-0">
                      <Link
                        href={item.href}
                        className="flex h-full min-h-11 items-start gap-3 rounded-lg border border-border bg-white p-4 shadow-sm transition-colors hover:border-slate-300 hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-700"
                      >
                        <Icon className="mt-0.5 size-5 shrink-0 text-slate-500" strokeWidth={1.8} aria-hidden="true" />
                        <span className="min-w-0">
                          <span className="block text-sm font-semibold text-slate-950 [overflow-wrap:anywhere]">{item.label}</span>
                          {item.description ? <span className="mt-1 block text-sm text-slate-600 [overflow-wrap:anywhere]">{item.description}</span> : null}
                        </span>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </section>
          );
        })}
      </div>
    </>
  );
}
