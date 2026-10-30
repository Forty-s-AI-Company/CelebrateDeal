import { randomBytes } from "node:crypto";
import { Prisma } from "@prisma/client";
import { requireVendorManagerContext } from "@/lib/auth";
import { assertFunnelCustomCodeWrite, FunnelCustomCodeRefusal, type FunnelCustomCodeActor } from "@/lib/funnel-custom-code-guard";
import { getDb } from "@/lib/db";
import { FUNNEL_STEP_TYPES, isFunnelStepTypeAddableForGoal, type FunnelGoal, type FunnelStepType } from "@/lib/funnel-flow";
import { createGoalFunnelStepPages } from "@/lib/funnel-goal-step-pages";
import { parsePageDocument, type PageDocument } from "@/lib/funnel-page-document";
import { addFunnelStepPage, parseFunnelStepPages, replaceFunnelStepPage, switchFunnelStep, type FunnelStepPages } from "@/lib/funnel-step-pages";
import { getFunnelTemplateGalleryItem, instantiateFunnelTemplate, listFunnelTemplateGallery } from "@/lib/funnel-template-gallery";
import {
  createLandingPage,
  LandingPageConflictError,
  LandingPageInputError,
  LandingPageNotFoundError,
  LandingPageScopeError,
  saveLandingPageDraft,
} from "@/lib/landing-page-service";
import {
  LANDING_PAGE_TEMPLATE_VENDOR_LIMIT,
  MERCHANT_TEMPLATE_STEP_PREFIX,
  normalizeTemplateName,
  prepareStoredTemplateDocument,
  readStoredTemplateDocument,
  rekeyTemplateDocument,
  templateDisplayDocument,
} from "@/lib/landing-page-template-document";
import { getPlatformTemplatePreviewDocument } from "@/lib/landing-page-platform-template-library";
import { getStepTemplatePreviewDocument, instantiateStepTemplateDocument } from "@/lib/funnel-step-template-options";
import { LANDING_PAGE_MAX_CONTENT_BYTES, landingPageContentBytes } from "@/lib/landing-page-limits";
import { requireEditableSalesProjectScope } from "@/lib/sales-project-scope";

/**
 * 「範本」library: platform templates (code) and merchant templates
 * (`LandingPageTemplate`). Tenant identity is always derived here from the
 * authenticated manager (owner/admin); every input id is bound to that vendor
 * (and, for pages, the selected sales project) in the final query.
 */

export type LandingPageTemplateSource = { kind: "platform" | "mine"; id: string };

/**
 * List entry. `thumbnail` holds only the first root sections (enough for the
 * card) so the list stays small; the full document is read per template for
 * the preview. A stored row that no longer parses is still listed with
 * `readable: false` (and no thumbnail) so the merchant can delete it instead of
 * it silently using up the per-vendor limit.
 */
export type LandingPageTemplateSummary = {
  id: string;
  name: string;
  readable: boolean;
  thumbnail: PageDocument | null;
  createdAt: string;
  updatedAt: string;
};

/** Root sections kept for a card thumbnail (the card shows the top of the page only). */
export const TEMPLATE_THUMBNAIL_SECTIONS = 2;

export type LandingPageTemplateTargetStep = { id: string; name: string; type: FunnelStepType; isSystem: boolean; templateId: string | null };
export type LandingPageTemplateTarget = { id: string; name: string; revision: number; goal: FunnelGoal; steps: LandingPageTemplateTargetStep[] };

export class LandingPageTemplateNotFoundError extends Error {
  constructor() {
    super("landing_page_template_not_found");
    this.name = "LandingPageTemplateNotFoundError";
  }
}

export type LandingPageTemplateInputCode =
  | "name_invalid"
  | "content_invalid"
  | "content_too_large"
  | "limit_reached"
  | "step_invalid"
  | "template_incompatible"
  | "funnel_required"
  | "create_invalid";

/** Applying or creating must not produce a draft larger than the editor itself may save. */
function assertDraftWithinLimit(content: unknown) {
  if (landingPageContentBytes(content) > LANDING_PAGE_MAX_CONTENT_BYTES) throw new LandingPageTemplateInputError("content_too_large");
}

export class LandingPageTemplateInputError extends Error {
  constructor(readonly code: LandingPageTemplateInputCode) {
    super(`landing_page_template_${code}`);
    this.name = "LandingPageTemplateInputError";
  }
}

