import { VendorFeatureManagement } from "@/components/vendor-feature-management";
import { PageHeader } from "@/components/ui";
import { requireVendorManagerContext } from "@/lib/auth";
import { getCsrfToken } from "@/lib/csrf";
import { normalizeVendorFeatureModules } from "@/lib/vendor-feature-toggles";

export default async function VendorFeaturesPage() {
  const [{ vendor }, csrfToken] = await Promise.all([requireVendorManagerContext(), getCsrfToken()]);
  return (
    <>
      <PageHeader title="功能模組管理" description="只留下目前需要的工作區入口；停用功能不會刪除任何歷史資料。" />
      <VendorFeatureManagement initialModules={normalizeVendorFeatureModules(vendor.enabledFeatureModules)} csrfToken={csrfToken} />
    </>
  );
}
