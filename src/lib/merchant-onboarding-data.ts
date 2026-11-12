import { cache } from "react";
import type { Prisma } from "@prisma/client";
import { getDb } from "@/lib/db";
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
  /** While funnel_binding is closed there is no card to bind; the payment step does not apply (F-002). */
  cardBindingRequired: boolean;
  /** Must already be bound to `vendorId` (see `findSelectedOnboardingProject`). */
  selectedProject: OnboardingSelectedProject | null;
  now?: Date;
};

/**
 * Rows read per batch while looking for the first usable form, Email template
 * or sellable live. Only "is there one?" matters, so a merchant with many rows
 * stops at the first match, and invalid rows at the front never hide a valid
 * one further back.
 */
export const ONBOARDING_READINESS_BATCH_SIZE = 50;

export function trackingConfiguredFor(tracking: { googleTagManagerId?: string | null; facebookPixelId?: string | null; tiktokPixelId?: string | null } | null | undefined) {
  return Boolean(tracking?.googleTagManagerId || tracking?.facebookPixelId || tracking?.tiktokPixelId);
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

/** Reads `id`-ordered batches until `accept` finds a usable row or the rows run out. */
async function hasUsableRow<T extends { id: string }>(readBatch: (afterId: string | null) => Promise<T[]>, accept: (rows: T[]) => boolean) {
  let afterId: string | null = null;
  for (;;) {
    const rows = await readBatch(afterId);
    if (accept(rows)) return true;
    if (rows.length < ONBOARDING_READINESS_BATCH_SIZE) return false;
    afterId = rows.at(-1)!.id;
  }
}

function afterIdWhere(afterId: string | null) {
  return afterId ? { id: { gt: afterId } } : {};
}

function hasUsableRegistrationForm(db: Db, vendorId: string) {
  return hasUsableRow(
    (afterId) => db.registrationForm.findMany({
      where: { vendorId, isActive: true, ...afterIdWhere(afterId) },
      select: { id: true, fields: true },
      orderBy: { id: "asc" },
      take: ONBOARDING_READINESS_BATCH_SIZE,
    }),
    // Malformed forms cannot carry a registration, so they do not count.
    (rows) => rows.some((form) => parseRegistrationFormFields(form.fields).success),
  );
}

function hasUsableRegistrationEmail(db: Db, vendorId: string) {
  return hasUsableRow(
    (afterId) => db.messageTemplate.findMany({
      where: { vendorId, ...REGISTRATION_CONFIRMATION_EMAIL_TEMPLATE_WHERE, ...afterIdWhere(afterId) },
      select: { id: true, subject: true, body: true },
      orderBy: { id: "asc" },
      take: ONBOARDING_READINESS_BATCH_SIZE,
    }),
    (rows) => rows.some(hasUsableMessageTemplateContent),
  );
}

function hasSellableLive(db: Db, vendorId: string) {
  const query = sellableLiveReadinessQuery(vendorId);
  return hasUsableRow(
    (afterId) => db.live.findMany({
      where: { ...query.where, ...afterIdWhere(afterId) } satisfies Prisma.LiveWhereInput,
      select: { ...query.select, id: true },
      orderBy: { id: "asc" },
      take: ONBOARDING_READINESS_BATCH_SIZE,
    }),
    (rows) => countSellableLiveReadinessCandidates(rows) > 0,
  );
}

async function loadMerchantProgress(db: Db, input: OnboardingChecklistInput, paymentMethodCount: Promise<number>) {
  const { vendorId } = input;
  const [
    verifiedVendorPaymentMethodCount,
    sellableProductCount,
    usableForm,
    activeInteractionRoleCount,
    publishedInteractionScriptCount,
    usableRegistrationEmail,
    readyVideoCount,
    sellableLive,
  ] = await Promise.all([
    paymentMethodCount,
    db.product.count({ where: { vendorId, isActive: true, fulfillmentTypeConfirmed: true } }),
    hasUsableRegistrationForm(db, vendorId),
    db.interactionRole.count({ where: { vendorId, isActive: true } }),
    db.interactionScript.count({ where: { vendorId, status: "published" } }),
    hasUsableRegistrationEmail(db, vendorId),
    db.video.count({ where: liveReadyVideoWhere(vendorId) }),
    hasSellableLive(db, vendorId),
  ]);
  return merchantOnboardingProgress({
    supportEmailConfigured: input.supportEmailConfigured,
    verifiedVendorPaymentMethodCount,
    platformPaymentRequired: input.cardBindingRequired,
    sellableProductCount,
    // The steps only ask whether one usable row exists.
    activeFormCount: usableForm ? 1 : 0,
    activeInteractionRoleCount,
    publishedInteractionScriptCount,
    registrationEmailTemplateCount: usableRegistrationEmail ? 1 : 0,
    sellableLiveCount: sellableLive ? 1 : 0,
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
  // While funnel_binding is closed the publish gate treats payment as satisfied, like publishSalesProjectAction.
  const paymentMethodCount = input.cardBindingRequired
    ? db.paymentMethodReference.count({ where: verifiedVendorPaymentMethodWhere(input.vendorId, now) })
    : Promise.resolve(1);
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

/**
 * Request-scoped entry for Server Components: the app layout (sidebar panel)
 * and /onboarding render in the same request and share one load. Arguments are
 * primitives so React `cache()` can match them; the selected project is
 * re-resolved here and bound to `vendorId`.
 */
export const getOnboardingChecklist = cache(async (
  vendorId: string,
  userId: string,
  supportEmailConfigured: boolean,
  trackingConfigured: boolean,
  cardBindingRequired: boolean,
) => {
  const db = getDb();
  return loadOnboardingChecklist(db, {
    vendorId,
    supportEmailConfigured,
    trackingConfigured,
    cardBindingRequired,
    selectedProject: await findSelectedOnboardingProject(db, vendorId, userId),
  });
});
