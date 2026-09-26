import { dashboardChecklistForRole, isDashboardManagerRole } from "@/lib/dashboard-checklist";
import { getDb } from "@/lib/db";
import {
  createDashboardMeasurement,
  readDashboardLiveSubmissionCounts,
  type DashboardMeasurementSnapshot,
} from "@/lib/dashboard-read-model";
import { merchantOnboardingProgress } from "@/lib/merchant-onboarding";
import { REGISTRATION_CONFIRMATION_EMAIL_TEMPLATE_WHERE } from "@/lib/message-template";
import { countSellableLiveReadinessCandidates, sellableLiveReadinessQuery } from "@/lib/sellable-live";

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
    const [liveCount, productCount, recentLives, upcomingLives] = await Promise.all([
      measurement.measure("live.count", () => db.live.count({ where: { vendorId } })),
      measurement.measure("product.count", () => db.product.count({ where: { vendorId, isActive: true, fulfillmentTypeConfirmed: true } })),
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
    const [recentLiveSubmissionCounts, affiliates, usageLimit, scripts] = await Promise.all([
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
      measurement.measure("published-script.count", () => db.interactionScript.count({ where: { vendorId, status: "published" } })),
    ]);
    const [roles, verifiedPaymentMethodCount, formCount, registrationEmailTemplateCount] = await Promise.all([
      measurement.measure("active-role.count", () => db.interactionRole.count({ where: { vendorId, isActive: true } })),
      measurement.measure("verified-payment-method.count", () => db.paymentMethodReference.count({
        where: {
          vendorId,
          scopeType: "VENDOR",
          membershipId: null,
          status: "verified",
          OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
        },
      })),
      measurement.measure("active-form.count", () => db.registrationForm.count({ where: { vendorId, isActive: true } })),
      measurement.measure("registration-template.count", () => db.messageTemplate.count({ where: { vendorId, ...REGISTRATION_CONFIRMATION_EMAIL_TEMPLATE_WHERE } })),
    ]);
    const sellableLiveCandidates = await measurement.measure("sellable-live.select", () => db.live.findMany(sellableLiveReadinessQuery(vendorId)));
    const sellableLiveCount = countSellableLiveReadinessCandidates(sellableLiveCandidates);
    const isManager = isDashboardManagerRole(memberRole);
    const onboarding = merchantOnboardingProgress({
      supportEmailConfigured,
      verifiedVendorPaymentMethodCount: verifiedPaymentMethodCount,
      sellableProductCount: productCount,
      activeFormCount: formCount,
      activeInteractionRoleCount: roles,
      publishedInteractionScriptCount: scripts,
      registrationEmailTemplateCount,
      sellableLiveCount,
      trackingConfigured,
    });
    const checklist = dashboardChecklistForRole({
      productCount,
      liveCount,
      interactionRoleCount: roles,
      interactionScriptCount: scripts,
      trackingConfigured,
      verifiedPaymentMethodCount,
      onboardingComplete: onboarding.complete,
    }, memberRole);
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
