import { BrandSettingsForm } from "@/components/brand-settings-form";
import { CsrfField } from "@/components/csrf-field";
import { Card, FormLayout, PageHeader } from "@/components/ui";
import { requireVendorManager } from "@/lib/auth";

export default async function BrandSettingsPage() {
  const vendor = await requireVendorManager();

  return (
    <>
      <PageHeader title="品牌設定" description="控制公開直播頁的品牌名稱、寄件人、聯絡網址、Logo、主色與 CTA 顏色。" />
      <FormLayout aside={<Card><h2 className="font-semibold text-slate-950">設定原則</h2><ul className="mt-3 grid gap-2 text-sm leading-6 text-slate-600"><li>管理操作維持品牌藍色。</li><li>CTA 色只套用在購買、報名與發布行動。</li><li>右側預覽只呈現尚未發布的效果。</li></ul></Card>}>
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
            senderName: vendor.senderName ?? "",
            contactUrl: vendor.contactUrl ?? "",
            logoUrl: vendor.logoUrl ?? "",
          }}
          />
        </Card>
      </FormLayout>
    </>
  );
}
