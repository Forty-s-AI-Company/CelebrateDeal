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

function parseDashboardDetailsDiagnosticDelay(value: string | undefined) {
  if (process.env.NODE_ENV === "production" && process.env.E2E_TEST_MODE !== "true") return 0;
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isSafeInteger(parsed) && parsed > 0 ? Math.min(parsed, 10_000) : 0;
}

function parseDashboardDiagnosticFailureScope(value: string | undefined) {
  if (process.env.NODE_ENV === "production" && process.env.E2E_TEST_MODE !== "true") return null;
  return value === "analytics" ? value : null;
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

  return (
    <>
      <PageHeader
        title="Dashboard"
        description="Cloudflare-first 直播導購營運總覽：觀看、名單、商品點擊、聯盟來源與用量配額。"
        action={isManager ? <ButtonLink href="/lives/new" tone="cta"><Plus size={16} />建立直播</ButtonLink> : undefined}
      />

      <section data-dashboard-region="kpis" aria-label="Dashboard KPI 區域">
        <Suspense fallback={<DashboardKpisLoading />}>
          <DashboardKpis vendorId={vendor.id} diagnosticFailureScope={diagnosticFailureScope} />
        </Suspense>
      </section>

      <section data-dashboard-region="details" aria-label="Dashboard 明細區域">
        <Suspense fallback={<DashboardDetailsLoading />}>
          <DashboardDetails
            vendorId={vendor.id}
          memberRole={memberRole}
          supportEmailConfigured={supportEmailConfigured}
          trackingConfigured={trackingConfigured}
          diagnosticDelayMs={diagnosticDelayMs}
        />
        </Suspense>
      </section>
    </>
  );
}
