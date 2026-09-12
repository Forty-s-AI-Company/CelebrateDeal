import { Suspense } from "react";
import { Plus } from "lucide-react";
import { redirect } from "next/navigation";
import { ButtonLink, PageHeader } from "@/components/ui";
import { requireVendorContext } from "@/lib/auth";
import { applyE2eLoadingDelay } from "@/lib/e2e-loading-diagnostic";
import DashboardDetails from "./dashboard-details";
import DashboardDetailsLoading from "./dashboard-details-loading";
import DashboardKpis from "./dashboard-kpis";
import DashboardKpisLoading from "./dashboard-kpis-loading";
import { hasVendorFeature, normalizeVendorFeatureModules } from "@/lib/vendor-feature-toggles";
import { getDb } from "@/lib/db";
import { getSalesProjectScope } from "@/lib/sales-project-scope";

function parseDashboardDetailsDiagnosticDelay(value: string | undefined) {
  if (process.env.NODE_ENV === "production" && process.env.E2E_TEST_MODE !== "true") return 0;
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isSafeInteger(parsed) && parsed > 0 ? Math.min(parsed, 10_000) : 0;
}

function parseDashboardDiagnosticFailureScope(value: string | undefined) {
  if (process.env.NODE_ENV === "production" && process.env.E2E_TEST_MODE !== "true") return null;
  return value === "analytics" ? value : null;
}

async function loadDashboardPersonalization(userId: string | undefined, vendorId: string) {
  // Optional chaining preserves compatibility with narrow DB mocks used by
  // existing route-shell tests while production Prisma always has this model.
  if (!userId) return null;
  return getDb().userOnboardingPreference?.findUnique?.({
    where: { userId_vendorId: { userId, vendorId } },
    include: { selectedProject: { select: { name: true, status: true } } },
  }) ?? null;
}

function dashboardPrimaryAction(mode: string) {
  if (mode === "consulting") return { href: "/consultations", label: "建立諮詢服務" };
  if (mode === "live_course") return { href: "/lives/new", label: "建立直播活動" };
  return { href: "/projects/new", label: "建立銷售流程" };
}

function dashboardPresentation(preference: Awaited<ReturnType<typeof loadDashboardPersonalization>>, vendorName: string) {
  const mode = preference?.selectedMode ?? "live_course";
  return {
    mode,
    title: preference ? (preference.selectedProject?.status === "published" ? "營運 Dashboard" : "上線工作台") : "Dashboard",
    scopeLabel: preference?.selectedProject ? `${vendorName} / ${preference.selectedProject.name}` : `${vendorName} / 全部專案總覽`,
    scopeHint: preference?.selectedProject ? "指標與任務會跟隨目前專案。" : "顯示商家跨專案彙總；此範圍不可當成普通專案編輯。",
    primaryAction: dashboardPrimaryAction(mode),
  };
}

export default async function DashboardPage({ searchParams }: {
  searchParams?: Promise<{
    e2eDashboardDetailsDelayMs?: string | string[];
    e2eDashboardFailScope?: string | string[];
  }>;
}) {
  await applyE2eLoadingDelay();
  const { auth, vendor } = await requireVendorContext();
  if (auth.member?.role === "support") {
    redirect("/support-cases");
  }

  const memberRole = auth.member?.role ?? null;
  const enabledModules = normalizeVendorFeatureModules(vendor.enabledFeatureModules);
  const liveEnabled = hasVendorFeature(enabledModules, "live_webinar");
  const advancedAnalyticsEnabled = hasVendorFeature(enabledModules, "analytics_advanced");
  const query = await searchParams;
  const diagnosticDelayMs = parseDashboardDetailsDiagnosticDelay(
    Array.isArray(query?.e2eDashboardDetailsDelayMs) ? query.e2eDashboardDetailsDelayMs[0] : query?.e2eDashboardDetailsDelayMs,
  );
  const diagnosticFailureScope = parseDashboardDiagnosticFailureScope(
    Array.isArray(query?.e2eDashboardFailScope) ? query.e2eDashboardFailScope[0] : query?.e2eDashboardFailScope,
  );
  const isManager = memberRole === "owner" || memberRole === "admin" || memberRole === "manager";
  const supportEmailConfigured = Boolean(vendor.supportEmail?.trim());
  const trackingConfigured = Boolean(
    vendor.tracking?.googleTagManagerId
    || vendor.tracking?.facebookPixelId
    || vendor.tracking?.tiktokPixelId,
  );
  const [preference, scope] = await Promise.all([
    loadDashboardPersonalization(auth.user?.id, vendor.id),
    getSalesProjectScope(auth.user.id, vendor.id),
  ]);
  const presentation = dashboardPresentation(preference, vendor.name);

  return (
    <>
      <PageHeader
        title={presentation.title}
        description={`目前資料範圍：${presentation.scopeLabel}。${presentation.scopeHint}`}
        action={isManager && (liveEnabled || presentation.mode === "consulting") ? <ButtonLink href={presentation.primaryAction.href} tone="cta"><Plus size={16} />{presentation.primaryAction.label}</ButtonLink> : undefined}
      />

      {advancedAnalyticsEnabled ? <section data-dashboard-region="kpis" aria-label="Dashboard KPI 區域">
        <Suspense fallback={<DashboardKpisLoading />}>
          <DashboardKpis vendorId={vendor.id} projectId={scope.projectId} diagnosticFailureScope={diagnosticFailureScope} />
        </Suspense>
      </section> : null}

      <section data-dashboard-region="details" aria-label="Dashboard 明細區域">
        <Suspense fallback={<DashboardDetailsLoading />}>
          <DashboardDetails
            vendorId={vendor.id}
            projectId={scope.projectId}
            memberRole={memberRole}
            supportEmailConfigured={supportEmailConfigured}
            trackingConfigured={trackingConfigured}
            diagnosticDelayMs={diagnosticDelayMs}
            enabledModules={enabledModules}
          />
        </Suspense>
      </section>
    </>
  );
}
