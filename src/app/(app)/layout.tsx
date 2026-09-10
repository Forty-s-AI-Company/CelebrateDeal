import { AppShell } from "@/components/app-shell";
import { requireVendorContext } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { normalizeVendorFeatureModules } from "@/lib/vendor-feature-toggles";

export default async function ProtectedLayout({ children }: { children: React.ReactNode }) {
  const { auth, vendor } = await requireVendorContext();
  const activeSubscription = await getDb().vendorSubscription.findFirst({
    where: { vendorId: vendor.id, status: "active" },
    select: { plan: { select: { name: true } } },
  });
  return <AppShell vendorName={vendor.name} memberRole={auth.member?.role ?? null} enabledModules={normalizeVendorFeatureModules(vendor.enabledFeatureModules)} planLabel={activeSubscription?.plan.name ?? "Free"}>{children}</AppShell>;
}
