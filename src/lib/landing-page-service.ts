import { randomUUID } from "node:crypto";
import { funnelOperationsReferencesValid, parseFunnelOperations } from "@/lib/funnel-operations";
import { Prisma, PrismaClient } from "@prisma/client";
import { requireVendorManagerContext } from "@/lib/auth";
import { getDb } from "@/lib/db";
import {
  parseLandingPageContent,
  type LandingPageFormReference,
  type LandingPageLiveReference,
  type LandingPageRenderContext,
} from "@/lib/landing-page-content";
import { parsePageDocument, type PageDocument } from "@/lib/funnel-page-document";
import { applyFunnelStepPersistenceMutation, parseFunnelStepPages, type FunnelStepPages, type FunnelStepPersistenceMutation } from "@/lib/funnel-step-pages";
import { isLeadCaptureFormNode, pageDocumentRendersRegistrationForm, surveyLeadFormFields } from "@/lib/funnel-registration-surface";
import { getSalesProjectScope, requireEditableSalesProjectScope } from "@/lib/sales-project-scope";

import { hasDirectWebinarVideo } from "@/lib/funnel-webinar-media";
import { isLiveVideoReady, type LiveVideoReadiness } from "@/lib/live-video-readiness";
import { parseRegistrationFormFields, type RegistrationFormFieldSpec } from "@/lib/registration-form-fields";
import { listFunnelCommerceProducts, publicFunnelCommerceViews, validateFunnelCommerceBindings } from "@/lib/funnel-commerce-service";
import {
  invalidWebinarContainer,
  isWebinarContent as webinarContent,
  MAX_LANDING_PAGE_SLUG_LENGTH as MAX_SLUG_LENGTH,
  normalizeLandingPageSlug as pageSlug,
  isReservedLandingPageSlug,
  PUBLIC_LIVE_STATUSES,
  publicLandingPageCandidateWhere,
  isAudienceFunnel,
  isIndependentlyPublishedFunnel,
  isPublishedSalesProject,
  publicLiveBindingValid,
  publicProjectGateSatisfied,
  publishedLandingPageContent,
  registrationFormIdsInContent,
  independentPublishBlockers,
  type IndependentPublishBlocker,
  type LandingPageStoredContent,
  type PublicLandingPageUnavailableReason,
} from "@/lib/public-landing-page-eligibility";
import { getFunnelStepCatalog, stepsAddedOutsideGoal } from "@/lib/funnel-flow";
import { independentPublishAllowance, independentPublishLimitMessage, INDEPENDENT_PUBLISH_DISABLED_MESSAGE, INDEPENDENT_PUBLISH_EMAIL_UNVERIFIED_MESSAGE, lockIndependentPublishSlots } from "@/lib/independent-publish-limit";
import { verifiedVendorPaymentMethodWhere } from "@/lib/payment-method-reference";
import { isCardBindingRequiredForVendor, isVendorFeatureEnabled } from "@/lib/feature-gates";
import { canPublishSalesProject } from "@/lib/sales-workspace";
import { isFunnelDeadlineExpired } from "@/lib/funnel-runtime";
import { publicFunnelRouteOutcome, representativeFunnelVisitorIds } from "@/lib/public-landing-page-status";
import type { FunnelCommerceProduct, FunnelCommerceView } from "@/lib/funnel-commerce";
import { describeFunnelCustomCodeProblem, isFunnelCustomCodeDisabled, withoutFunnelCustomScripts, type FunnelCustomCodeChange } from "@/lib/funnel-custom-code";
import {
  assertFunnelCustomCodeDelete,
  assertFunnelCustomCodePublish,
  assertFunnelCustomCodeWrite,
  FunnelCustomCodeRefusal,
  recordFunnelCustomCodePublish,
  recordFunnelCustomCodeSave,
  type FunnelCustomCodeActor,
} from "@/lib/funnel-custom-code-guard";
export type PublicFunnelWebinarResource = {
  form: { id: string; fields: RegistrationFormFieldSpec[]; submitLabel: string; successMessage: string };
  live: { id: string; slug: string; videoId: string; videoTitle: string };
};
const videoSelect = { id: true, vendorId: true, title: true, sourceType: true, status: true, cloudflareReadyToStream: true, cloudflareLiveInputUid: true, liveInputStatus: true } as const;
function completeWebinarSteps(content: LandingPageStoredContent) {
  const steps = "flow" in content ? content.flow?.steps : undefined;
  return Boolean(steps && ["webinar_registration_page", "webinar_thank_you_page", "webinar_broadcast_page"].every((type) => steps.filter((step) => step.type === type).length === 1));
}
function webinarResource(form: FormRecord | undefined, live: LiveRecord | null, vendorId: string): PublicFunnelWebinarResource | undefined {
  if (live?.status === "ended" && (!live.replayEnabled || (live.replayAvailableUntil && live.replayAvailableUntil.getTime() <= Date.now()))) return undefined;
  const fields = parseRegistrationFormFields(form?.fields);
  if (!form || !fields.success || !live?.videoId || live.video?.id !== live.videoId || live.video.vendorId !== vendorId || !isLiveVideoReady(live.video)) return undefined;
  return { form: { id: form.id, fields: fields.data, submitLabel: form.submitLabel || "送出報名", successMessage: form.successMessage || "已收到報名，請留意確認信。" }, live: { id: live.id, slug: live.slug, videoId: live.videoId, videoTitle: live.video.title } };
}
const MAX_NAME_LENGTH = 160;
const MAX_IDENTIFIER_LENGTH = 100;

export type LandingPageActionState = {
  status: "success" | "error";
  message: string;
  id?: string;
  revision?: number;
  /** After a publish: the form the published version uses (an audience page may get one automatically). */
  formId?: string | null;
  publication?: LandingPagePublicationStatus;
};

/** Merchant-only diagnosis of the public URL; it never changes a public or project publication decision. */
export type LandingPagePublicationStatus = {
  available: boolean;
  message: string;
  projectHref: string;
  missing: Array<{ label: string; href: string }>;
  /** Problems that do not make the public URL 404 (for example a single broken step). */
  warnings?: Array<{ label: string; href: string }>;
};

export type LandingPageDraftInput = {
  id?: string;
  revision?: number;
  name: string;
  slug: string;
  formId?: string | null;
  liveId?: string | null;
  content: unknown;
};

export type LandingPageSummary = {
  id: string;
  name: string;
  slug: string;
  status: "draft" | "published";
  revision: number;
  publishedAt: Date | null;
  updatedAt: Date;
};

export type LandingPageEditorPage = LandingPageSummary & {
  content: LandingPageStoredContent | null;
  formId: string | null;
  liveId: string | null;
  versions: Array<{ id: string; version: number; createdAt: Date }>;
};

export type FunnelWebinarResources = {
  lives: Array<{ id: string; videoId: string | null; videoTitle: string | null; videoReady: boolean }>;
  forms: PublicFunnelWebinarResource["form"][];
};

export type LandingPageEditorData = {
  page: LandingPageEditorPage;
  forms: LandingPageFormReference[];
  lives: LandingPageLiveReference[];
  context: LandingPageRenderContext;
  webinarResources: FunnelWebinarResources;
  commerceProducts: FunnelCommerceProduct[];
};

export type LandingPageList = {
  pages: LandingPageSummary[];
  scope: { projectId: string | null; projectName: string | null; isAggregate: boolean; isLegacyWorkspace: boolean };
};

export type PublicLandingPage = {
  id: string;
  slug: string;
  content: LandingPageStoredContent;
  context: LandingPageRenderContext;
  publishedAt: Date;
  webinar?: PublicFunnelWebinarResource;
  submissionForm?: PublicFunnelWebinarResource["form"];
  submissionLiveId?: string;
  commerceByPageId?: Record<string, FunnelCommerceView>;
  consultationEvents?: Array<{ id: string; title: string; description: string | null; timezone: string; durationMinutes: number; intakeFormFields: unknown }>;
};

export type { LandingPageStoredContent };
export { registrationFormIdsInContent };

export class LandingPageInputError extends Error {
  constructor(message = "landing_page_invalid_input") {
    super(message);
    this.name = "LandingPageInputError";
  }
}

export class LandingPageConflictError extends Error {
  constructor() {
    super("landing_page_conflict");
    this.name = "LandingPageConflictError";
  }
}

