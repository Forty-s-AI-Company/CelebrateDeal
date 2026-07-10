import { AppShell } from "@/components/app-shell";
import { requireFinanceAdmin } from "@/lib/auth";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const { vendor, isPlatformAdmin } = await requireFinanceAdmin();
  return <AppShell vendorName={isPlatformAdmin ? "平台管理" : vendor?.name ?? "財務管理"}>{children}</AppShell>;
}
