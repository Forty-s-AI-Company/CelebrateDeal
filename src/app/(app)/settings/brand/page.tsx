import { saveBrandSettingsAction } from "@/app/actions";
import { CsrfField } from "@/components/csrf-field";
import { Card, Field, PageHeader, SubmitButton } from "@/components/ui";
import { requireVendorManager } from "@/lib/auth";

export default async function BrandSettingsPage() {
  const vendor = await requireVendorManager();

  return (
    <>
      <PageHeader title="品牌設定" description="控制公開直播頁的品牌名稱、Logo、主色與 CTA 顏色。" />
      <Card>
        <form action={saveBrandSettingsAction} className="grid gap-4">
          <CsrfField />
          <div className="grid gap-4 md:grid-cols-2">
            <Field label="品牌名稱" name="name" required defaultValue={vendor.name} />
            <Field label="品牌 Slug" name="slug" required defaultValue={vendor.slug} />
            <Field label="主要色" name="primaryColor" type="color" defaultValue={vendor.primaryColor} />
            <Field label="CTA 色" name="ctaColor" type="color" defaultValue={vendor.ctaColor} />
            <Field label="時區" name="timezone" defaultValue={vendor.timezone} />
            <Field label="客服 Email" name="supportEmail" type="email" defaultValue={vendor.supportEmail} />
          </div>
          <Field label="Logo URL" name="logoUrl" defaultValue={vendor.logoUrl} placeholder="https://..." />
          <SubmitButton />
        </form>
      </Card>
    </>
  );
}
