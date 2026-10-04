import { AppShell } from "@/components/app-shell";
import { requireVendorContext } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { normalizeVendorFeatureModules } from "@/lib/vendor-feature-toggles";
import { persistTaskPanelCollapsedAction, selectSalesProjectAction } from "@/app/actions/sales-workspace-actions";
import { evaluateProjectOnboarding, evaluateWorkspaceOnboarding } from "@/lib/sales-workspace";

export default async function ProtectedLayout({ children }: { children: React.ReactNode }) {
  const { auth, vendor } = await requireVendorContext();
  // Only managers may receive project names and onboarding state in client props.
  const isManager = auth.member?.role === "owner" || auth.member?.role === "admin";
  if (!isManager) {
    return <AppShell vendorName={vendor.name} memberRole={auth.member?.role ?? null} enabledModules={normalizeVendorFeatureModules(vendor.enabledFeatureModules)} planLabel="工作區">{children}</AppShell>;
  }

  const activeSubscription = await getDb().vendorSubscription.findFirst({
    where: { vendorId: vendor.id, status: "active" },
    select: { plan: { select: { name: true } } },
  });
  const db = getDb();
  const [projects, preference] = await Promise.all([
    db.salesProject.findMany({ where: { vendorId: vendor.id, status: { not: "archived" } }, orderBy: { updatedAt: "desc" }, select: { id: true, name: true, status: true, primaryFlow: true, publishedAt: true } }),
    db.userOnboardingPreference.findUnique({ where: { userId_vendorId: { userId: auth.user.id, vendorId: vendor.id } } }),
  ]);
  const selectedProject = projects.find((project) => project.id === preference?.selectedProjectId) ?? null;
  const scopeKey = selectedProject?.id ?? "workspace";
  const states = await db.onboardingTaskState.findMany({ where: { vendorId: vendor.id, scopeKey }, select: { taskKey: true, status: true, skipImpact: true, archivedAt: true } });
  let taskProgress;
  if (selectedProject) {
    const [productLinks, pricedProducts, forms, lives, consultations, paymentMethods] = await Promise.all([
      db.salesProjectProduct.count({ where: { vendorId: vendor.id, projectId: selectedProject.id } }),
      db.salesProjectProduct.count({ where: { vendorId: vendor.id, projectId: selectedProject.id, product: { isActive: true, priceCents: { gt: 0 } } } }),
      // Match the canonical project publication gate: current forms have no templateId.
      db.registrationForm.count({ where: { vendorId: vendor.id, projectId: selectedProject.id, isActive: true } }),
      db.live.count({ where: { vendorId: vendor.id, projectId: selectedProject.id } }),
      db.consultationEvent.findMany({ where: { vendorId: vendor.id, projectId: selectedProject.id, isActive: true }, select: { weeklySchedule: true } }),
      db.paymentMethodReference.count({ where: { vendorId: vendor.id, scopeType: "VENDOR", membershipId: null, status: "verified", verifiedAt: { not: null, lte: new Date() }, OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }] } }),
    ]);
    const hasAvailability = consultations.some(({ weeklySchedule }) => Array.isArray(weeklySchedule) && weeklySchedule.some((entry) => {
      if (!entry || typeof entry !== "object") return false;
      const ranges = (entry as { ranges?: unknown }).ranges;
      return Array.isArray(ranges) && ranges.some((range) => typeof range === "string" && range.length > 0);
    }));
    taskProgress = evaluateProjectOnboarding(selectedProject.primaryFlow, { exists: true, hasLinkedProduct: productLinks > 0, hasPricedProduct: pricedProducts > 0, hasFunnelTemplate: forms > 0, hasLiveSession: lives > 0, hasConsultationService: consultations.length > 0, hasAvailability, hasPaymentMethod: paymentMethods > 0, hasPreviewableFlow: productLinks > 0 && (forms > 0 || lives > 0 || consultations.length > 0), isPublished: Boolean(selectedProject.publishedAt) }, states);
  } else {
    const [payments, members, testOrders] = await Promise.all([
      db.paymentMethodReference.count({ where: { vendorId: vendor.id, scopeType: "VENDOR", membershipId: null, status: "verified", verifiedAt: { not: null, lte: new Date() }, OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }] } }),
      db.vendorMember.count({ where: { vendorId: vendor.id, status: "active" } }),
      db.commerceOrder.count({ where: { vendorId: vendor.id, isTestOrder: true, status: "paid" } }),
    ]);
    taskProgress = evaluateWorkspaceOnboarding({ hasBasicProfile: Boolean(vendor.name.trim() && vendor.email.trim()), hasLogo: Boolean(vendor.logoUrl), hasPaymentMethod: payments > 0, hasSupportContact: Boolean(vendor.supportEmail?.trim()), hasInvitedTeamMember: members > 1, hasTestOrder: testOrders > 0 }, states);
  }
  const guideHidden = Boolean(preference?.guideDismissedAt || (preference?.taskPanelHiddenUntil && preference.taskPanelHiddenUntil > new Date()));
  const projectQuery = selectedProject ? `?projectId=${encodeURIComponent(selectedProject.id)}` : "";
  const onboardingTasks = guideHidden ? [] : taskProgress.tasks.map((task) => ({ key: task.key, title: task.title, status: task.status, estimateMinutes: task.estimatedMinutes, impact: task.impact, href: task.key === "project_publish" && selectedProject ? `/projects/${encodeURIComponent(selectedProject.id)}` : task.key.includes("payment") ? "/billing/payment-methods" : task.key.includes("logo") || task.key.includes("profile") || task.key.includes("support") ? "/settings/brand" : task.key.includes("team") ? "/settings/team" : task.key.includes("product") || task.key.includes("price") ? `/products/new${projectQuery}` : task.key.includes("funnel") ? `/forms/new${projectQuery}` : task.key.includes("live") ? `/lives/new${projectQuery}` : task.key.includes("consultation") || task.key.includes("availability") ? "/consultations" : "/onboarding" }));
  return <AppShell vendorName={vendor.name} memberRole={auth.member?.role ?? null} enabledModules={normalizeVendorFeatureModules(vendor.enabledFeatureModules)} planLabel={activeSubscription?.plan.name ?? "Free"} projects={projects} selectedProjectId={selectedProject?.id ?? null} onboardingTasks={onboardingTasks} taskPanelCollapsed={preference?.taskPanelCollapsed ?? false} selectProject={selectSalesProjectAction} persistTaskPanelCollapsed={persistTaskPanelCollapsedAction}>{children}</AppShell>;
}
