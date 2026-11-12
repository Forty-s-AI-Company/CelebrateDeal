import { AppShell } from "@/components/app-shell";
import { EmailVerificationBanner } from "@/components/email-verification-banner";
import { requireVendorContext } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { maskEmailRecipient } from "@/lib/email-delivery-pii";
import { vendorEmailVerificationState } from "@/lib/merchant-email-verification";
import { enabledFeaturesForVendor } from "@/lib/vendor-feature-toggles";
import { isCardBindingRequired } from "@/lib/feature-gates";
import { persistTaskPanelCollapsedAction, selectSalesProjectAction } from "@/app/actions/sales-workspace-actions";
import { onboardingChecklistItems } from "@/lib/merchant-onboarding";
import { getOnboardingChecklist, trackingConfiguredFor } from "@/lib/merchant-onboarding-data";
import { captureOperationalError } from "@/lib/monitoring";
import { hasActiveAffiliatePortalAccess } from "@/lib/affiliate-portal";

/**
 * Owners only: the banner is about the owner's own account and the vendor's
 * publish gate, which other roles can neither fix nor act on.
 *
 * Mirrors the independent-publish gate (`vendorEmailVerificationState`):
 * nothing while the vendor counts as verified. Otherwise the account whose
 * verification counts (the founder, or any unverified viewer when there is no
 * founder) gets the resend flow; everyone else learns who has to verify,
 * masked. Legacy and new accounts alike keep full access.
 */
async function withEmailVerificationBanner(user: { id: string; emailVerifiedAt: Date | null }, vendorId: string, children: React.ReactNode) {
  const state = await vendorEmailVerificationState(getDb(), vendorId);
  if (state.verified) return children;
  const canVerify = state.founder ? state.founder.userId === user.id : !user.emailVerifiedAt;
  const banner = canVerify
    ? <EmailVerificationBanner mode="self" />
    : <EmailVerificationBanner mode="other" maskedFounderEmail={state.founder ? maskEmailRecipient(state.founder.email) : null} />;
  return <>{banner}{children}</>;
}

/** Per-member shell state: the owner-only banner and this member's own portal grant in this vendor. */
async function memberShellState(
  auth: { user: { id: string; emailVerifiedAt: Date | null }; member: { id: string; role: string } | null },
  vendorId: string,
  children: React.ReactNode,
) {
  if (!auth.member) return { content: children, hasPartnerPortal: false };
  const content = auth.member.role === "owner" ? await withEmailVerificationBanner(auth.user, vendorId, children) : children;
  const hasPartnerPortal = await hasActiveAffiliatePortalAccess(getDb(), { vendorId, vendorMemberId: auth.member.id, userId: auth.user.id });
  return { content, hasPartnerPortal };
}

/**
 * The panel is a compact view of /onboarding: the same request-cached loader,
 * the same steps. A failed read hides the panel instead of failing every
 * back-office page; the error is reported without tenant data.
 */
async function sidebarOnboardingTasks(vendor: Awaited<ReturnType<typeof requireVendorContext>>["vendor"], userId: string) {
  try {
    return onboardingChecklistItems(await getOnboardingChecklist(
      vendor.id,
      userId,
      Boolean(vendor.supportEmail?.trim()),
      trackingConfiguredFor(vendor.tracking),
      isCardBindingRequired(vendor),
    ));
  } catch (error) {
    captureOperationalError(error, { source: "app-layout", operation: "onboarding-checklist" }, { level: "warning" });
    return [];
  }
}

export default async function ProtectedLayout({ children }: { children: React.ReactNode }) {
  const { auth, vendor } = await requireVendorContext();
  const { content, hasPartnerPortal } = await memberShellState(auth, vendor.id, children);
  // Only managers may receive project names and onboarding state in client props.
  const isManager = auth.member?.role === "owner" || auth.member?.role === "admin";
  if (!isManager) {
    return <AppShell vendorName={vendor.name} memberRole={auth.member?.role ?? null} enabledModules={enabledFeaturesForVendor(vendor)} planLabel="工作區" hasPartnerPortal={hasPartnerPortal}>{content}</AppShell>;
  }

  const db = getDb();
  const [activeSubscription, projects, preference] = await Promise.all([
    db.vendorSubscription.findFirst({ where: { vendorId: vendor.id, status: "active" }, select: { plan: { select: { name: true } } } }),
    db.salesProject.findMany({ where: { vendorId: vendor.id, status: { not: "archived" } }, orderBy: { updatedAt: "desc" }, select: { id: true, name: true, status: true, primaryFlow: true, publishedAt: true } }),
    db.userOnboardingPreference.findUnique({ where: { userId_vendorId: { userId: auth.user.id, vendorId: vendor.id } } }),
  ]);
  const selectedProject = projects.find((project) => project.id === preference?.selectedProjectId) ?? null;
  const guideHidden = Boolean(preference?.guideDismissedAt || (preference?.taskPanelHiddenUntil && preference.taskPanelHiddenUntil > new Date()));
  const onboardingTasks = guideHidden ? [] : await sidebarOnboardingTasks(vendor, auth.user.id);
  return <AppShell vendorName={vendor.name} memberRole={auth.member?.role ?? null} enabledModules={enabledFeaturesForVendor(vendor)} planLabel={activeSubscription?.plan.name ?? "Free"} hasPartnerPortal={hasPartnerPortal} projects={projects} selectedProjectId={selectedProject?.id ?? null} onboardingTasks={onboardingTasks} taskPanelCollapsed={preference?.taskPanelCollapsed ?? true} selectProject={selectSalesProjectAction} persistTaskPanelCollapsed={persistTaskPanelCollapsedAction}>{content}</AppShell>;
}
