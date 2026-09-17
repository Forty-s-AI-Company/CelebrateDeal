import { getDb } from "@/lib/db";

export type SalesProjectScope = {
  projectId: string | null;
  projectName: string | null;
  isAggregate: boolean;
  isLegacyWorkspace: boolean;
};

/** Resolves the user's selected project inside the authenticated vendor only. */
export async function getSalesProjectScope(userId: string, vendorId: string): Promise<SalesProjectScope> {
  const preference = await getDb().userOnboardingPreference.findUnique({
    where: { userId_vendorId: { userId, vendorId } },
    select: { selectedProjectId: true, selectedProject: { select: { id: true, name: true, status: true } } },
  });
  const selected = preference?.selectedProject?.status === "archived" ? null : preference?.selectedProject;
  return {
    projectId: selected?.id ?? null,
    projectName: selected?.name ?? null,
    isAggregate: Boolean(preference && !selected),
    // Accounts that predate project onboarding retain their vendor-wide flows.
    isLegacyWorkspace: !preference,
  };
}

export function salesScopeDescription(workspaceName: string, scope: SalesProjectScope) {
  if (scope.projectName) return `目前資料範圍：${workspaceName} / ${scope.projectName}`;
  if (scope.isAggregate) return `目前資料範圍：${workspaceName} / 全部專案總覽（彙總唯讀）`;
  return `目前資料範圍：${workspaceName}`;
}

/** Rejects mutations from the aggregate overview while preserving legacy accounts. */
export async function requireEditableSalesProjectScope(userId: string, vendorId: string) {
  const scope = await getSalesProjectScope(userId, vendorId);
  if (scope.isAggregate) throw new Error("sales_project_required");
  return scope;
}
