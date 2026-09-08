import { AppShell } from "@/components/app-shell";
import { requireVendorContext } from "@/lib/auth";
import { normalizeVendorFeatureModules } from "@/lib/vendor-feature-toggles";

export default async function ProtectedLayout({ children }: { children: React.ReactNode }) {
  const { auth, vendor } = await requireVendorContext();
  return <AppShell vendorName={vendor.name} memberRole={auth.member?.role ?? null} enabledModules={normalizeVendorFeatureModules(vendor.enabledFeatureModules)}>{children}</AppShell>;
}
