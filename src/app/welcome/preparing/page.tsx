import { redirect } from "next/navigation";
import { requireVendorManagerContext } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { ONBOARDING_HOME_PATH, pathWithSearchParams } from "@/lib/onboarding-entry";

/**
 * Retired interstitial. The questionnaire now goes straight to the unified
 * 上線任務 list; old links land there too, keeping their query string.
 */
export default async function PreparingWorkspacePage({ searchParams }: { searchParams?: Promise<Record<string, string | string[] | undefined>> }) {
  const { auth, vendor } = await requireVendorManagerContext();
  const preference = await getDb().userOnboardingPreference.findUnique({ where: { userId_vendorId: { userId: auth.user.id, vendorId: vendor.id } }, select: { selectedMode: true, questionnaireDoneAt: true } });
  const taskCount = await getDb().onboardingTaskState.count({ where: { vendorId: vendor.id, scopeKey: "workspace" } });
  // Existing workspaces may intentionally remain in the aggregate project view.
  if (!preference?.selectedMode || !preference.questionnaireDoneAt || taskCount === 0) redirect("/welcome");
  redirect(pathWithSearchParams(ONBOARDING_HOME_PATH, await searchParams));
}