const MAX_IDENTIFIER_LENGTH = 100;

function identifier(value: unknown) {
  const trimmed = typeof value === "string" ? value.trim() : "";
  return trimmed && trimmed.length <= MAX_IDENTIFIER_LENGTH && /^[A-Za-z0-9_-]+$/u.test(trimmed) ? trimmed : null;
}

function db() {
  return getDb();
}

async function managerVendor() {
  const { auth, vendor } = await requireVendorManagerContext();
  // Role and e-mail verification come from the session's own records (same actor as the page editor).
  const actor: FunnelCustomCodeActor = { userId: auth.user.id, role: auth.member?.role ?? null, emailVerified: Boolean(auth.user.emailVerifiedAt) };
  return { vendorId: vendor.id, userId: auth.user.id, actor };
}

/** Pages belong to a sales project; the aggregate overview is read-only. */
async function editorScope() {
  const { vendorId, userId, actor } = await managerVendor();
  const scope = await requireEditableSalesProjectScope(userId, vendorId);
  if (!scope.projectId) throw new LandingPageScopeError();
  return { vendorId, userId, actor, projectId: scope.projectId };
}

/**
 * Saving a template that carries 自訂程式碼 is treated like adding that code to
 * a page: the same #499 gate (owner/admin; JS needs a verified e-mail; the
 * kill switch refuses new JS). Refusals use the page editor's error codes.
 */
function templateCustomCodeChanges(actor: FunnelCustomCodeActor, content: PageDocument) {
  try {
    return assertFunnelCustomCodeWrite(actor, undefined, content);
  } catch (error) {
    if (error instanceof FunnelCustomCodeRefusal) throw new LandingPageInputError(error.code);
    throw error;
  }
}

async function scopedPage(scope: { vendorId: string; projectId: string }, pageId: unknown) {
  const id = identifier(pageId);
  if (!id) throw new LandingPageNotFoundError();
  const page = await db().landingPage.findFirst({
    where: { id, vendorId: scope.vendorId, projectId: scope.projectId, archivedAt: null },
    select: { id: true, name: true, slug: true, revision: true, draftContent: true, draftFormId: true, draftLiveId: true },
  });
  if (!page) throw new LandingPageNotFoundError();
  return page;
}

/** The page document of one step (funnel) or the whole stored document (single-page draft). */
function stepDocument(draftContent: unknown, stepId: unknown): PageDocument | null {
  const funnel = parseFunnelStepPages(draftContent);
  if (funnel) {
    const id = identifier(stepId);
    const step = id ? funnel.flow.steps.find((item) => item.id === id) : undefined;
    return step && !step.isSystem ? funnel.pages[step.id] ?? null : null;
  }
  if (stepId) return null;
  return parsePageDocument(draftContent);
}

function instancePrefix() {
  return `t${randomBytes(5).toString("hex")}`;
}

/** A merchant template is looked up with the caller's vendor in the same query. */
async function resolveTemplate(vendorId: string, source: LandingPageTemplateSource, pageId: string) {
  const id = identifier(source.id);
  if (!id) throw new LandingPageTemplateNotFoundError();
  if (source.kind === "platform") {
    if (!getFunnelTemplateGalleryItem(id)) throw new LandingPageTemplateNotFoundError();
    return { document: instantiateFunnelTemplate(id, pageId), recordedId: id };
  }
  const row = await db().landingPageTemplate.findFirst({ where: { id, vendorId }, select: { id: true, content: true } });
  const stored = row ? readStoredTemplateDocument(row.content) : null;
  if (!row || !stored) throw new LandingPageTemplateNotFoundError();
  return { document: rekeyTemplateDocument(stored, instancePrefix(), pageId), recordedId: `${MERCHANT_TEMPLATE_STEP_PREFIX}${row.id}` };
}

function platformTemplateFits(goal: FunnelGoal, stepType: FunnelStepType, templateId: string) {
  return listFunnelTemplateGallery(goal, stepType).some((item) => item.id === templateId);
}

