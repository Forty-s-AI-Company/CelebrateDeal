import { LandingPageWorkspace } from "@/components/landing-page-workspace";
import { FunnelGoalPicker, type FunnelGoal } from "@/components/landing-pages/funnel-goal-picker";
import { requireVendorManagerContext } from "@/lib/auth";
import { getSalesProjectScope } from "@/lib/sales-project-scope";
import { getDb } from "@/lib/db";
import { CSRF_FIELD_NAME, getCsrfToken } from "@/lib/csrf";
import { listFunnelWebinarResources, listFunnelCommerceProductsForEditor } from "@/lib/landing-page-service";
export default async function NewLandingPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { auth, vendor } = await requireVendorManagerContext();
  const scope = await getSalesProjectScope(auth.user.id, vendor.id);
  if (!scope.projectId) return <p>請先選擇一個銷售專案，再建立一頁式網站。</p>;
  const query = await searchParams;
  const goal: FunnelGoal | null = query.goal === "audience" || query.goal === "sell" || query.goal === "custom" || query.goal === "webinar" ? query.goal : null;
  if (!goal) return <FunnelGoalPicker />;
  const forms = await getDb().registrationForm.findMany({ where: { vendorId: vendor.id, projectId: scope.projectId, isActive: true }, select: { id: true, slug: true, name: true }, orderBy: { name: "asc" } });
  const lives = await getDb().live.findMany({ where: { vendorId: vendor.id, projectId: scope.projectId, status: { in: ["scheduled", "live", "ended"] } }, select: { id: true, slug: true, title: true, scheduledAt: true, status: true, formId: true } });
  return <LandingPageWorkspace commerceProducts={await listFunnelCommerceProductsForEditor()} webinarResources={goal === "webinar" ? await listFunnelWebinarResources() : undefined} initialGoal={goal} initialName={typeof query.name === "string" ? query.name : undefined} initialSlug={typeof query.slug === "string" ? query.slug : undefined} initialCurrency={typeof query.currency === "string" ? query.currency : undefined} forms={forms} lives={lives.map((live) => ({ ...live, formId: live.formId ?? undefined, status: live.status as "scheduled" | "live" | "ended", scheduledAt: live.scheduledAt.toISOString(), timezone: vendor.timezone }))} csrfName={CSRF_FIELD_NAME} csrfToken={await getCsrfToken()} />;
}
