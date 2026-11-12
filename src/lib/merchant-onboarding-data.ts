import type { getDb } from "@/lib/db";
import { liveReadyVideoWhere } from "@/lib/live-video-readiness";
import {
  buildOnboardingChecklist,
  merchantOnboardingProgress,
  type OnboardingChecklist,
} from "@/lib/merchant-onboarding";
import {
  hasUsableMessageTemplateContent,
  REGISTRATION_CONFIRMATION_EMAIL_TEMPLATE_WHERE,
} from "@/lib/message-template";
import { verifiedVendorPaymentMethodWhere } from "@/lib/payment-method-reference";
import { parseRegistrationFormFields } from "@/lib/registration-form-fields";
import { evaluateProjectOnboarding, type SalesProjectFlow } from "@/lib/sales-workspace";
import { countSellableLiveReadinessCandidates, sellableLiveReadinessQuery } from "@/lib/sellable-live";

type Db = ReturnType<typeof getDb>;

export type OnboardingSelectedProject = { id: string; name: string; primaryFlow: SalesProjectFlow; publishedAt: Date | null };

export type OnboardingChecklistInput = {
  vendorId: string;
  supportEmailConfigured: boolean;
  trackingConfigured: boolean;
  /** While funnel_binding is closed there is no card to bind; the payment step counts as satisfied (F-002). */
  cardBindingRequired: boolean;
  /** Must already be bound to `vendorId` (see `findSelectedOnboardingProject`). */
  selectedProject: OnboardingSelectedProject | null;
  now?: Date;
};

export function trackingConfiguredFor(tracking: { googleTagManagerId?: string | null; facebookPixelId?: string | null; tiktokPixelId?: string | null } | null | undefined) {
  return Boolean(tracking?.googleTagManagerId || tracking?.facebookPixelId || tracking?.tiktokPixelId);
}

function verifiedPaymentMethodCount(db: Db, vendorId: string, cardBindingRequired: boolean, now: Date) {
  return cardBindingRequired ? db.paymentMethodReference.count({ where: verifiedVendorPaymentMethodWhere(vendorId, now) }) : Promise.resolve(1);
}

/** The member's selected project, only when it belongs to this vendor and is not archived. */
export async function findSelectedOnboardingProject(db: Db, vendorId: string, userId: string): Promise<OnboardingSelectedProject | null> {
  const preference = await db.userOnboardingPreference.findUnique({ where: { userId_vendorId: { userId, vendorId } }, select: { selectedProjectId: true } });
  if (!preference?.selectedProjectId) return null;
  return db.salesProject.findFirst({
    where: { id: preference.selectedProjectId, vendorId, status: { not: "archived" } },
    select: { id: true, name: true, primaryFlow: true, publishedAt: true },
  });
}

async function loadMerchantProgress(db: Db, input: OnboardingChecklistInput, paymentMethodCount: Promise<number>) {
  const { vendorId } = input;
  const [
    verifiedVendorPaymentMethodCount,
    sellableProductCount,
    activeFormCandidates,
    activeInteractionRoleCount,
    publishedInteractionScriptCount,
    registrationEmailTemplateCandidates,
    readyVideoCount,
    sellableLiveCandidates,
  ] = await Promise.all([
    paymentMethodCount,
    db.product.count({ where: { vendorId, isActive: true, fulfillmentTypeConfirmed: true } }),
    db.registrationForm.findMany({ where: { vendorId, isActive: true }, select: { fields: true } }),
    db.interactionRole.count({ where: { vendorId, isActive: true } }),
    db.interactionScript.count({ where: { vendorId, status: "published" } }),
    db.messageTemplate.findMany({ where: { vendorId, ...REGISTRATION_CONFIRMATION_EMAIL_TEMPLATE_WHERE }, select: { subject: true, body: true } }),
    db.video.count({ where: liveReadyVideoWhere(vendorId) }),
    db.live.findMany(sellableLiveReadinessQuery(vendorId)),
  ]);
  return merchantOnboardingProgress({
    supportEmailConfigured: input.supportEmailConfigured,
    verifiedVendorPaymentMethodCount,
    sellableProductCount,
    // Malformed forms and empty templates cannot carry a registration, so they do not count.
    activeFormCount: activeFormCandidates.filter((form) => parseRegistrationFormFields(form.fields).success).length,
    activeInteractionRoleCount,
    publishedInteractionScriptCount,
    registrationEmailTemplateCount: registrationEmailTemplateCandidates.filter(hasUsableMessageTemplateContent).length,
    sellableLiveCount: countSellableLiveReadinessCandidates(sellableLiveCandidates),
    readyVideoCount,
    trackingConfigured: input.trackingConfigured,
  });
}

