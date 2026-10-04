import { redirect } from "next/navigation";
import { requireVendorManagerContext } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { WorkspacePreparingProgress } from "@/components/workspace-preparing-progress";

export default async function PreparingWorkspacePage() {
  const { auth, vendor } = await requireVendorManagerContext();
  const preference = await getDb().userOnboardingPreference.findUnique({ where: { userId_vendorId: { userId: auth.user.id, vendorId: vendor.id } }, select: { selectedMode: true, questionnaireDoneAt: true } });
  const taskCount = await getDb().onboardingTaskState.count({ where: { vendorId: vendor.id, scopeKey: "workspace" } });
  // Existing workspaces may intentionally remain in the aggregate project view.
  if (!preference?.selectedMode || !preference.questionnaireDoneAt || taskCount === 0) redirect("/welcome");
  return <main className="grid min-h-screen place-items-center bg-slate-950 px-4 text-white"><section className="w-full max-w-xl rounded-3xl border border-white/10 bg-white/5 p-7 shadow-2xl backdrop-blur sm:p-10" aria-label="工作空間配置進度"><WorkspacePreparingProgress /></section></main>;
}
