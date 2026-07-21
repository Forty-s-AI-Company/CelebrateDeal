import { FormBuilder } from "@/components/form-builder";
import { PageHeader } from "@/components/ui";
import { requireVendorManager } from "@/lib/auth";

export default async function NewFormPage() {
  await requireVendorManager();
  return (
    <>
      <PageHeader title="新增報名表" description="MVP 先用 JSON 欄位規格，後續可升級成拖拉式表單編輯器。" />
      <FormBuilder />
    </>
  );
}
