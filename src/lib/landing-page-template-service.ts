import { randomBytes } from "node:crypto";
import { Prisma } from "@prisma/client";
import { requireVendorManagerContext } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { FUNNEL_STEP_TYPES, isFunnelStepTypeAddableForGoal, type FunnelGoal, type FunnelStepType } from "@/lib/funnel-flow";
import { createGoalFunnelStepPages } from "@/lib/funnel-goal-step-pages";
import { parsePageDocument, type PageDocument } from "@/lib/funnel-page-document";
import { addFunnelStepPage, parseFunnelStepPages, replaceFunnelStepPage, switchFunnelStep, type FunnelStepPages } from "@/lib/funnel-step-pages";
import { getFunnelTemplateGalleryItem, instantiateFunnelTemplate, listFunnelTemplateGallery } from "@/lib/funnel-template-gallery";
import {
  createLandingPage,
  LandingPageConflictError,
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
} from "@/lib/landing-page-template-document";
import { requireEditableSalesProjectScope } from "@/lib/sales-project-scope";

/**
 * 「範本」library: platform templates (code) and merchant templates
 * (`LandingPageTemplate`). Tenant identity is always derived here from the
 * authenticated manager (owner/admin); every input id is bound to that vendor
 * (and, for pages, the selected sales project) in the final query.
 */

export type LandingPageTemplateSource = { kind: "platform" | "mine"; id: string };

export type LandingPageTemplateSummary = {
  id: string;
  name: string;
  content: PageDocument;
  createdAt: string;
  updatedAt: string;
};

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
  return { vendorId: vendor.id, userId: auth.user.id };
}

/** Pages belong to a sales project; the aggregate overview is read-only. */
async function editorScope() {
  const { vendorId, userId } = await managerVendor();
  const scope = await requireEditableSalesProjectScope(userId, vendorId);
  if (!scope.projectId) throw new LandingPageScopeError();
  return { vendorId, userId, projectId: scope.projectId };
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
  return rows.flatMap((row) => {
    const content = readStoredTemplateDocument(row.content);
    return content ? [{ id: row.id, name: row.name, content, createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString() }] : [];
  });
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
  return db().$transaction(async (transaction) => {
    // Serialises saves per vendor so concurrent requests cannot pass the limit.
    await transaction.$executeRaw(Prisma.sql`SELECT pg_advisory_xact_lock(hashtextextended(${`landing-page-template:${scope.vendorId}`}, 0))`);
    const count = await transaction.landingPageTemplate.count({ where: { vendorId: scope.vendorId } });
    if (count >= LANDING_PAGE_TEMPLATE_VENDOR_LIMIT) throw new LandingPageTemplateInputError("limit_reached");
    return transaction.landingPageTemplate.create({
      data: { vendorId: scope.vendorId, name, content: content as unknown as Prisma.InputJsonValue, sourcePageId: page.id, createdById: scope.userId },
      select: { id: true, name: true },
    });
  }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted });
}

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
  return saveLandingPageDraft({
    id: page.id, revision, name: page.name, slug: page.slug,
    formId: page.draftFormId, liveId: page.draftLiveId, content: replaced.state,
  });
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
  const created = await createLandingPage({ name, slug, formId: null, liveId: null, content: active.ok ? active.state : replaced.state });
  return { id: created.id, stepId: target.stepId };
}
