import { AppShell } from "@/components/app-shell";
import { requireVendorContext } from "@/lib/auth";

export default async function ProtectedLayout({ children }: { children: React.ReactNode }) {
  const { auth, vendor } = await requireVendorContext();
  return <AppShell vendorName={vendor.name} memberRole={auth.member?.role ?? null}>{children}</AppShell>;
}
