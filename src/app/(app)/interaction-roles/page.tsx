import { importSystemRolesAction } from "@/app/actions";
import { CsrfField } from "@/components/csrf-field";
import { FormSubmitButton } from "@/components/form-submit-button";
import { InteractionRolesWorkbench } from "@/components/interaction-roles-workbench";
import { PageHeader } from "@/components/ui";
import { requireVendorManager } from "@/lib/auth";
import { getCsrfToken } from "@/lib/csrf";
import { getDb } from "@/lib/db";

export default async function InteractionRolesPage({
  searchParams = Promise.resolve({}),
}: {
  searchParams?: Promise<{ error?: string }>;
}) {
  const vendor = await requireVendorManager();
  const [roles, csrfToken, query] = await Promise.all([
    getDb().interactionRole.findMany({ where: { vendorId: vendor.id }, orderBy: { createdAt: "desc" } }),
    getCsrfToken(),
    searchParams,
  ]);

  return (
    <>
      <PageHeader
        title="互動角色"
        description="採用左側清單 / 右側編輯面板，快速建立官方角色、AI 主持人與系統助手。"
        action={
          <form action={importSystemRolesAction}>
            <CsrfField />
            <FormSubmitButton
              pendingChildren="匯入中…"
              pendingMessage="正在匯入官方互動角色"
              className="inline-flex h-10 items-center justify-center rounded-md border border-blue-200 bg-blue-50 px-4 text-sm font-semibold text-blue-700 shadow-sm transition hover:bg-blue-100"
            >
              匯入 10 個官方角色
            </FormSubmitButton>
          </form>
        }
      />
      <InteractionRolesWorkbench
        key="new-role"
        roles={roles}
        csrfToken={csrfToken}
        error={query.error === "invalid_role" || query.error === "missing_role" ? query.error : null}
      />
    </>
  );
}
