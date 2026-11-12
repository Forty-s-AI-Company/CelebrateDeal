import { dashboardChecklistForRole, isDashboardManagerRole } from "@/lib/dashboard-checklist";
import { getDb } from "@/lib/db";
import {
  createDashboardMeasurement,
  readDashboardLiveSubmissionCounts,
  type DashboardMeasurementSnapshot,
} from "@/lib/dashboard-read-model";
import { findSelectedOnboardingProject, loadOnboardingChecklist } from "@/lib/merchant-onboarding-data";
import { isCardBindingRequiredForVendor } from "@/lib/feature-gates";

function getDateDaysAgo(days: number) {
  return new Date(Date.now() - 1000 * 60 * 60 * 24 * days);
}

async function applyDashboardDetailsDiagnosticDelay(delayMs: number) {
  // This hook is only for a local performance probe. Production ignores the
  // query so it cannot become an accidental customer-facing delay. The local
  // Playwright server is production-built but explicitly carries E2E_TEST_MODE.
  if (process.env.E2E_TEST_MODE !== "true" || delayMs <= 0) return;
  await new Promise<void>((resolve) => setTimeout(resolve, Math.min(delayMs, 10_000)));
}

export type DashboardDetailsProps = {
  vendorId: string;
  /** Selects the member's current project for the onboarding summary. */
  userId: string;
  memberRole: string | null;
  supportEmailConfigured: boolean;
  trackingConfigured: boolean;
  diagnosticDelayMs?: number;
};

export type DashboardDetailsData = {
  now: Date;
  recentLives: Array<{ id: string; title: string; status: string; scheduledAt: Date }>;
  recentLiveSubmissionCounts: Record<string, { verified: number; pending: number }>;
  upcomingLives: Array<{ id: string; title: string; scheduledAt: Date }>;
  affiliates: Array<{ code: string; name: string; _count: { clicks: number } }>;
  usageLimit: { creditsUsed: number; creditsLimit: number; billingPlan: { name: string } | null } | null;
  checklist: ReturnType<typeof dashboardChecklistForRole>;
  isManager: boolean;
};

export type DashboardDetailsLoadResult = {
  data: DashboardDetailsData | null;
  measurement: DashboardMeasurementSnapshot;
};

export async function loadDashboardDetails({
  vendorId,
  userId,
  memberRole,
  supportEmailConfigured,
  trackingConfigured,
  diagnosticDelayMs,
}: DashboardDetailsProps): Promise<DashboardDetailsLoadResult> {
  const db = getDb();
  const measurement = createDashboardMeasurement();
  const now = getDateDaysAgo(0);

  try {
    await applyDashboardDetailsDiagnosticDelay(diagnosticDelayMs ?? 0);
    // Bound concurrent database reads to avoid serial round trips delaying the
    // final HTML chunk while keeping connection pressure predictable.
    const [recentLives, upcomingLives] = await Promise.all([
      measurement.measure("recent-live.select", () => db.live.findMany({
        where: { vendorId },
        orderBy: { scheduledAt: "desc" },
        take: 5,
        select: { id: true, title: true, status: true, scheduledAt: true },
      })),
      measurement.measure("upcoming-live.select", () => db.live.findMany({
        where: { vendorId, scheduledAt: { gte: now } },
        orderBy: { scheduledAt: "asc" },
        take: 3,
        select: { id: true, title: true, scheduledAt: true },
      })),
    ]);
    const isManager = isDashboardManagerRole(memberRole);
    const [recentLiveSubmissionCounts, affiliates, usageLimit, onboarding] = await Promise.all([
      measurement.measure(
        "recent-live-submission.grouped-count",
        () => readDashboardLiveSubmissionCounts(db, vendorId, recentLives.map((live) => live.id)),
      ),
      measurement.measure("affiliate.count-select", () => db.affiliate.findMany({
        where: { vendorId },
        select: { code: true, name: true, _count: { select: { clicks: true } } },
        take: 5,
      })),
      measurement.measure("usage.select", () => db.vendorUsageLimit.findUnique({
        where: { vendorId },
        select: { creditsUsed: true, creditsLimit: true, billingPlan: { select: { name: true } } },
      })),
      // The same loader as /onboarding and the sidebar panel; only managers see setup steps.
      isManager ? measurement.measure("onboarding-checklist.load", async () => loadOnboardingChecklist(db, {
        vendorId,
        supportEmailConfigured,
        trackingConfigured,
        // While funnel_binding is closed no card can be bound, so the step counts as satisfied (F-002).
        cardBindingRequired: await isCardBindingRequiredForVendor(db, vendorId),
        selectedProject: await findSelectedOnboardingProject(db, vendorId, userId),
        now,
      })) : Promise.resolve(null),
    ]);
    const checklist = dashboardChecklistForRole(onboarding, memberRole);
    return {
      measurement: measurement.snapshot(),
      data: {
        now,
        recentLives,
        recentLiveSubmissionCounts,
        upcomingLives,
        affiliates,
        usageLimit,
        checklist,
        isManager,
      },
    };
  } catch {
    return { data: null, measurement: measurement.snapshot() };
  }
}
