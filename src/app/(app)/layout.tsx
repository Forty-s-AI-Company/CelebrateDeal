import { AppShell } from "@/components/app-shell";
import { FeatureAccessBoundary } from "@/components/feature-access-boundary";
import { requireVendorContext } from "@/lib/auth";
import { normalizeVendorFeatureModules } from "@/lib/vendor-feature-toggles";

export default async function ProtectedLayout({ children }: { children: React.ReactNode }) {
  const { auth, vendor } = await requireVendorContext();
  const enabledModules = normalizeVendorFeatureModules(vendor.enabledFeatureModules);
  return <AppShell vendorName={vendor.name} memberRole={auth.member?.role ?? null} enabledModules={enabledModules}>
    <FeatureAccessBoundary enabledModules={enabledModules}>{children}</FeatureAccessBoundary>
  </AppShell>;
}
