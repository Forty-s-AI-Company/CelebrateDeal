import { AppShell } from "@/components/app-shell";
import { requirePlatformAdmin } from "@/lib/auth";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  await requirePlatformAdmin();
  return <AppShell vendorName="平台管理" mode="admin">{children}</AppShell>;
}
