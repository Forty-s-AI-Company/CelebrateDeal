import { notFound } from "next/navigation";
import { InteractionRolesWorkbench } from "@/components/interaction-roles-workbench";
import { PageHeader } from "@/components/ui";
import { requireVendor } from "@/lib/auth";
import { getDb } from "@/lib/db";

export default async function EditInteractionRolePage({ params }: { params: Promise<{ id: string }> }) {
  const vendor = await requireVendor();
  const { id } = await params;
  const [roles, role] = await Promise.all([
    getDb().interactionRole.findMany({ where: { vendorId: vendor.id }, orderBy: { createdAt: "desc" } }),
    getDb().interactionRole.findFirst({ where: { id, vendorId: vendor.id } }),
  ]);
  if (!role) notFound();

  return (
    <>
      <PageHeader title="互動角色" description="點選左側使用者即可切換右側編輯面板。" />
      <InteractionRolesWorkbench roles={roles} selectedRole={role} />
    </>
  );
}
