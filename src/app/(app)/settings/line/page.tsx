import { LineOfficialAccountForm } from "@/components/line-official-account-form";
import { PageHeader } from "@/components/ui";
import { requireVendorOwner } from "@/lib/auth";
import { getCsrfToken } from "@/lib/csrf";
import { getDb } from "@/lib/db";

export default async function LineSettingsPage() {
  const auth = await requireVendorOwner();
  const [csrfToken, account] = await Promise.all([
    getCsrfToken(),
    getDb().lineOfficialAccount.findUnique({
      where: { vendorId: auth.vendor.id },
      select: { id: true, status: true, connectedAt: true },
    }),
  ]);
  return (
    <div className="space-y-6">
      <PageHeader title="LINE 整合" description="管理官方帳號推播與 LINE Login。憑證只會加密儲存，不會在頁面重新顯示。" />
      <LineOfficialAccountForm csrfToken={csrfToken} connected={account?.status === "active"} />
    </div>
  );
}