export async function listLandingPageTemplates(): Promise<LandingPageTemplateSummary[]> {
  const { vendorId } = await managerVendor();
  const rows = await db().landingPageTemplate.findMany({
    where: { vendorId },
    select: { id: true, name: true, content: true, createdAt: true, updatedAt: true },
    orderBy: [{ updatedAt: "desc" }, { id: "asc" }],
    take: LANDING_PAGE_TEMPLATE_VENDOR_LIMIT,
  });
  return rows.map((row) => {
    const content = readStoredTemplateDocument(row.content);
    // No page custom CSS (it would leak into every other card) and no JS (thumbnails never run it).
    const thumbnail = content ? templateDisplayDocument({ ...content, root: content.root.slice(0, TEMPLATE_THUMBNAIL_SECTIONS), popups: [] }, { keepPageCss: false }) : null;
    return { id: row.id, name: row.name, readable: Boolean(content), thumbnail, createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString() };
  });
}

/** Full stored document of the caller's own template, for the preview. */
export async function getLandingPageTemplateDocument(templateId: unknown): Promise<PageDocument> {
  const { vendorId } = await managerVendor();
  const id = identifier(templateId);
  if (!id) throw new LandingPageTemplateNotFoundError();
  const row = await db().landingPageTemplate.findFirst({ where: { id, vendorId }, select: { content: true } });
  const content = row ? readStoredTemplateDocument(row.content) : null;
  if (!content) throw new LandingPageTemplateNotFoundError();
  return content;
}

/** Full preview document of a platform template; the library list only carries a thumbnail. Manager-only like the rest of the library. */
export async function getLandingPagePlatformTemplateDocument(templateId: unknown): Promise<PageDocument> {
  await managerVendor();
  const document = getPlatformTemplatePreviewDocument(templateId);
  if (!document) throw new LandingPageTemplateNotFoundError();
  return document;
}

/**
 * Documents for the step template picker (「更換模板」／新增步驟). Platform templates are code, so there is no
 * tenant row to bind; the manager guard applies, and the template must be one the gallery offers for the
 * funnel's goal and the step's type (unknown, retired, hidden and incompatible ids are refused).
 */
export async function getLandingPageStepTemplatePreview(input: { goal: unknown; stepType: unknown; templateId: unknown }): Promise<PageDocument> {
  await managerVendor();
  const document = getStepTemplatePreviewDocument(input);
  if (!document) throw new LandingPageTemplateNotFoundError();
  return document;
}

/** Fresh document (unique node ids) to apply as a step's page; same checks as the preview. */
export async function instantiateLandingPageStepTemplate(input: { goal: unknown; stepType: unknown; templateId: unknown; pageId: unknown }): Promise<PageDocument> {
  await managerVendor();
  const document = instantiateStepTemplateDocument(input);
  if (!document) throw new LandingPageTemplateNotFoundError();
  return document;
}

/** Name of the caller's own template (for the create form); null when it is missing or another vendor's. */
export async function getLandingPageTemplateName(templateId: unknown): Promise<string | null> {
  const { vendorId } = await managerVendor();
  const id = identifier(templateId);
  if (!id) return null;
  const row = await db().landingPageTemplate.findFirst({ where: { id, vendorId }, select: { name: true } });
  return row?.name ?? null;
}

/** Sites of the selected project that a template can be applied to (names only; steps load per site). */
export async function listLandingPageTemplateTargets(): Promise<Array<{ id: string; name: string }>> {
  const scope = await editorScope();
  return db().landingPage.findMany({
    where: { vendorId: scope.vendorId, projectId: scope.projectId, archivedAt: null },
    select: { id: true, name: true },
    orderBy: [{ updatedAt: "desc" }, { id: "asc" }],
    take: 200,
  });
}

export async function getLandingPageTemplateTarget(pageId: unknown): Promise<LandingPageTemplateTarget> {
  const scope = await editorScope();
  const page = await scopedPage(scope, pageId);
  const funnel = parseFunnelStepPages(page.draftContent);
  if (!funnel) throw new LandingPageTemplateInputError("funnel_required");
  return {
    id: page.id, name: page.name, revision: page.revision, goal: funnel.flow.goal,
    steps: funnel.flow.steps.map((step) => ({ id: step.id, name: step.name, type: step.type, isSystem: step.isSystem, templateId: step.template.templateId ?? null })),
  };
}

/**
 * Saves the stored draft of one step as a merchant template. The content is
 * read from the database under the caller's vendor and project; the client
 * only names the page and step.
 */