export class LandingPageNotFoundError extends Error {
  constructor() {
    super("landing_page_not_found");
    this.name = "LandingPageNotFoundError";
  }
}

export class LandingPageScopeError extends Error {
  constructor() {
    super("landing_page_project_required");
    this.name = "LandingPageScopeError";
  }
}

type FormRecord = { id: string; slug: string; name: string; vendorId?: string; projectId?: string | null; isActive?: boolean; fields?: unknown; submitLabel?: string; successMessage?: string };
type LiveRecord = { id: string; slug: string; title: string; status: string; scheduledAt: Date; formId?: string | null; vendorId?: string; projectId?: string | null; replayEnabled?: boolean; replayAvailableUntil?: Date | null; videoId?: string | null; video?: (LiveVideoReadiness & { id: string; vendorId: string; title: string }) | null };

type LandingPageDb = Pick<PrismaClient, "landingPage" | "landingPageVersion" | "registrationForm" | "live" | "consultationEvent" | "vendor">;

function db() {
  return getDb();
}

function identifier(value: string | null | undefined) {
  const trimmed = value?.trim() ?? "";
  return trimmed && trimmed.length <= MAX_IDENTIFIER_LENGTH && /^[A-Za-z0-9_-]+$/u.test(trimmed) ? trimmed : null;
}

function pageName(value: string) {
  const trimmed = value.trim();
  return trimmed.length > 0 && trimmed.length <= MAX_NAME_LENGTH ? trimmed : null;
}

function positiveRevision(value: number | undefined) {
  return Number.isSafeInteger(value) && (value ?? 0) > 0 ? value! : null;
}

function databaseErrorCode(error: unknown) {
  return typeof error === "object" && error !== null && "code" in error ? String(error.code) : null;
}

function inputContent(value: unknown) {
  const content = parseFunnelStepPages(value) ?? parsePageDocument(value) ?? parseLandingPageContent(value);
    if (!content) {
      // A precise reason for the two custom-code limits the editor also checks live.
      const problem = describeFunnelCustomCodeProblem(value);
      throw new LandingPageInputError(problem === "css_invalid" ? "landing_page_custom_css_invalid" : problem === "too_large" ? "landing_page_custom_code_too_large" : undefined);
    }
    if (invalidWebinarContainer(content)) throw new LandingPageInputError("landing_page_webinar_steps_required");
  return content;
}

function publicSubmissionForm(forms: FormRecord[], formId: string | null) {
  if (!formId) return undefined;
  const form = forms.find((candidate) => candidate.id === formId);
  const fields = parseRegistrationFormFields(form?.fields);
  if (!form || !fields.success) return undefined;
  return {
    id: form.id,
    fields: fields.data,
    submitLabel: form.submitLabel || "送出報名",
    successMessage: form.successMessage || "已收到報名，請留意確認信。",
  };
}

function publicSubmissionProjection(forms: FormRecord[], formId: string | null, liveId?: string) {
  const form = publicSubmissionForm(forms, formId);
  return { ...(form ? { submissionForm: form } : {}), ...(liveId ? { submissionLiveId: liveId } : {}) };
}

function consultationEventIdsInContent(content: LandingPageStoredContent): Set<string> {
  const ids = new Set<string>();
  const visitNodes = (nodes: PageDocument["root"]) => {
    for (const node of nodes) {
      if (node.type === "calendar") {
        const candidate = node.props.eventId ?? node.props.calendarId ?? node.props.bookingEventId;
        if (typeof candidate === "string" && candidate.trim()) ids.add(candidate.trim());
      }
      if (node.children) visitNodes(node.children);
    }
  };
  const visitDocument = (document: PageDocument) => {
    visitNodes(document.root);
    for (const popup of document.popups) visitNodes(popup.root);
  };
  if ("pages" in content) Object.values(content.pages).forEach(visitDocument);
  else if ("root" in content && "settings" in content) visitDocument(content);
  return ids;
}

async function publicConsultationEvents(database: LandingPageDb, scope: { vendorId: string; projectId: string | null }, content: LandingPageStoredContent) {
  const referencedIds = [...consultationEventIdsInContent(content)];
  if (referencedIds.length === 0) return [];
  // A closed consultation_booking module publishes no bookable events (F-001).
  if (!await isVendorFeatureEnabled(database, scope.vendorId, "consultation_booking")) return [];
  const events = await database.consultationEvent.findMany({
    where: {
      id: { in: referencedIds },
      vendorId: scope.vendorId,
      projectId: scope.projectId,
      isActive: true,
      salesProject: { is: { status: "published", publishedAt: { not: null } } },
    },
    select: { id: true, title: true, description: true, timezone: true, durationMinutes: true, intakeFormFields: true },
  });
  return events.length === referencedIds.length ? events : [];
}

function toFormReference(form: FormRecord): LandingPageFormReference {
  return { id: form.id, slug: form.slug, name: form.name };
}

function toLiveReference(live: LiveRecord): LandingPageLiveReference {
  if (!PUBLIC_LIVE_STATUSES.has(live.status)) throw new LandingPageInputError("landing_page_live_not_public");
  return {
    id: live.id,
    slug: live.slug,
    title: live.title,
    status: live.status as LandingPageLiveReference["status"],
    scheduledAt: live.scheduledAt.toISOString(),
    ...(live.formId ? { formId: live.formId } : {}),
  };
}

function validateOperationalReferences(operations: unknown, content: LandingPageStoredContent) {
  const steps = "flow" in content ? content.flow?.steps ?? [] : [];
  if (!funnelOperationsReferencesValid(operations, steps)) throw new LandingPageInputError("landing_page_operations_reference_invalid");
}

async function editorContext(): Promise<{ scope: { vendorId: string; projectId: string }; actor: FunnelCustomCodeActor }> {
  const { auth, vendor } = await requireVendorManagerContext();
  const scope = await requireEditableSalesProjectScope(auth.user.id, vendor.id);
  if (!scope.projectId) throw new LandingPageScopeError();
  // Role and e-mail verification come from the session's own records, never from the request.
  const actor = { userId: auth.user.id, role: auth.member?.role ?? null, emailVerified: Boolean(auth.user.emailVerifiedAt) };
  return { scope: { vendorId: vendor.id, projectId: scope.projectId }, actor };
}

async function editorProject() {
  return (await editorContext()).scope;
}

function customCodeGate<T>(check: () => T): T {
  try {
    return check();
  } catch (error) {
    if (error instanceof FunnelCustomCodeRefusal) throw new LandingPageInputError(error.code);
    throw error;
  }
}

/** Custom code (自訂程式碼 / 頁面自訂 CSS) gate shared by every draft write; see `funnel-custom-code-guard`. */
function customCodeChanges(actor: FunnelCustomCodeActor, previous: unknown, next: unknown): FunnelCustomCodeChange[] {
  return customCodeGate(() => assertFunnelCustomCodeWrite(actor, previous, next));
}

async function validateBindings(
  database: LandingPageDb,
  input: { vendorId: string; projectId: string; content: LandingPageStoredContent; formId: string | null; liveId: string | null; publishing?: boolean },
) {
  try {
    await validateFunnelCommerceBindings(
      { vendorId: input.vendorId, projectId: input.projectId }, input.content, database as ReturnType<typeof getDb>,
    );
  } catch {
    throw new LandingPageInputError("landing_page_commerce_invalid");
  }
  const referencedFormIds = registrationFormIdsInContent(input.content);
  if (input.formId) referencedFormIds.add(input.formId);
  const formIds = [...referencedFormIds];
  const forms = formIds.length === 0 ? [] : await database.registrationForm.findMany({
    where: { vendorId: input.vendorId, projectId: input.projectId, isActive: true, id: { in: formIds } },
    select: { id: true, slug: true, name: true, fields: true, submitLabel: true, successMessage: true },
  });
  if (forms.length !== formIds.length) throw new LandingPageInputError("landing_page_form_invalid");

  let live: LiveRecord | null = null;
  if (input.liveId) {
    live = await database.live.findFirst({
      where: { id: input.liveId, vendorId: input.vendorId, projectId: input.projectId, status: { in: [...PUBLIC_LIVE_STATUSES] } },
      select: { id: true, slug: true, title: true, status: true, scheduledAt: true, replayEnabled: true, replayAvailableUntil: true, formId: true, videoId: true, video: { select: videoSelect } },
    });
    if (!live) throw new LandingPageInputError("landing_page_live_invalid");
    const liveFormId = live.formId;
    if (!liveFormId || formIds.length === 0 || formIds.some((formId) => formId !== liveFormId)) {
      throw new LandingPageInputError("landing_page_live_form_mismatch");
    }
  }
  if (input.publishing && webinarContent(input.content)) {
    if ("pages" in input.content && hasDirectWebinarVideo(input.content)) throw new LandingPageInputError("landing_page_webinar_direct_media_forbidden");
    if (!completeWebinarSteps(input.content)) throw new LandingPageInputError("landing_page_webinar_steps_required");
    if (!input.formId || !input.liveId || !webinarResource(forms.find((form) => form.id === input.formId), live, input.vendorId)) throw new LandingPageInputError("landing_page_webinar_resources_required");
    const settings = "flow" in input.content ? input.content.flow?.webinar : undefined;
    if (!settings?.startsAt || !settings.endsAt) throw new LandingPageInputError("landing_page_webinar_schedule_required");
  }
  return { forms, live };
}

