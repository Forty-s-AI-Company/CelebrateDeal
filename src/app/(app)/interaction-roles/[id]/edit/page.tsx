import { notFound } from "next/navigation";
import { InteractionRolesWorkbench } from "@/components/interaction-roles-workbench";
import { PageHeader } from "@/components/ui";
import { requireVendorManager } from "@/lib/auth";
import { getCsrfToken } from "@/lib/csrf";
import { getDb } from "@/lib/db";
import { summarizeInteractionRoleUsage } from "@/lib/interaction-role-usage";

export default async function EditInteractionRolePage({
  params,
  searchParams = Promise.resolve({}),
}: {
  params: Promise<{ id: string }>;
  searchParams?: Promise<{ error?: string }>;
}) {
  const vendor = await requireVendorManager();
  const { id } = await params;
  const [roles, role, roleReferences, csrfToken, query] = await Promise.all([
    getDb().interactionRole.findMany({ where: { vendorId: vendor.id }, orderBy: { createdAt: "desc" } }),
    getDb().interactionRole.findFirst({ where: { id, vendorId: vendor.id } }),
    getDb().interactionEvent.findMany({
      where: { roleId: id, script: { vendorId: vendor.id } },
      orderBy: [{ scriptId: "asc" }, { triggerSec: "asc" }],
      select: {
        eventType: true,
        script: {
          select: {
            id: true,
            name: true,
            status: true,
            _count: { select: { lives: { where: { vendorId: vendor.id } } } },
          },
        },
      },
    }),
    getCsrfToken(),
    searchParams,
  ]);
  if (!role) notFound();
  const avatarAsset = role.avatarUrl
    ? await getDb().imageAsset.findFirst({
        where: { vendorId: vendor.id, status: "ready", publicUrl: role.avatarUrl },
        select: { id: true },
      })
    : null;

  return (
    <>
      <PageHeader title="互動角色" description="點選左側互動角色即可切換右側編輯面板。" />
      <InteractionRolesWorkbench
        key={role.id}
        roles={roles}
        selectedRole={role}
        roleUsage={summarizeInteractionRoleUsage(roleReferences)}
        csrfToken={csrfToken}
        initialAvatarAssetId={avatarAsset?.id ?? ""}
        error={query.error === "invalid_role" ? query.error : null}
      />
    </>
  );
}
