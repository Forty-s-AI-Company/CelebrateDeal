import { BrandSettingsForm } from "@/components/brand-settings-form";
import { CsrfField } from "@/components/csrf-field";
import { Card, PageHeader } from "@/components/ui";
import { requireVendorManager } from "@/lib/auth";

export default async function BrandSettingsPage() {
  const vendor = await requireVendorManager();

  return (
    <>
      <PageHeader title="品牌設定" description="控制公開直播頁的品牌名稱、Logo、主色與 CTA 顏色。" />
      <Card>
        <BrandSettingsForm
          csrfField={<CsrfField />}
          initialValues={{
            name: vendor.name,
            slug: vendor.slug,
            primaryColor: vendor.primaryColor,
            ctaColor: vendor.ctaColor,
            timezone: vendor.timezone,
            supportEmail: vendor.supportEmail ?? "",
            logoUrl: vendor.logoUrl ?? "",
          }}
        />
      </Card>
    </>
  );
}
