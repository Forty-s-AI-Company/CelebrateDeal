import { onboardingChecklistItems, type OnboardingChecklist } from "@/lib/merchant-onboarding";

export type DashboardChecklistItem = {
  label: string;
  href: string;
  done: boolean;
};

const MANAGER_ROLES = new Set(["owner", "admin"]);

export function isDashboardManagerRole(memberRole: string | null) {
  return memberRole !== null && MANAGER_ROLES.has(memberRole);
}

/**
 * The dashboard card is a summary of the single 上線任務 list (`/onboarding`);
 * it no longer keeps its own steps. Setup links are for managers only.
 */
export function dashboardChecklistForRole(
  checklist: OnboardingChecklist | null,
  memberRole: string | null,
): DashboardChecklistItem[] {
  if (!checklist || !isDashboardManagerRole(memberRole)) return [];
  return onboardingChecklistItems(checklist).map((item) => ({ label: item.title, href: item.href, done: item.status === "completed" }));
}