async function requireScopedPage(database: LandingPageDb, scope: { vendorId: string; projectId: string }, pageId: string) {
  const id = identifier(pageId);
  if (!id) throw new LandingPageNotFoundError();
  // Archived pages (F-072) are history only: every editor mutation treats them as missing.
  const page = await database.landingPage.findFirst({
    where: { id, vendorId: scope.vendorId, projectId: scope.projectId, archivedAt: null },
    select: { id: true, vendorId: true, projectId: true, name: true, slug: true, operations: true, draftContent: true, draftFormId: true, draftLiveId: true, status: true, publishedVersionId: true, revision: true, publishedAt: true, updatedAt: true },
  });
  if (!page) throw new LandingPageNotFoundError();
  return page;
}

export async function listLandingPages(): Promise<LandingPageList> {
  const { auth, vendor } = await requireVendorManagerContext();
  const scope = await getSalesProjectScope(auth.user.id, vendor.id);
  const pages = await db().landingPage.findMany({
    where: { vendorId: vendor.id, archivedAt: null, ...(scope.projectId ? { projectId: scope.projectId } : {}) },
    select: { id: true, name: true, slug: true, status: true, revision: true, publishedAt: true, updatedAt: true },
    orderBy: [{ updatedAt: "desc" }, { id: "asc" }],
  });
  return {
    pages: pages.map((page) => ({ id: page.id, name: page.name, slug: page.slug, status: page.status, revision: page.revision, publishedAt: page.publishedAt, updatedAt: page.updatedAt })),
    scope,
  };
}

/** `auditOperation` names the caller in the custom-code audit entry (default "create"). */
export async function createLandingPage(input: Omit<LandingPageDraftInput, "id" | "revision">, options: { auditOperation?: string } = {}) {
  const { scope, actor } = await editorContext();
  const name = pageName(input.name);
  const slug = pageSlug(input.slug);
  const content = inputContent(input.content);
  const formId = input.formId ? identifier(input.formId) : null;
  const liveId = input.liveId ? identifier(input.liveId) : null;
  if (!name || !slug || (input.formId && !formId) || (input.liveId && !liveId)) throw new LandingPageInputError();
  if (isReservedLandingPageSlug(slug)) throw new LandingPageInputError("landing_page_slug_reserved");
  assertNoStepsAddedOutsideGoal(undefined, content);
  const changes = customCodeChanges(actor, undefined, content);
  await validateBindings(db(), { ...scope, content, formId, liveId });
  const create = (client: Pick<Prisma.TransactionClient, "landingPage">) => client.landingPage.create({
    data: { vendorId: scope.vendorId, projectId: scope.projectId, name, slug, draftContent: content as Prisma.InputJsonValue, draftFormId: formId, draftLiveId: liveId },
    select: { id: true, vendorId: true, projectId: true, name: true, slug: true, draftContent: true, draftFormId: true, draftLiveId: true, status: true, publishedVersionId: true, revision: true, publishedAt: true, updatedAt: true },
  });
  if (!changes.length) return create(db());
  return db().$transaction(async (transaction) => {
    const created = await create(transaction);
    await recordFunnelCustomCodeSave(transaction, { vendorId: scope.vendorId, actorId: actor.userId, pageId: created.id, operation: options.auditOperation ?? "create", changes });
    return created;
  });
}

/** Lists only resources in the selected sales project for the editor. */
export async function listFunnelWebinarResources(): Promise<FunnelWebinarResources> {
  const scope = await editorProject();
  const [forms, lives] = await Promise.all([
    db().registrationForm.findMany({
      where: { vendorId: scope.vendorId, projectId: scope.projectId, isActive: true },
      select: { id: true, fields: true, submitLabel: true, successMessage: true },
      orderBy: { name: "asc" },
    }),
    db().live.findMany({
      where: { vendorId: scope.vendorId, projectId: scope.projectId, status: { in: [...PUBLIC_LIVE_STATUSES] } },
      select: { id: true, videoId: true, video: { select: videoSelect } },
      orderBy: { scheduledAt: "desc" },
    }),
  ]);
  return {
    lives: lives.map((live) => ({
      id: live.id,
      videoId: live.videoId,
      videoTitle: live.video?.title ?? null,
      videoReady: live.video?.vendorId === scope.vendorId && isLiveVideoReady(live.video),
    })),
    forms: forms.flatMap((form) => {
      const fields = parseRegistrationFormFields(form.fields);
      return fields.success ? [{ id: form.id, fields: fields.data, submitLabel: form.submitLabel, successMessage: form.successMessage }] : [];
    }),
  };
}

/** Returns the scoped editor contract without exposing public or cross-project resources. */
export async function getLandingPageForEditor(pageId: string): Promise<LandingPageEditorData> {
  const scope = await editorProject();
  const page = await db().landingPage.findFirst({
    where: { id: identifier(pageId) ?? "", vendorId: scope.vendorId, projectId: scope.projectId, archivedAt: null },
    select: {
      id: true, name: true, slug: true, status: true, revision: true, publishedAt: true, updatedAt: true,
      draftContent: true, draftFormId: true, draftLiveId: true,
      versions: { select: { id: true, version: true, createdAt: true }, orderBy: { version: "desc" } },
    },
  });
  if (!page) throw new LandingPageNotFoundError();
  const [forms, lives, commerceProducts] = await Promise.all([
    db().registrationForm.findMany({
      where: { vendorId: scope.vendorId, projectId: scope.projectId, isActive: true },
      select: { id: true, slug: true, name: true, fields: true, submitLabel: true, successMessage: true },
      orderBy: { name: "asc" },
    }),
    db().live.findMany({
      where: { vendorId: scope.vendorId, projectId: scope.projectId, status: { in: [...PUBLIC_LIVE_STATUSES] } },
      select: { id: true, slug: true, title: true, status: true, scheduledAt: true, formId: true, videoId: true, video: { select: videoSelect } },
      orderBy: { scheduledAt: "desc" },
    }),
    listFunnelCommerceProducts(scope),
  ]);
  const selectedLive = page.draftLiveId ? lives.find((live) => live.id === page.draftLiveId) ?? null : null;
  const formOptions = forms.map(toFormReference);
  const liveOptions = lives.map(toLiveReference);
  return {
    page: {
      id: page.id, name: page.name, slug: page.slug, status: page.status, revision: page.revision,
      publishedAt: page.publishedAt, updatedAt: page.updatedAt,
      content: parseFunnelStepPages(page.draftContent) ?? parsePageDocument(page.draftContent) ?? parseLandingPageContent(page.draftContent),
      formId: page.draftFormId, liveId: page.draftLiveId, versions: page.versions ?? [],
    },
    webinarResources: {
      lives: lives.map((live) => ({
        id: live.id, videoId: live.videoId, videoTitle: live.video?.title ?? null,
        videoReady: live.video?.vendorId === scope.vendorId && isLiveVideoReady(live.video),
      })),
      forms: forms.flatMap((form) => {
        const fields = parseRegistrationFormFields(form.fields);
        return fields.success ? [{ id: form.id, fields: fields.data, submitLabel: form.submitLabel, successMessage: form.successMessage }] : [];
      }),
    },
    commerceProducts,
    forms: formOptions,
    lives: liveOptions,
    context: { forms: formOptions, ...(selectedLive ? { live: toLiveReference(selectedLive) } : {}) },
  };
}

