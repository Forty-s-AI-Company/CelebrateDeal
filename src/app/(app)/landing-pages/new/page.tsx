import { FunnelGoalPicker, type FunnelGoal } from "@/components/landing-pages/funnel-goal-picker";
import { requireVendorManager, requireVendorManagerContext } from "@/lib/auth";
import { getSalesProjectScope } from "@/lib/sales-project-scope";
import { CSRF_FIELD_NAME, getCsrfToken } from "@/lib/csrf";

export default async function NewLandingPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  // Keep the route's authorization contract explicit for the direct-URL guard matrix.
  await requireVendorManager();
  const { auth, vendor } = await requireVendorManagerContext();
  const scope = await getSalesProjectScope(auth.user.id, vendor.id);
  if (!scope.projectId) return <p>請先選擇一個銷售專案，再建立一頁式網站。</p>;
  const query = await searchParams;
  const goal: FunnelGoal | null = query.goal === "audience" || query.goal === "sell" || query.goal === "custom" || query.goal === "webinar" ? query.goal : null;
  return <FunnelGoalPicker csrfName={CSRF_FIELD_NAME} csrfToken={await getCsrfToken()} initialGoal={goal ?? undefined} initialName={typeof query.name === "string" ? query.name : undefined} initialSlug={typeof query.slug === "string" ? query.slug : undefined} initialCurrency={typeof query.currency === "string" ? query.currency : undefined} />;
}