/** Mirrors the inputs of `publishSalesProjectAction`; every query is bound to the vendor and project. */
async function loadProjectProgress(db: Db, vendorId: string, project: OnboardingSelectedProject, paymentMethodCount: Promise<number>) {
  const [states, productLinks, pricedProducts, forms, lives, consultations, paymentMethods] = await Promise.all([
    db.onboardingTaskState.findMany({ where: { vendorId, scopeKey: project.id }, select: { taskKey: true, status: true, skipImpact: true, archivedAt: true } }),
    db.salesProjectProduct.count({ where: { vendorId, projectId: project.id } }),
    db.salesProjectProduct.count({ where: { vendorId, projectId: project.id, product: { isActive: true, priceCents: { gt: 0 } } } }),
    // Match the canonical project publication gate: an active registration form in the project.
    db.registrationForm.count({ where: { vendorId, projectId: project.id, isActive: true } }),
    db.live.count({ where: { vendorId, projectId: project.id } }),
    db.consultationEvent.findMany({ where: { vendorId, projectId: project.id, isActive: true }, select: { weeklySchedule: true } }),
    paymentMethodCount,
  ]);
  const hasAvailability = consultations.some(({ weeklySchedule }) => Array.isArray(weeklySchedule) && weeklySchedule.some((entry) => {
    if (!entry || typeof entry !== "object") return false;
    const ranges = (entry as { ranges?: unknown }).ranges;
    return Array.isArray(ranges) && ranges.some((range) => typeof range === "string" && range.length > 0);
  }));
  return evaluateProjectOnboarding(project.primaryFlow, {
    exists: true,
    hasLinkedProduct: productLinks > 0,
    hasPricedProduct: pricedProducts > 0,
    hasFunnelTemplate: forms > 0,
    hasLiveSession: lives > 0,
    hasConsultationService: consultations.length > 0,
    hasAvailability,
    hasPaymentMethod: paymentMethods > 0,
    hasPreviewableFlow: productLinks > 0 && (forms > 0 || lives > 0 || consultations.length > 0),
    isPublished: Boolean(project.publishedAt),
  }, states);
}

/** The only place onboarding status is read from the database. */
export async function loadOnboardingChecklist(db: Db, input: OnboardingChecklistInput): Promise<OnboardingChecklist> {
  const now = input.now ?? new Date();
  const project = input.selectedProject;
  // One payment read feeds both the merchant step and the project gate, so they always agree.
  const paymentMethodCount = verifiedPaymentMethodCount(db, input.vendorId, input.cardBindingRequired, now);
  const [merchant, projectProgress] = await Promise.all([
    loadMerchantProgress(db, input, paymentMethodCount),
    project ? loadProjectProgress(db, input.vendorId, project, paymentMethodCount) : Promise.resolve(null),
  ]);
  return buildOnboardingChecklist(merchant, project && projectProgress ? {
    id: project.id,
    name: project.name,
    primaryFlow: project.primaryFlow,
    progress: projectProgress,
    cardBindingRequired: input.cardBindingRequired,
  } : null);
}
