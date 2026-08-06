export type DashboardChecklistItem = {
  label: string;
  href: string;
  done: boolean;
  managerOnly?: boolean;
};

export type DashboardChecklistCounts = {
  productCount: number;
  liveCount: number;
  interactionRoleCount: number;
  interactionScriptCount: number;
  trackingConfigured: boolean;
};

const MANAGER_ROLES = new Set(["owner", "admin"]);

export function isDashboardManagerRole(memberRole: string | null) {
  return memberRole !== null && MANAGER_ROLES.has(memberRole);
}

export function filterDashboardChecklistForRole(
  items: DashboardChecklistItem[],
  memberRole: string | null,
) {
  const isManager = isDashboardManagerRole(memberRole);
  return items.filter((item) => !item.managerOnly || isManager);
}

export function dashboardChecklistForRole(
  counts: DashboardChecklistCounts,
  memberRole: string | null,
) {
  return filterDashboardChecklistForRole(
    [
      {
        label: "建立商品",
        href: "/products/new",
        done: counts.productCount > 0,
        managerOnly: true,
      },
      {
        label: "建立直播間",
        href: "/lives/new",
        done: counts.liveCount > 0,
        managerOnly: true,
      },
      {
        label: "建立互動角色",
        href: "/interaction-roles/new",
        done: counts.interactionRoleCount > 0,
        managerOnly: true,
      },
      {
        label: "建立互動腳本",
        href: "/interaction-scripts/new",
        done: counts.interactionScriptCount > 0,
        managerOnly: true,
      },
      {
        label: "設定追蹤",
        href: "/settings/tracking",
        done: counts.trackingConfigured,
        managerOnly: true,
      },
    ],
    memberRole,
  );
}
