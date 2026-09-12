import { FixedRegistrationFormBuilder } from "@/components/fixed-registration-form-builder";
import { CsrfField } from "@/components/csrf-field";
import { PageHeader } from "@/components/ui";
import { requireVendorManager } from "@/lib/auth";

export default async function NewFormPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  await requireVendorManager();
  await searchParams;
  return (
    <>
      <PageHeader title="新增報名表" description="用視覺化欄位編輯與即時預覽，建立可直接分享或放入直播頁的報名流程。" />
      <FormBuilder error={error} draftScope={vendor.id} promoVideos={promoVideos} />
    </>
  );
}
