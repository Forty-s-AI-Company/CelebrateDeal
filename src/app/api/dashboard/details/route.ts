import { requireVendorContext } from "@/lib/auth";
import { loadDashboardDetails } from "@/app/(app)/dashboard/dashboard-details";
import { parseDashboardDetailsDiagnosticDelay } from "@/app/(app)/dashboard/dashboard-details-diagnostic";
import { trackingConfiguredFor } from "@/lib/merchant-onboarding-data";

const headers = { "Cache-Control": "private, no-store" };

/** Read-only tenant-scoped details no longer hold the Dashboard HTML stream open. */
export async function GET(request: Request) {
  const { auth, vendor } = await requireVendorContext();
  if (auth.member?.role === "support") {
    return Response.json({ error: "UNAVAILABLE" }, { status: 403, headers });
  }
  const memberRole = auth.member?.role ?? null;
  const trackingConfigured = trackingConfiguredFor(vendor.tracking);
  const diagnosticDelayMs = parseDashboardDetailsDiagnosticDelay(
    new URL(request.url).searchParams.get("e2eDashboardDetailsDelayMs") ?? undefined,
  );
  const result = await loadDashboardDetails({
    vendorId: vendor.id,
    userId: auth.user.id,
    memberRole,
    supportEmailConfigured: Boolean(vendor.supportEmail?.trim()),
    trackingConfigured,
    diagnosticDelayMs,
  });
  return Response.json(result, { headers });
}
