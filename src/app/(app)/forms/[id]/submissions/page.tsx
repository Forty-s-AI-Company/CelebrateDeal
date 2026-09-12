import { notFound } from "next/navigation";
import type { FormSubmissionSearchActionState } from "@/app/actions/form-submission-search-actions";
import { CsrfField } from "@/components/csrf-field";
import { FormSubmissionsWorkbench } from "@/components/form-submissions-workbench";
import { PageHeader } from "@/components/ui";
import { requireVendorManagerContext } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { loadFormSubmissionSearchResult } from "@/lib/form-submission-search";
import { getSalesProjectScope } from "@/lib/sales-project-scope";

export default async function FormSubmissionsPage({ params }: { params: Promise<{ id: string }> }) {
  const { auth, vendor } = await requireVendorManagerContext();
  const scope = await getSalesProjectScope(auth.user.id, vendor.id);
  const { id } = await params;
  if (scope.projectId) {
    const visibleForm = await getDb().registrationForm.findFirst({
      where: { id, vendorId: vendor.id, projectId: scope.projectId },
      select: { id: true },
    });
    if (!visibleForm) notFound();
  }
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
