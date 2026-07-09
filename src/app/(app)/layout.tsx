import { AppShell } from "@/components/app-shell";
import { requireVendor } from "@/lib/auth";

export default async function ProtectedLayout({ children }: { children: React.ReactNode }) {
  const vendor = await requireVendor();
  return <AppShell vendorName={vendor.name}>{children}</AppShell>;
}