/** `auditOperation` names the caller in the custom-code audit entry (default "save"). */
export async function saveLandingPageDraft(input: Required<Pick<LandingPageDraftInput, "id" | "revision">> & Omit<LandingPageDraftInput, "id" | "revision">, options: { auditOperation?: string } = {}) {
  const { scope, actor } = await editorContext();
  const id = identifier(input.id);
  const revision = positiveRevision(input.revision);
  const name = pageName(input.name);
  const slug = pageSlug(input.slug);
  const content = inputContent(input.content);
  const formId = input.formId ? identifier(input.formId) : null;
  const liveId = input.liveId ? identifier(input.liveId) : null;
  if (!id || !revision || !name || !slug || (input.formId && !formId) || (input.liveId && !liveId)) throw new LandingPageInputError();
  const existing = await requireScopedPage(db(), scope, id);
  if (existing.revision !== revision) throw new LandingPageConflictError();
  if (existing.status === "published" && existing.slug !== slug) throw new LandingPageInputError("landing_page_slug_locked");
  if (existing.slug !== slug && isReservedLandingPageSlug(slug)) throw new LandingPageInputError("landing_page_slug_reserved");
  assertNoStepsAddedOutsideGoal(existing.draftContent, content);
  validateOperationalReferences(existing.operations, content);
  const changes = customCodeChanges(actor, existing.draftContent, content);
  // An editor that does not know about the publish-time lead form sends no
  // form; keep this page's own auto-created form instead of unbinding it.
  const draftFormId = formId ?? (!liveId && existing.draftFormId && isIndependentlyPublishedFunnel(content)
    && await ownAutoLeadForm(db(), scope, id, existing.draftFormId) ? existing.draftFormId : null);
  await validateBindings(db(), { ...scope, content, formId: draftFormId, liveId });
  await updateDraftWithCustomCodeAudit({ scope, actor, id, revision, changes, operation: options.auditOperation ?? "save" }, { name, slug, draftContent: content as Prisma.InputJsonValue, draftFormId, draftLiveId: liveId, revision: { increment: 1 } });
  return { id, revision: revision + 1 };
}

/**
 * Revision CAS update of one draft. When custom code changed, the update and
 * its audit entry commit together; otherwise this is the plain update.
 */
async function updateDraftWithCustomCodeAudit(
  input: { scope: { vendorId: string; projectId: string }; actor: FunnelCustomCodeActor; id: string; revision: number; changes: FunnelCustomCodeChange[]; operation: string },
  data: Prisma.LandingPageUncheckedUpdateManyInput,
) {
  const where = { id: input.id, vendorId: input.scope.vendorId, projectId: input.scope.projectId, revision: input.revision };
  if (!input.changes.length) {
    const updated = await db().landingPage.updateMany({ where, data });
    if (updated.count !== 1) throw new LandingPageConflictError();
    return;
  }
  await db().$transaction(async (transaction) => {
    const updated = await transaction.landingPage.updateMany({ where, data });
    if (updated.count !== 1) throw new LandingPageConflictError();
    await recordFunnelCustomCodeSave(transaction, { vendorId: input.scope.vendorId, actorId: input.actor.userId, pageId: input.id, operation: input.operation, changes: input.changes });
  });
}

const DEFAULT_LEAD_FORM_FIELDS: RegistrationFormFieldSpec[] = [
  { key: "name", label: "姓名", type: "text", required: true },
  { key: "email", label: "Email", type: "email", required: true },
];

/**
 * Auto-created lead forms are recognised without a schema change by their
 * slug: `lead-auto-<pageId>` (or `lead-auto-<pageId>-<suffix>` when that slug
 * is already taken elsewhere), always within the page's vendor and project.
 */
function autoLeadFormSlug(pageId: string) {
  return `lead-auto-${pageId.toLowerCase()}`;
}

function autoLeadFormWhere(scope: { vendorId: string; projectId: string }, pageId: string): Prisma.RegistrationFormWhereInput {
  const base = autoLeadFormSlug(pageId);
  return { vendorId: scope.vendorId, projectId: scope.projectId, OR: [{ slug: base }, { slug: { startsWith: `${base}-` } }] };
}

async function ownAutoLeadForm(database: LandingPageDb, scope: { vendorId: string; projectId: string }, pageId: string, formId: string) {
  return Boolean(await database.registrationForm.findFirst({ where: { id: formId, isActive: true, ...autoLeadFormWhere(scope, pageId) }, select: { id: true } }));
}

/** Lead-capture pages in step order; the same set the form detection and the button label read. */
function leadCapturePages(steps: FunnelStepPages) {
  return steps.flow.steps.flatMap((step) => steps.pages[step.id] ? [steps.pages[step.id]!] : []);
}

function leadFormSubmitLabel(documents: ReturnType<typeof leadCapturePages>) {
  const find = (nodes: PageDocument["root"] | undefined): string | null => {
    for (const node of nodes ?? []) {
      const label = isLeadCaptureFormNode(node) && typeof node.props.submitLabel === "string" ? node.props.submitLabel.trim() : "";
      if (label && label.length <= 40) return label;
      const nested = find(node.children);
      if (nested) return nested;
    }
    return null;
  };
  for (const document of documents) {
    const label = find(document.root) ?? document.popups.map((popup) => find(popup.root)).find(Boolean);
    if (label) return label;
  }
  return "送出";
}

function autoLeadFormFields(documents: ReturnType<typeof leadCapturePages>) {
  const fields = [...DEFAULT_LEAD_FORM_FIELDS];
  for (const document of documents) {
    fields.push(...surveyLeadFormFields(document, new Set(fields.map((field) => field.key))));
  }
  return fields.slice(0, 32);
}

/**
 * Owner decision 2026-10-24: an audience Funnel captures leads without the
 * merchant first building a registration form. When its lead form has no
 * bound form, publishing reuses this page's auto-created form, or creates one
 * owned by the same vendor and project inside the publish transaction.
 * Nothing from the request chooses the owner, an explicit binding (or a live,
 * which must use its own form) is never replaced, and a deactivated
 * auto-created form is not recreated.
 */
async function ensureAudienceLeadForm(
  transaction: Prisma.TransactionClient,
  scope: { vendorId: string; projectId: string },
  page: { id: string; name: string; draftFormId: string | null; draftLiveId: string | null },
  content: LandingPageStoredContent,
) {
  if (page.draftFormId || page.draftLiveId || !isIndependentlyPublishedFunnel(content)) return page.draftFormId;
  const documents = leadCapturePages(content as FunnelStepPages);
  if (!documents.some((document) => pageDocumentRendersRegistrationForm(document))) return null;
  const existing = await transaction.registrationForm.findMany({
    where: autoLeadFormWhere(scope, page.id),
    select: { id: true, isActive: true },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  });
  if (existing.length) return existing.find((form) => form.isActive)?.id ?? null;
  // Slugs are global: a slug held by another tenant only changes ours, never reuses theirs.
  const base = autoLeadFormSlug(page.id);
  const taken = await transaction.registrationForm.findFirst({ where: { slug: base }, select: { id: true } });
  const slug = taken ? `${base}-${randomUUID().replace(/-/gu, "").slice(0, 12)}` : base;
  try {
    const form = await transaction.registrationForm.create({
      data: {
        vendorId: scope.vendorId,
        projectId: scope.projectId,
        name: `${page.name}｜名單表單（自動建立）`.slice(0, MAX_NAME_LENGTH),
        slug,
        headline: page.name,
        submitLabel: leadFormSubmitLabel(documents),
        successMessage: "已收到你的資料，我們會再與你聯繫。",
        fields: autoLeadFormFields(documents) as unknown as Prisma.InputJsonValue,
      },
      select: { id: true },
    });
    return form.id;
  } catch (error) {
    // A concurrent publish took the slug; the aborted transaction keeps nothing.
    if (databaseErrorCode(error) === "P2002") throw new LandingPageInputError("landing_page_lead_form_retry");
    throw error;
  }
}

