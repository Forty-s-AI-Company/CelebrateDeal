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


/** Projects the user may switch to (same set and order as the sidebar switcher); always bound to the authenticated vendor. */
export async function listSelectableSalesProjects(vendorId: string): Promise<Array<{ id: string; name: string }>> {
  return getDb().salesProject.findMany({
    where: { vendorId, status: { not: "archived" } },
    orderBy: { updatedAt: "desc" },
    select: { id: true, name: true },
  });
}

export type DefaultProjectCandidate = {
  /** Explicit `?projectId` wins; otherwise the single project the merchant is currently scoped to. */
  candidate: string | null;
  /** True when the merchant is in the aggregate overview, so a new resource would stay unattached. */
  isAggregate: boolean;
};

/**
 * Picks the project a new resource should default to. The candidate is only a
 * suggestion: callers must still pass it through `resolveSalesProjectBinding`
 * so tenant ownership is enforced against the final DB read.
 */
export async function resolveDefaultProjectCandidate(userId: string, vendorId: string, requested: string | null | undefined): Promise<DefaultProjectCandidate> {
  if (requested) return { candidate: requested, isAggregate: false };
  const scope = await getSalesProjectScope(userId, vendorId);
  return { candidate: scope.projectId, isAggregate: scope.isAggregate };
}

/** Appends the current project to a creation link when the merchant is scoped to one. */
export function withProjectQuery(href: string, projectId: string | null) {
  return projectId ? `${href}?projectId=${encodeURIComponent(projectId)}` : href;
}
