import { FunnelGoalPicker, type FunnelGoal } from "@/components/landing-pages/funnel-goal-picker";
import { requireVendorManager, requireVendorManagerContext } from "@/lib/auth";
import { getSalesProjectScope } from "@/lib/sales-project-scope";
import { CSRF_FIELD_NAME, getCsrfToken } from "@/lib/csrf";
import { ButtonLink, Card, PageHeader } from "@/components/ui";

export default async function NewLandingPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  // Keep the route's authorization contract explicit for the direct-URL guard matrix.
  await requireVendorManager();
  const { auth, vendor } = await requireVendorManagerContext();
  const scope = await getSalesProjectScope(auth.user.id, vendor.id);
  if (!scope.projectId) return <>
    <PageHeader title="建立一頁式網站" description="先建立或選擇一個銷售專案，再設定頁面內容。" />
    <Card>
      <h2 className="text-lg font-semibold text-slate-950">尚未選擇專案</h2>
      <p className="mt-2 text-sm text-slate-600">第一次使用可以建立新專案；已有專案則選擇既有專案後，再回來建立頁面。</p>
      <div className="mt-5 flex flex-wrap gap-3">
        <ButtonLink href="/projects/new">建立專案</ButtonLink>
        <ButtonLink href="/projects" tone="secondary">選擇既有專案</ButtonLink>
      </div>
    </Card>
  </>;
  const query = await searchParams;
  const goal: FunnelGoal | null = query.goal === "audience" || query.goal === "sell" || query.goal === "custom" || query.goal === "webinar" ? query.goal : null;
  return <FunnelGoalPicker csrfName={CSRF_FIELD_NAME} csrfToken={await getCsrfToken()} initialGoal={goal ?? undefined} initialName={typeof query.name === "string" ? query.name : undefined} initialSlug={typeof query.slug === "string" ? query.slug : undefined} initialCurrency={typeof query.currency === "string" ? query.currency : undefined} />;
}