/**
 * Abuse guard for independent publication: a page that would become public
 * only through independent audience publication takes one of the vendor's
 * free slots (see `INDEPENDENT_AUDIENCE_PUBLISH_FREE_LIMIT`), and the
 * platform kill switch refuses such new publishes altogether. The caller
 * holds the per-vendor lock taken at the start of the transaction, so
 * concurrent publishes cannot both take the last slot. Republishing a page
 * that is already public this way takes no new slot; pages published before
 * the limit existed keep working.
 */
async function assertIndependentPublishAllowed(
  transaction: Prisma.TransactionClient,
  scope: { vendorId: string; projectId: string },
  page: { id: string; draftLiveId: string | null },
  content: LandingPageStoredContent,
) {
  if (page.draftLiveId || !isIndependentlyPublishedFunnel(content)) return;
  const project = await transaction.salesProject.findFirst({ where: { id: scope.projectId, vendorId: scope.vendorId }, select: { status: true, publishedAt: true } });
  if (isPublishedSalesProject(project)) return;
  const allowance = await independentPublishAllowance(transaction, scope.vendorId, page.id);
  if (allowance.allowed) {
    // A new independent publish allowed only by the owner fallback is worth
    // knowing about (founder suspended, left, or never existed). Ids and a
    // fixed reason code only; written in the publish transaction.
    if (allowance.ownerFallback && !allowance.alreadyCounted) {
      await transaction.auditLog.create({ data: {
        vendorId: scope.vendorId, actorLabel: "system", action: "independent_publish_email_gate_owner_fallback",
        targetType: "LandingPage", targetId: page.id, after: { reason: allowance.ownerFallback },
      } });
    }
    return;
  }
  throw new LandingPageInputError(allowance.disabled
    ? "landing_page_independent_publish_disabled"
    : allowance.emailUnverified ? "landing_page_independent_publish_email_unverified" : "landing_page_independent_publish_limit");
}

function contentFlow(content: LandingPageStoredContent | null | undefined) {
  return content && "flow" in content ? content.flow ?? null : null;
}

/**
 * Whole-document saves follow the add-step rule: a client cannot add a step
 * the Funnel's goal refuses (for example a sales step in an audience
 * Funnel). Steps an older saved document already has are kept.
 */
function assertNoStepsAddedOutsideGoal(previous: unknown, next: LandingPageStoredContent) {
  const nextFlow = contentFlow(next);
  if (!nextFlow) return;
  const previousFlow = previous === undefined ? null : contentFlow(parseFunnelStepPages(previous) ?? parsePageDocument(previous));
  if (stepsAddedOutsideGoal(previousFlow, nextFlow).length) throw new LandingPageInputError("landing_page_step_type_not_allowed");
}

/** A live never becomes public before its project, so such an audience Funnel cannot publish yet. */
async function assertAudienceLiveProjectPublished(
  transaction: Prisma.TransactionClient,
  scope: { vendorId: string; projectId: string },
  page: { draftLiveId: string | null },
  content: LandingPageStoredContent,
) {
  if (!page.draftLiveId || !isIndependentlyPublishedFunnel(content)) return;
  const project = await transaction.salesProject.findFirst({ where: { id: scope.projectId, vendorId: scope.vendorId }, select: { status: true, publishedAt: true } });
  if (!isPublishedSalesProject(project)) throw new LandingPageInputError("landing_page_audience_live_requires_project");
}

export async function publishLandingPage(pageId: string, expectedRevision: number) {
  const { scope, actor } = await editorContext();
  const id = identifier(pageId);
  const revision = positiveRevision(expectedRevision);
  if (!id || !revision) throw new LandingPageInputError();
  try {
    return await db().$transaction(async (transaction) => {
      // First statement: serialise this vendor's publishes before anything is
      // read, so the independent-slot count below sees every publish that
      // committed while this one waited. This relies on READ COMMITTED (set
      // explicitly below): a REPEATABLE READ snapshot could predate the lock.
      await lockIndependentPublishSlots(transaction, scope.vendorId);
      const page = await requireScopedPage(transaction, scope, id);
      if (page.revision !== revision) throw new LandingPageConflictError();
      const content = inputContent(page.draftContent);
      validateOperationalReferences(page.operations, content);
      const publishesCustomCode = customCodeGate(() => assertFunnelCustomCodePublish(actor, content));
      await assertAudienceLiveProjectPublished(transaction, scope, page, content);
      await assertIndependentPublishAllowed(transaction, scope, page, content);
      const formId = await ensureAudienceLeadForm(transaction, scope, page, content);
      await validateBindings(transaction, { ...scope, content, formId, liveId: page.draftLiveId, publishing: true });
      const nextVersion = await transaction.landingPageVersion.count({ where: { vendorId: scope.vendorId, pageId: id } }) + 1;
      const version = await transaction.landingPageVersion.create({
        data: { vendorId: scope.vendorId, pageId: id, version: nextVersion, content: content as Prisma.InputJsonValue, formId, liveId: page.draftLiveId },
        select: { id: true, version: true, content: true, formId: true, liveId: true, createdAt: true },
      });
      const updated = await transaction.landingPage.updateMany({
        where: { id, vendorId: scope.vendorId, projectId: scope.projectId, revision },
        data: { status: "published", publishedVersionId: version.id, publishedAt: new Date(), unpublishedAt: null, ...(formId !== page.draftFormId ? { draftFormId: formId } : {}), revision: { increment: 1 } },
      });
      if (updated.count !== 1) throw new LandingPageConflictError();
      if (publishesCustomCode) await recordFunnelCustomCodePublish(transaction, { vendorId: scope.vendorId, actorId: actor.userId, pageId: id, version: version.version, content });
      return { id, revision: revision + 1, version: version.version, formId };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted });
  } catch (error) {
    // Concurrent publishers can both read the next version number. The unique
    // version key is the final compare-and-swap guard, so expose no DB detail.
    if (databaseErrorCode(error) === "P2002") throw new LandingPageConflictError();
    throw error;
  }
}

export async function unpublishLandingPage(pageId: string, expectedRevision: number) {
  const scope = await editorProject();
  const id = identifier(pageId);
  const revision = positiveRevision(expectedRevision);
  if (!id || !revision) throw new LandingPageInputError();
  const updated = await db().landingPage.updateMany({
    where: { id, vendorId: scope.vendorId, projectId: scope.projectId, revision, status: "published" },
    data: { status: "draft", publishedVersionId: null, unpublishedAt: new Date(), revision: { increment: 1 } },
  });
  if (updated.count !== 1) throw new LandingPageConflictError();
  return { id, revision: revision + 1 };
}

/** CAS metadata save that re-reads the latest draft and applies one bounded
 * command. It intentionally cannot replace existing canvas snapshots. */
export async function saveLandingPageStepMetadata(input: { id: string; revision: number; mutation: FunnelStepPersistenceMutation }) {
  const { scope, actor } = await editorContext();
  const id = identifier(input.id);
  const revision = positiveRevision(input.revision);
  if (!id || !revision) throw new LandingPageInputError();
  const existing = await requireScopedPage(db(), scope, id);
  if (existing.revision !== revision) throw new LandingPageConflictError();
  const content = parseFunnelStepPages(existing.draftContent);
  if (!content) throw new LandingPageInputError();
  const result = applyFunnelStepPersistenceMutation(content, input.mutation);
  if (!result.ok) throw new LandingPageInputError();
  validateOperationalReferences(existing.operations, result.state);
  const changes = customCodeChanges(actor, existing.draftContent, result.state);
  await validateBindings(db(), { ...scope, content: result.state, formId: existing.draftFormId, liveId: existing.draftLiveId });
  await updateDraftWithCustomCodeAudit({ scope, actor, id, revision, changes, operation: "save_steps" }, { draftContent: result.state as unknown as Prisma.InputJsonValue, revision: { increment: 1 } });
  return { id, revision: revision + 1 };
}

/**
 * F-072 / B04-19: a Funnel that was ever published (it has a publish time or
 * an immutable version) or that has any FunnelVisit / FunnelSubmission is
 * archived instead of deleted, so visit and lead-source attribution history
 * survives for ad reporting and commission audits. Archiving unpublishes the
 * page (the public URL returns 404) and hides it from the editor.
 *
 * Only a never-published page without traffic is permanently removed with
 * its versions; the funnel foreign keys are RESTRICT, so the database refuses
 * the delete if traffic appeared concurrently. The published pointer is
 * detached first because Prisma protects the referenced version with a
 * restrictive foreign key.
 */