export async function saveLandingPageTemplateFromStep(input: { pageId: unknown; stepId?: unknown; name: unknown }) {
  const scope = await editorScope();
  const name = normalizeTemplateName(input.name);
  if (!name) throw new LandingPageTemplateInputError("name_invalid");
  const page = await scopedPage(scope, input.pageId);
  const source = stepDocument(page.draftContent, input.stepId ?? null);
  if (!source) throw new LandingPageTemplateInputError("step_invalid");
  const content = prepareStoredTemplateDocument(source, name);
  if (!content) throw new LandingPageTemplateInputError("content_too_large");
  const changes = templateCustomCodeChanges(scope.actor, content);
  return db().$transaction(async (transaction) => {
    // Serialises saves per vendor so concurrent requests cannot pass the limit.
    await transaction.$executeRaw(Prisma.sql`SELECT pg_advisory_xact_lock(hashtextextended(${`landing-page-template:${scope.vendorId}`}, 0))`);
    const count = await transaction.landingPageTemplate.count({ where: { vendorId: scope.vendorId } });
    if (count >= LANDING_PAGE_TEMPLATE_VENDOR_LIMIT) throw new LandingPageTemplateInputError("limit_reached");
    const created = await transaction.landingPageTemplate.create({
      data: { vendorId: scope.vendorId, name, content: content as unknown as Prisma.InputJsonValue, sourcePageId: page.id, createdById: scope.userId },
      select: { id: true, name: true },
    });
    // Same audit shape as `recordFunnelCustomCodeSave` (location, change, fields, bytes; never the code).
    if (changes.length) await transaction.auditLog.create({ data: {
      vendorId: scope.vendorId, actorId: scope.userId, action: "funnel_custom_code_saved", targetType: "LandingPageTemplate", targetId: created.id,
      after: { operation: "save_template", sourcePageId: page.id, changes: changes.map(({ location, kind, change, fields, bytes }) => ({ location, kind, change, fields, bytes })) } as Prisma.InputJsonValue,
    } });
    return created;
  }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted });
}

/*
 * Rename and delete are vendor-level on purpose: a template belongs to the
 * vendor, not to a sales project, so they need the manager role but no
 * selected project and also work from the read-only aggregate overview.
 * Saving, applying and creating touch project-scoped pages and do need one.
 */
export async function renameLandingPageTemplate(input: { templateId: unknown; name: unknown }) {
  const { vendorId } = await managerVendor();
  const id = identifier(input.templateId);
  const name = normalizeTemplateName(input.name);
  if (!name) throw new LandingPageTemplateInputError("name_invalid");
  if (!id) throw new LandingPageTemplateNotFoundError();
  const updated = await db().landingPageTemplate.updateMany({ where: { id, vendorId }, data: { name } });
  if (updated.count !== 1) throw new LandingPageTemplateNotFoundError();
  return { id, name };
}

export async function deleteLandingPageTemplate(templateId: unknown) {
  const { vendorId } = await managerVendor();
  const id = identifier(templateId);
  if (!id) throw new LandingPageTemplateNotFoundError();
  const deleted = await db().landingPageTemplate.deleteMany({ where: { id, vendorId } });
  if (deleted.count !== 1) throw new LandingPageTemplateNotFoundError();
  return { id };
}

/**
 * Replaces one step's page with a template, through the same path as
 * 「更換模板」: `replaceFunnelStepPage` keeps the step's commerce binding and
 * records the template, and `saveLandingPageDraft` validates bindings and
 * compare-and-swaps on the page revision the merchant saw.
 */
