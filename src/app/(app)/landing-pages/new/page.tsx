import { FunnelGoalPicker, type FunnelGoal, type FunnelGoalPickerTemplate } from "@/components/landing-pages/funnel-goal-picker";
import { requireVendorManager, requireVendorManagerContext } from "@/lib/auth";
import { getSalesProjectScope, listSelectableSalesProjects } from "@/lib/sales-project-scope";
import { SalesProjectRequiredNotice } from "@/components/landing-pages/sales-project-required-notice";
import { CSRF_FIELD_NAME, getCsrfToken } from "@/lib/csrf";
import { getFunnelTemplateGalleryItem } from "@/lib/funnel-template-gallery";
import { getLandingPageTemplateName } from "@/lib/landing-page-template-service";

/** `?template=platform:<id>` or `?template=mine:<id>` from the template library; the name and goal come from server records. */
async function requestedTemplate(raw: string | string[] | undefined): Promise<FunnelGoalPickerTemplate | null | "missing"> {
  if (typeof raw !== "string" || !raw) return null;
  const [kind, id] = raw.split(":", 2);
  if (!id) return "missing";
  if (kind === "platform") {
    const item = getFunnelTemplateGalleryItem(id);
    // A retired or hidden template stays resolvable for saved funnels, but an old bookmark cannot start a new page with it.
    return item && !item.retired && !item.hidden ? { kind, id: item.id, name: item.name, goal: item.goal } : "missing";
  }
  if (kind === "mine") {
    const name = await getLandingPageTemplateName(id);
    return name ? { kind, id, name } : "missing";
  }
  return "missing";
}

export default async function NewLandingPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  // Keep the route's authorization contract explicit for the direct-URL guard matrix.
  await requireVendorManager();
  const { auth, vendor } = await requireVendorManagerContext();
  const scope = await getSalesProjectScope(auth.user.id, vendor.id);
  if (!scope.projectId) {
    // Switching keeps this URL (including ?template=...), so the merchant continues right here.
    return <main className="mx-auto max-w-3xl py-8">
      <p className="text-xs font-bold uppercase tracking-[0.18em] text-blue-700">建立一頁式網站</p>
      <h1 className="mt-2 text-3xl font-bold tracking-tight text-slate-950">建立新的一頁式網站</h1>
      <SalesProjectRequiredNotice projects={await listSelectableSalesProjects(vendor.id)} className="mt-6" />
    </main>;
  }
  const query = await searchParams;
  const template = await requestedTemplate(query.template);
  const requestedGoal: FunnelGoal | null = query.goal === "audience" || query.goal === "sell" || query.goal === "custom" || query.goal === "webinar" ? query.goal : null;
  const goal = template && template !== "missing" && template.goal ? template.goal : requestedGoal;
  return <FunnelGoalPicker csrfName={CSRF_FIELD_NAME} csrfToken={await getCsrfToken()} initialGoal={goal ?? undefined} initialName={typeof query.name === "string" ? query.name : undefined} initialSlug={typeof query.slug === "string" ? query.slug : undefined} initialCurrency={typeof query.currency === "string" ? query.currency : undefined} template={template === "missing" ? undefined : template ?? undefined} templateMissing={template === "missing"} />;
}
