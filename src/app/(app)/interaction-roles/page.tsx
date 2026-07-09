import { importSystemRolesAction } from "@/app/actions";
import { InteractionRolesWorkbench } from "@/components/interaction-roles-workbench";
import { PageHeader } from "@/components/ui";
import { requireVendor } from "@/lib/auth";
import { getDb } from "@/lib/db";

export default async function InteractionRolesPage() {
  const vendor = await requireVendor();
  const roles = await getDb().interactionRole.findMany({ where: { vendorId: vendor.id }, orderBy: { createdAt: "desc" } });

  return (
    <>
      <PageHeader
        title="互動角色"
        description="採用左側清單 / 右側編輯面板，快速建立官方角色、AI 主持人與系統助手。"
        action={
          <form action={importSystemRolesAction}>
            <button className="inline-flex h-10 items-center justify-center rounded-md border border-blue-200 bg-blue-50 px-4 text-sm font-semibold text-blue-700 shadow-sm transition hover:bg-blue-100">
              匯入 10 個官方角色
            </button>
          </form>
        }
      />
      <InteractionRolesWorkbench roles={roles} />
    </>
  );
}
