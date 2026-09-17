import { FixedRegistrationFormBuilder } from "@/components/fixed-registration-form-builder";
import { CsrfField } from "@/components/csrf-field";
import { PageHeader } from "@/components/ui";
import { requireVendorManager } from "@/lib/auth";

export default async function NewFormPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  await requireVendorManager();
  await searchParams;
  return (
    <>
      <PageHeader title="新增報名表" description="使用固定欄位接收報名，可連結多個一頁式網站。" />
      <FixedRegistrationFormBuilder csrfField={<CsrfField />} />
    </>
  );
}