export async function applyLandingPageTemplateToStep(input: { pageId: unknown; stepId: unknown; revision: unknown; source: LandingPageTemplateSource }) {
  const scope = await editorScope();
  const revision = typeof input.revision === "number" && Number.isSafeInteger(input.revision) && input.revision > 0 ? input.revision : null;
  if (!revision) throw new LandingPageConflictError();
  const page = await scopedPage(scope, input.pageId);
  if (page.revision !== revision) throw new LandingPageConflictError();
  const funnel = parseFunnelStepPages(page.draftContent);
  if (!funnel) throw new LandingPageTemplateInputError("funnel_required");
  const stepId = identifier(input.stepId);
  const step = stepId ? funnel.flow.steps.find((item) => item.id === stepId) : undefined;
  if (!step || step.isSystem) throw new LandingPageTemplateInputError("step_invalid");
  if (input.source.kind === "platform" && !platformTemplateFits(funnel.flow.goal, step.type, input.source.id)) {
    throw new LandingPageTemplateInputError("template_incompatible");
  }
  const { document, recordedId } = await resolveTemplate(scope.vendorId, input.source, funnel.pages[step.id]!.id);
  const replaced = replaceFunnelStepPage(funnel, step.id, document, recordedId);
  if (!replaced.ok) throw new LandingPageTemplateInputError("content_invalid");
  assertDraftWithinLimit(replaced.state);
  // saveLandingPageDraft runs the #499 custom-code gate (session actor, old vs new draft) and its audit.
  return saveLandingPageDraft({
    id: page.id, revision, name: page.name, slug: page.slug,
    formId: page.draftFormId, liveId: page.draftLiveId, content: replaced.state,
  }, { auditOperation: "apply_template" });
}

/** The step a new site's template goes to; adds one when the goal's default flow has none that fits. */
function templateTargetStep(content: FunnelStepPages, source: LandingPageTemplateSource): { content: FunnelStepPages; stepId: string } | null {
  const goal = content.flow.goal;
  const fits = (type: FunnelStepType) => source.kind === "mine" || platformTemplateFits(goal, type, source.id);
  const existing = content.flow.steps.find((step) => !step.isSystem && fits(step.type));
  if (existing) return { content, stepId: existing.id };
  const type = FUNNEL_STEP_TYPES.find((candidate) => candidate !== "inactive_page" && isFunnelStepTypeAddableForGoal(goal, candidate) && (source.kind === "mine" ? candidate === "info_page" : fits(candidate)));
  if (!type || type === "inactive_page") return null;
  const added = addFunnelStepPage(content, { name: "範本頁面", path: "page", type, templateSource: "blank" }, 0);
  if (!added.ok) return null;
  const step = added.state.flow.steps.find((item) => !content.flow.steps.some((old) => old.id === item.id));
  return step ? { content: added.state, stepId: step.id } : null;
}

/**
 * Creates a site the same way 「建立一頁式網站」 does (goal flow + createLandingPage),
 * with the template on its first fitting step. The content is built here;
 * the client only sends the name, URL, goal, currency and template reference.
 */
export async function createLandingPageFromTemplate(input: { name: unknown; slug: unknown; goal: unknown; currency: unknown; source: LandingPageTemplateSource }) {
  const scope = await editorScope();
  const name = typeof input.name === "string" ? input.name.trim() : "";
  const slug = typeof input.slug === "string" ? input.slug.trim() : "";
  const goal = input.goal === "audience" || input.goal === "sell" || input.goal === "custom" || input.goal === "webinar" ? input.goal : null;
  const currency = typeof input.currency === "string" && /^[A-Z]{3}$/u.test(input.currency) ? input.currency : "TWD";
  if (!name || !slug || !goal) throw new LandingPageTemplateInputError("create_invalid");
  if (input.source.kind === "platform") {
    const item = getFunnelTemplateGalleryItem(identifier(input.source.id) ?? "");
    if (!item) throw new LandingPageTemplateNotFoundError();
    if (item.goal !== goal) throw new LandingPageTemplateInputError("template_incompatible");
  }
  const initial = createGoalFunnelStepPages({ id: "funnel_flow", name, goal, domain: slug, currency });
  if (!initial) throw new LandingPageTemplateInputError("create_invalid");
  const target = templateTargetStep(initial, input.source);
  if (!target) throw new LandingPageTemplateInputError("template_incompatible");
  const { document, recordedId } = await resolveTemplate(scope.vendorId, input.source, target.content.pages[target.stepId]!.id);
  const replaced = replaceFunnelStepPage(target.content, target.stepId, document, recordedId);
  if (!replaced.ok) throw new LandingPageTemplateInputError("content_invalid");
  const active = switchFunnelStep(replaced.state, target.stepId);
  const content = active.ok ? active.state : replaced.state;
  assertDraftWithinLimit(content);
  // createLandingPage runs the #499 custom-code gate (session actor) and its audit.
  const created = await createLandingPage({ name, slug, formId: null, liveId: null, content }, { auditOperation: "create_from_template" });
  return { id: created.id, stepId: target.stepId };
}