export async function deleteLandingPage(pageId: string, expectedRevision: number): Promise<{ id: string; archived: boolean }> {
  const { scope, actor } = await editorContext();
  const id = identifier(pageId);
  const revision = positiveRevision(expectedRevision);
  if (!id || !revision) throw new LandingPageInputError();

  const database = db();
  const current = await requireScopedPage(database, scope, id);
  customCodeGate(() => assertFunnelCustomCodeDelete(actor, current.draftContent));
  return database.$transaction(async (transaction) => {
    const page = await requireScopedPage(transaction, scope, id);
    if (page.revision !== revision) throw new LandingPageConflictError();
    const owned = { vendorId: scope.vendorId, pageId: id };
    const [versions, visits, submissions] = await Promise.all([
      transaction.landingPageVersion.count({ where: owned }),
      transaction.funnelVisit.count({ where: owned }),
      transaction.funnelSubmission.count({ where: owned }),
    ]);

    if (page.publishedAt || page.status === "published" || versions > 0 || visits > 0 || submissions > 0) {
      const now = new Date();
      const archived = await transaction.landingPage.updateMany({
        where: { id, vendorId: scope.vendorId, projectId: scope.projectId, revision, archivedAt: null },
        data: {
          archivedAt: now,
          status: "draft",
          publishedVersionId: null,
          ...(page.status === "published" ? { unpublishedAt: now } : {}),
          revision: { increment: 1 },
        },
      });
      if (archived.count !== 1) throw new LandingPageConflictError();
      return { id, archived: true };
    }

    const detached = await transaction.landingPage.updateMany({
      where: { id, vendorId: scope.vendorId, projectId: scope.projectId, revision, archivedAt: null },
      data: { publishedVersionId: null, revision: { increment: 1 } },
    });
    if (detached.count !== 1) throw new LandingPageConflictError();

    const deleted = await transaction.landingPage.deleteMany({
      where: { id, vendorId: scope.vendorId, projectId: scope.projectId, revision: revision + 1, archivedAt: null },
    });
    if (deleted.count !== 1) throw new LandingPageConflictError();
    return { id, archived: false };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}

export async function rollbackLandingPage(pageId: string, version: number, expectedRevision: number) {
  const { scope, actor } = await editorContext();
  const id = identifier(pageId);
  const targetVersion = positiveRevision(version);
  const revision = positiveRevision(expectedRevision);
  if (!id || !targetVersion || !revision) throw new LandingPageInputError();
  const versionRecord = await db().landingPageVersion.findFirst({
    where: { pageId: id, vendorId: scope.vendorId, version: targetVersion, page: { is: { projectId: scope.projectId } } },
    select: { id: true, version: true, content: true, formId: true, liveId: true, createdAt: true },
  });
  if (!versionRecord) throw new LandingPageNotFoundError();
  const current = await requireScopedPage(db(), scope, id);
  if (current.revision !== revision) throw new LandingPageConflictError();
  const content = inputContent(versionRecord.content);
  validateOperationalReferences(current.operations, content);
  const changes = customCodeChanges(actor, current.draftContent, content);
  await validateBindings(db(), { ...scope, content, formId: versionRecord.formId, liveId: versionRecord.liveId });
  await updateDraftWithCustomCodeAudit({ scope, actor, id, revision, changes, operation: "rollback" }, { draftContent: content as Prisma.InputJsonValue, draftFormId: versionRecord.formId, draftLiveId: versionRecord.liveId, revision: { increment: 1 } });
  return { id, revision: revision + 1 };
}

async function availableCopySlug(database: LandingPageDb, slug: string) {
  const base = slug.slice(0, MAX_SLUG_LENGTH - 5) || "page";
  for (let suffix = 1; suffix <= 100; suffix += 1) {
    const candidate = `${base}-copy${suffix === 1 ? "" : `-${suffix}`}`;
    // Public slugs are globally unique; inspect existence only, never expose another tenant's page.
    const existing = await database.landingPage.findFirst({ where: { slug: candidate }, select: { id: true } });
    if (!existing) return candidate;
  }
  throw new LandingPageConflictError();
}

export async function duplicateLandingPage(pageId: string) {
  const { scope, actor } = await editorContext();
  const page = await requireScopedPage(db(), scope, pageId);
  const content = inputContent(page.draftContent);
  // A copy is a new page: copied custom code (and JS) passes the same gate as newly written code.
  const changes = customCodeChanges(actor, undefined, content);
  await validateBindings(db(), { ...scope, content, formId: page.draftFormId, liveId: page.draftLiveId });
  const slug = await availableCopySlug(db(), page.slug);
  const name = `${page.name} 副本`.slice(0, MAX_NAME_LENGTH);
  const create = (client: Pick<Prisma.TransactionClient, "landingPage">) => client.landingPage.create({
    data: { vendorId: scope.vendorId, projectId: scope.projectId, name, slug, draftContent: content as Prisma.InputJsonValue, draftFormId: page.draftFormId, draftLiveId: page.draftLiveId },
    select: { id: true, vendorId: true, projectId: true, name: true, slug: true, draftContent: true, draftFormId: true, draftLiveId: true, status: true, publishedVersionId: true, revision: true, publishedAt: true, updatedAt: true },
  });
  if (!changes.length) return create(db());
  return db().$transaction(async (transaction) => {
    const created = await create(transaction);
    await recordFunnelCustomCodeSave(transaction, { vendorId: scope.vendorId, actorId: actor.userId, pageId: created.id, operation: "duplicate", changes });
    return created;
  });
}

/**
 * Resolves a globally unique public slug. The ambiguity check additionally
 * fails closed for legacy databases that have not enforced the unique index.
 */
export async function loadPublicLandingPage(slug: string, onUnavailable?: (reason: PublicLandingPageUnavailableReason) => void): Promise<PublicLandingPage | null> {
  const unavailable = (reason: PublicLandingPageUnavailableReason) => { onUnavailable?.(reason); return null; };
  const safeSlug = pageSlug(slug);
  if (!safeSlug) return unavailable("invalid_slug");
  const candidates = await db().landingPage.findMany({
    where: publicLandingPageCandidateWhere(safeSlug),
    take: 2,
    select: {
      id: true,
      vendorId: true,
      projectId: true,
      slug: true,
      publishedAt: true,
      project: { select: { status: true, publishedAt: true } },
      publishedVersion: {
        select: {
          id: true,
          vendorId: true,
          pageId: true,
          content: true,
          formId: true,
          liveId: true,
          live: {
            select: {
              id: true,
              slug: true,
              title: true,
              status: true,
              scheduledAt: true,
              replayEnabled: true,
              replayAvailableUntil: true,
              formId: true,
              vendorId: true,
              projectId: true,
              videoId: true,
              video: { select: videoSelect },
            },
          },
        },
      },
    },
  });
  const page = candidates.length === 1 ? candidates[0] : undefined;
  if (!page) return unavailable("not_unique");
  const published = publishedLandingPageContent(page);
  if ("reason" in published) return unavailable(published.reason);
  const { version, publishedAt, content, formIds: ids } = published;
  // The SQL gate only pre-filters; the structural check on parsed content is authoritative.
  if (!publicProjectGateSatisfied(page.project, content)) return unavailable("invalid_content");
  const projectPublished = isPublishedSalesProject(page.project);
  const forms = ids.length === 0 ? [] : await db().registrationForm.findMany({
    where: { id: { in: ids }, vendorId: page.vendorId, projectId: page.projectId, isActive: true },
    select: { id: true, slug: true, name: true, fields: true, submitLabel: true, successMessage: true },
  });
  if (forms.length !== ids.length) return unavailable("form_unavailable");
  const live = version.live;
  if (!publicLiveBindingValid(page, version.liveId, live, ids)) return unavailable("live_unavailable");
  // A live never becomes public before its project, even through an independent audience Funnel.
  if (!projectPublished && version.liveId) return unavailable("live_requires_published_project");

  const webinar = webinarContent(content) && completeWebinarSteps(content) && !("pages" in content && hasDirectWebinarVideo(content))
    ? webinarResource(forms.find((form) => form.id === version.formId), live, page.vendorId)
    : undefined;
  // Checkout stays behind project publication (resolvePublishedFunnelCheckout),
  // so an unpublished project shows no purchase surface it could not honour.
  const commerceByPageId = page.projectId && projectPublished
    ? await publicFunnelCommerceViews({ vendorId: page.vendorId, projectId: page.projectId }, content, page.slug)
    : {};
  const consultationEvents = await publicConsultationEvents(db(), { vendorId: page.vendorId, projectId: page.projectId }, content);
  return {
    ...(webinar ? { webinar } : {}),
    ...publicSubmissionProjection(forms, version.formId, live?.id),
    id: page.id,
    slug: page.slug,
    // Emergency switch: published custom JS and page CSS are withheld from every public render.
    content: isFunnelCustomCodeDisabled() ? withoutFunnelCustomScripts(content) : content,
    context: { pageId: page.id, forms: forms.map(toFormReference), ...(live ? { live: toLiveReference(live) } : {}) },
    publishedAt,
    ...(Object.keys(commerceByPageId).length > 0 ? { commerceByPageId } : {}),
    ...(consultationEvents.length > 0 ? { consultationEvents } : {}),
  };
}

const UNAVAILABLE_REASON_MESSAGES: Record<PublicLandingPageUnavailableReason, string> = {
  invalid_slug: "公開網址格式不正確。",
  not_unique: "找不到唯一可公開的一頁式網站版本；請確認一頁式網站與專案發布狀態。",
  version_mismatch: "一頁式網站發布版本不存在或不一致，請重新發布。",
  invalid_content: "已發布版本的頁面內容格式無效，請修復後重新發布。",
  form_unavailable: "已發布版本的報名表不存在、已停用或不屬於此專案。",
  live_unavailable: "已發布版本的直播不可公開，或直播與報名表的專案綁定不一致。",
  live_requires_published_project: "這個名單型一頁式網站綁定了直播，直播要等所屬專案發布後才能公開。請移除直播綁定後重新發布，或先發布專案。",
};

function hasBookableAvailability(consultations: Array<{ weeklySchedule: unknown }>) {
  return consultations.some(({ weeklySchedule }) => Array.isArray(weeklySchedule) && weeklySchedule.some((entry) => {
    if (!entry || typeof entry !== "object") return false;
    const ranges = (entry as { ranges?: unknown }).ranges;
    return Array.isArray(ranges) && ranges.some((range) => typeof range === "string" && range.length > 0);
  }));
}

/** Non-blocking notes for a published audience Funnel: the URL opens, but some blocks wait. */
function independentFunnelWarnings(publicPage: PublicLandingPage, steps: FunnelStepPages, projectPublished: boolean, projectHref: string) {
  const warnings: NonNullable<LandingPagePublicationStatus["warnings"]> = [];
  const documents = leadCapturePages(steps);
  if (!publicPage.submissionForm && documents.some((document) => pageDocumentRendersRegistrationForm(document))) {
    warnings.push({ label: "頁面上的表單沒有連結可用的名單表單，訪客目前無法送出資料。請重新發布讓系統建立名單表單，或到報名管理確認表單已啟用。", href: "/forms" });
  }
  const formKeys = new Set(publicPage.submissionForm?.fields.map((field) => field.key) ?? []);
  if (publicPage.submissionForm && documents.some((document) => surveyLeadFormFields(document, new Set()).some((field) => !formKeys.has(field.key)))) {
    warnings.push({ label: "頁面上的問卷題目不在目前的名單表單欄位裡，訪客無法作答；請到報名管理為表單加入對應欄位。", href: "/forms" });
  }
  if (!projectPublished && consultationEventIdsInContent(steps).size > 0) warnings.push({ label: "頁面含有預約區塊；所屬專案發布前不會顯示可預約時段。", href: projectHref });
  return warnings;
}

/** Where the merchant can lift the independent publication limit; links to authenticated pages only. */
async function independentPublishLimitLinks(vendorId: string, projectHref: string) {
  const links: LandingPagePublicationStatus["missing"] = [{ label: "發布所屬專案（專案內的網站不計入上限）", href: projectHref }];
  // While funnel_binding is closed no card can be bound, so do not point there (F-002).
  if (await isCardBindingRequiredForVendor(db(), vendorId)) links.push({ label: "新增並驗證商家付款方式", href: "/billing/payment-methods" });
  links.push({ label: "升級付費方案", href: "/billing/plans" });
  return links;
}

/** An audience Funnel's own state before the public loader runs; null when the loader decides. */
async function audienceFunnelPreflightStatus(
  scope: { vendorId: string },
  page: { id: string; status: string; draftLiveId: string | null },
  project: { status: string; publishedAt: Date | null },
  projectHref: string,
): Promise<LandingPagePublicationStatus | null> {
  if (project.status === "archived") return { available: false, message: "所屬專案已封存，公開網址目前無法開啟。", projectHref, missing: [] };
  if (page.status === "published") return null;
  const projectPublished = isPublishedSalesProject(project);
  if (page.draftLiveId && !projectPublished) {
    return { available: false, message: "一頁式網站尚未發布。這個名單型網站綁定了直播，直播要等所屬專案發布後才能公開，所以目前無法發布；請移除直播綁定，或先發布專案。", projectHref, missing: [] };
  }
  let usage = "";
  if (!projectPublished) {
    // Read-only mirror of the publish-time limit; the publish transaction re-checks under its lock.
    const allowance = await independentPublishAllowance(db(), scope.vendorId, page.id);
    if (!allowance.allowed && allowance.disabled) {
      return { available: false, message: `一頁式網站尚未發布。${INDEPENDENT_PUBLISH_DISABLED_MESSAGE}`, projectHref, missing: [{ label: "發布所屬專案", href: projectHref }] };
    }
    if (!allowance.allowed && allowance.emailUnverified) {
      return { available: false, message: `一頁式網站尚未發布。${INDEPENDENT_PUBLISH_EMAIL_UNVERIFIED_MESSAGE}`, projectHref, missing: [{ label: "驗證 Email", href: "/verify-email" }, { label: "發布所屬專案", href: projectHref }] };
    }
    if (!allowance.allowed) {
      return { available: false, message: `一頁式網站尚未發布。${independentPublishLimitMessage(allowance.used ?? undefined)}`, projectHref, missing: await independentPublishLimitLinks(scope.vendorId, projectHref) };
    }
    if (!allowance.uncapped && allowance.used !== null) usage = `（免費帳號可同時獨立發布 ${allowance.limit} 個名單型網站，目前已使用 ${allowance.used} 個）`;
  }
  return { available: false, message: `一頁式網站尚未發布，公開網址目前無法開啟。名單型網站發布後即可開啟，不需要先發布專案${usage}。`, projectHref, missing: [] };
}

const STEP_LABELS = new Map(getFunnelStepCatalog().map((step) => [step.type, step.label]));
const COMMERCE_KIND_LABELS = { binding: "商品結帳設定", payment: "付款元件", checkout_form: "結帳聯絡表單" } as const;
const MAX_NAMED_BLOCKERS = 5;

function blockerLabel(blocker: IndependentPublishBlocker) {
  if (blocker.kind === "commerce") return `頁面『${blocker.stepName}』含${blocker.commerce.map((kind) => COMMERCE_KIND_LABELS[kind]).join("、")}`;
  const typeLabel = STEP_LABELS.get(blocker.stepType) ?? blocker.stepType;
  const group = blocker.group === "webinar" ? "Webinar 流程" : "銷售流程";
  return `步驟『${blocker.stepName}』${blocker.stepName === typeLabel ? "" : `（${typeLabel}）`}屬於${group}`;
}

/** Names the steps and pages that keep an audience Funnel behind its project. */
function audienceProjectRequiredNote(content: FunnelStepPages) {
  const labels = independentPublishBlockers(content).map(blockerLabel);
  if (!labels.length) return "這個名單網站含有銷售、結帳或 Webinar 內容，需要所屬專案發布後才能公開。";
  const named = labels.slice(0, MAX_NAMED_BLOCKERS).join("；");
  const more = labels.length > MAX_NAMED_BLOCKERS ? `；另有 ${labels.length - MAX_NAMED_BLOCKERS} 項` : "";
  return `這個名單網站需要所屬專案發布後才能公開，因為${named}${more}。若要不發布專案就直接公開，請移除這些步驟或元件後重新發布。`;
}

/** Project prerequisites for a Funnel whose public URL waits for its sales project. */
async function unpublishedProjectStatus(
  scope: { vendorId: string; projectId: string },
  primaryFlow: Parameters<typeof canPublishSalesProject>[0],
  projectHref: string,
  note = "",
): Promise<LandingPagePublicationStatus> {
  const now = new Date();
  const [pricedProducts, forms, lives, consultations, paymentMethods] = await Promise.all([
    db().salesProjectProduct.count({ where: { vendorId: scope.vendorId, projectId: scope.projectId, product: { isActive: true, priceCents: { gt: 0 } } } }),
    db().registrationForm.count({ where: { vendorId: scope.vendorId, projectId: scope.projectId, isActive: true } }),
    db().live.count({ where: { vendorId: scope.vendorId, projectId: scope.projectId } }),
    db().consultationEvent.findMany({ where: { vendorId: scope.vendorId, projectId: scope.projectId, isActive: true }, select: { weeklySchedule: true } }),
    // While funnel_binding is closed no card can be bound, so none is required (F-002).
    (await isCardBindingRequiredForVendor(db(), scope.vendorId)) ? db().paymentMethodReference.count({ where: verifiedVendorPaymentMethodWhere(scope.vendorId, now) }) : Promise.resolve(1),
  ]);
  const hasAvailability = hasBookableAvailability(consultations);
  const missing: LandingPagePublicationStatus["missing"] = [];
  if (!pricedProducts) missing.push({ label: "尚未連結啟用且價格大於 0 的商品", href: "/products" });
  if (!forms) missing.push({ label: "尚未建立啟用的報名表", href: "/forms" });
  if (!paymentMethods) missing.push({ label: "尚無有效且已驗證的商家付款方式", href: "/billing/payment-methods" });
  if (primaryFlow === "live" && !lives) missing.push({ label: "尚未建立直播場次", href: "/lives" });
  if (primaryFlow === "consultation") {
    if (!consultations.length) missing.push({ label: "尚未建立啟用的諮詢服務", href: "/consultations" });
    if (!hasAvailability) missing.push({ label: "尚未設定可預約時間", href: "/consultations" });
  }
  const ready = canPublishSalesProject(primaryFlow, {
    exists: true,
    hasLinkedProduct: pricedProducts > 0,
    hasPricedProduct: pricedProducts > 0,
    hasFunnelTemplate: forms > 0,
    hasLiveSession: lives > 0,
    hasConsultationService: consultations.length > 0,
    hasAvailability,
    hasPaymentMethod: paymentMethods > 0,
    hasPreviewableFlow: true,
    isPublished: false,
  });
  const message = ready
    ? "專案尚未發布，公開網址目前無法開啟。發布條件已齊備，請到專案頁發布。"
    : "專案尚未發布，公開網址目前無法開啟。請先補齊下列項目，再到專案頁發布。";
  return { available: false, message: `${note}${message}`, projectHref, missing };
}

/**
 * Explains to the signed-in merchant why their public URL does or does not
 * open. Scope comes from the authenticated vendor and selected project; the
 * anonymous `/lp` responses never carry any of these reasons. The project
 * checks are a read-only mirror of `publishSalesProjectAction` and never
 * relax its verified payment method requirement. An audience Funnel is
 * public on its own (owner decision 2026-10-24), so it reports only its own
 * publication state and runtime warnings.
 */
export async function getLandingPagePublicationStatus(pageId: string): Promise<LandingPagePublicationStatus> {
  const scope = await editorProject();
  const id = identifier(pageId);
  if (!id) throw new LandingPageNotFoundError();
  const page = await db().landingPage.findFirst({
    where: { id, vendorId: scope.vendorId, projectId: scope.projectId, archivedAt: null },
    select: { id: true, slug: true, status: true, operations: true, draftContent: true, draftLiveId: true, publishedVersion: { select: { content: true } } },
  });
  if (!page) throw new LandingPageNotFoundError();
  const projectHref = `/projects/${encodeURIComponent(scope.projectId)}`;
  const project = await db().salesProject.findFirst({
    where: { id: scope.projectId, vendorId: scope.vendorId },
    select: { status: true, publishedAt: true, primaryFlow: true },
  });
  if (!project) return { available: false, message: "所屬專案不存在，公開網址目前無法開啟。", projectHref, missing: [] };
  // The content that decides the public gate: the live version once published, otherwise the draft.
  const gateContent = parseFunnelStepPages(page.status === "published" ? page.publishedVersion?.content : page.draftContent);
  const independent = isIndependentlyPublishedFunnel(gateContent);
  const projectPublished = isPublishedSalesProject(project);
  if (independent && !projectPublished) {
    const preflight = await audienceFunnelPreflightStatus(scope, page, project, projectHref);
    if (preflight) return preflight;
  }
  // Every other Funnel still waits for its project (owner decision 2026-10-24).
  if (!projectPublished && !independent) {
    const note = isAudienceFunnel(gateContent) ? audienceProjectRequiredNote(gateContent) : "";
    return unpublishedProjectStatus(scope, project.primaryFlow, projectHref, note);
  }
  if (page.status !== "published") {
    return independent
      ? (await audienceFunnelPreflightStatus(scope, page, project, projectHref))!
      : { available: false, message: "一頁式網站尚未發布，公開網址目前無法開啟。", projectHref, missing: [] };
  }
  let reason: PublicLandingPageUnavailableReason | null = null;
  const publicPage = await loadPublicLandingPage(page.slug, (value) => { reason = value; });
  if (!publicPage) {
    return { available: false, message: reason ? UNAVAILABLE_REASON_MESSAGES[reason] : "公開頁目前無法開啟，請檢查發布資源。", projectHref, missing: [] };
  }
  if (publicPage.id !== page.id) return { available: false, message: "公開網址與目前頁面的發布版本不一致，請確認網址與發布版本。", projectHref, missing: [] };
  const publishedLabel = projectPublished ? "專案與一頁式網站均已發布" : "一頁式網站已發布";
  if (!("pages" in publicPage.content)) return { available: true, message: `${publishedLabel}，公開頁目前可開啟。`, projectHref, missing: [] };
  const steps = publicPage.content;
  const operationsHref = `/landing-pages/${encodeURIComponent(page.id)}/operations`;
  const operations = parseFunnelOperations(page.operations);
  // Unparseable operations make every public step 404 at runtime.
  if (!operations) {
    return { available: false, message: "一頁式網站的 A/B 或截止設定無效，公開網址會回傳 404；請到一頁式網站管理修正。", projectHref, missing: [{ label: "檢查一頁式網站管理設定", href: operationsHref }] };
  }
  // `available` reflects only what the public root URL actually answers, for
  // a deterministic visitor in every A/B arm, following a deadline redirect.
  const rootWorks = representativeFunnelVisitorIds(page.id, page.operations).every((visitorId) => {
    const root = publicFunnelRouteOutcome({ pageId: page.id, content: steps, operations: page.operations, visitorId });
    if (root.status === 404) return false;
    return !root.redirectPath || publicFunnelRouteOutcome({ pageId: page.id, content: steps, operations: page.operations, stepPath: root.redirectPath, visitorId }).status === 200;
  });
  if (!rootWorks) {
    return { available: false, message: "公開網址的第一個步驟目前無法開啟（含 A/B 各組與截止轉向），請檢查一頁式網站步驟與 A/B 設定。", projectHref, missing: [{ label: "檢查一頁式網站管理設定", href: operationsHref }] };
  }
  // Non-blocking: the root renders, but settings need attention. (A step
  // without a page document cannot reach here: parseFunnelStepPages rejects
  // the whole version, which the loader reports as invalid content.)
  const warnings: NonNullable<LandingPagePublicationStatus["warnings"]> = [];
  if (!funnelOperationsReferencesValid(page.operations, steps.flow.steps)) warnings.push({ label: "部分 A/B、截止或報表設定參照已不存在的步驟，請到一頁式網站管理檢查。", href: operationsHref });
  if (independent) warnings.push(...independentFunnelWarnings(publicPage, steps, projectPublished, projectHref));
  const message = isFunnelDeadlineExpired(operations)
    ? `${publishedLabel}，但活動已截止；公開頁依設定顯示截止訊息或轉向其他步驟。`
    : `${publishedLabel}，公開頁目前可開啟。`;
  return { available: true, message, projectHref, missing: [], ...(warnings.length ? { warnings } : {}) };
}
