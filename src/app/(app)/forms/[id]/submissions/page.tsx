import { notFound } from "next/navigation";
import type { FormSubmissionSearchActionState } from "@/app/actions/form-submission-search-actions";
import { CsrfField } from "@/components/csrf-field";
import { FormSubmissionsWorkbench } from "@/components/form-submissions-workbench";
import { PageHeader } from "@/components/ui";
import { requireVendorManager } from "@/lib/auth";
import { loadFormSubmissionSearchResult } from "@/lib/form-submission-search";

export default async function FormSubmissionsPage({ params }: { params: Promise<{ id: string }> }) {
  const vendor = await requireVendorManager();
  const { id } = await params;
  const result = await loadFormSubmissionSearchResult(vendor.id, {
    formId: id,
    query: "",
    verification: "ALL",
    source: "ALL",
    page: 1,
  });
  if (!result) notFound();

  const initialState: FormSubmissionSearchActionState = {
    status: "idle",
    message: "",
    result,
  };

  return (
    <>
      <PageHeader title={`${result.form.name} 名單`} description="查找、篩選並分頁管理報名資料；只有完成 Email 驗證的報名會進入正式 KPI。" />
      <FormSubmissionsWorkbench initialState={initialState} csrfField={<CsrfField />} />
    </>
  );
}
