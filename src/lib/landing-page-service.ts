import { Prisma, PrismaClient } from "@prisma/client";
import { requireVendorManagerContext } from "@/lib/auth";
import { getDb } from "@/lib/db";
import {
  createEmptyLandingPageContent,
  parseLandingPageContent,
  type LandingPageContent,
  type LandingPageFormReference,
  type LandingPageLiveReference,
  type LandingPageRenderContext,
} from "@/lib/landing-page-content";
import { getSalesProjectScope, requireEditableSalesProjectScope } from "@/lib/sales-project-scope";

const MAX_NAME_LENGTH = 160;
const MAX_SLUG_LENGTH = 100;
const MAX_IDENTIFIER_LENGTH = 100;
const PUBLIC_LIVE_STATUSES = new Set(["scheduled", "live", "ended"]);

export type LandingPageActionState = {
  status: "success" | "error";
  message: string;
  id?: string;
  revision?: number;
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
  content: LandingPageContent | null;
  formId: string | null;
  liveId: string | null;
  versions: Array<{ id: string; version: number; createdAt: Date }>;
};

export type LandingPageEditorData = {
  page: LandingPageEditorPage;
  forms: LandingPageFormReference[];
  lives: LandingPageLiveReference[];
  context: LandingPageRenderContext;
};

export type LandingPageList = {
  pages: LandingPageSummary[];
  scope: { projectId: string | null; projectName: string | null; isAggregate: boolean; isLegacyWorkspace: boolean };
};

export type PublicLandingPage = {
  id: string;
  slug: string;
  content: LandingPageContent;
  context: LandingPageRenderContext;
  publishedAt: Date;
};

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

type FormRecord = { id: string; slug: string; name: string; vendorId?: string; projectId?: string | null; isActive?: boolean };
type LiveRecord = { id: string; slug: string; title: string; status: string; scheduledAt: Date; formId?: string | null; vendorId?: string; projectId?: string | null };

type LandingPageDb = Pick<PrismaClient, "landingPage" | "landingPageVersion" | "registrationForm" | "live">;

function db() {
  return getDb();
}

function identifier(value: string | null | undefined) {
  const trimmed = value?.trim() ?? "";
  return trimmed && trimmed.length <= MAX_IDENTIFIER_LENGTH && /^[A-Za-z0-9_-]+$/u.test(trimmed) ? trimmed : null;
}

function pageSlug(value: string) {
  const trimmed = value.trim().toLowerCase();
  return trimmed.length > 0 && trimmed.length <= MAX_SLUG_LENGTH && /^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(trimmed)
    ? trimmed
    : null;
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
  const content = parseLandingPageContent(value);
  if (!content) throw new LandingPageInputError();
  return content;
}

/** Finds every validated registration action without relying on editor component details. */
export function registrationFormIdsInContent(content: LandingPageContent) {
  const ids = new Set<string>();
  const visit = (value: unknown) => {
    if (Array.isArray(value)) {
      value.forEach(visit);
      return;
    }
    if (!value || typeof value !== "object") return;
    const object = value as Record<string, unknown>;
    if (object.type === "registration" && typeof object.formId === "string") ids.add(object.formId);
    Object.values(object).forEach(visit);
  };
  visit(content);
  return ids;
}

function toFormReference(form: FormRecord): LandingPageFormReference {
  return { id: form.id, slug: form.slug, name: form.name };
}

function toLiveReference(live: LiveRecord): LandingPageLiveReference {
  const status = live.status;
  if (!PUBLIC_LIVE_STATUSES.has(status)) throw new LandingPageInputError("landing_page_live_not_public");
  return {
    id: live.id,
    slug: live.slug,
    title: live.title,
    status: status as LandingPageLiveReference["status"],
    scheduledAt: live.scheduledAt.toISOString(),
    ...(live.formId ? { formId: live.formId } : {}),
  };
}

async function editorProject() {
  const { auth, vendor } = await requireVendorManagerContext();
  const scope = await requireEditableSalesProjectScope(auth.user.id, vendor.id);
  if (!scope.projectId) throw new LandingPageScopeError();
  return { vendorId: vendor.id, projectId: scope.projectId };
}

async function validateBindings(
  database: LandingPageDb,
  input: { vendorId: string; projectId: string; content: LandingPageContent; formId: string | null; liveId: string | null },
) {
  const referencedFormIds = registrationFormIdsInContent(input.content);
  if (input.formId) referencedFormIds.add(input.formId);
  const formIds = [...referencedFormIds];
  const forms = formIds.length === 0 ? [] : await database.registrationForm.findMany({
    where: { vendorId: input.vendorId, projectId: input.projectId, isActive: true, id: { in: formIds } },
    select: { id: true, slug: true, name: true },
  });
  if (forms.length !== formIds.length) throw new LandingPageInputError("landing_page_form_invalid");

  let live: LiveRecord | null = null;
  if (input.liveId) {
    live = await database.live.findFirst({
      where: { id: input.liveId, vendorId: input.vendorId, projectId: input.projectId, status: { in: [...PUBLIC_LIVE_STATUSES] } },
      select: { id: true, slug: true, title: true, status: true, scheduledAt: true, formId: true },
    });
    if (!live) throw new LandingPageInputError("landing_page_live_invalid");
    const liveFormId = live.formId;
    if (!liveFormId || formIds.length === 0 || formIds.some((formId) => formId !== liveFormId)) {
      throw new LandingPageInputError("landing_page_live_form_mismatch");
    }
  }
  return { forms, live };
}

async function requireScopedPage(database: LandingPageDb, scope: { vendorId: string; projectId: string }, pageId: string) {
  const id = identifier(pageId);
  if (!id) throw new LandingPageNotFoundError();
  const page = await database.landingPage.findFirst({
    where: { id, vendorId: scope.vendorId, projectId: scope.projectId },
    select: { id: true, vendorId: true, projectId: true, name: true, slug: true, draftContent: true, draftFormId: true, draftLiveId: true, status: true, publishedVersionId: true, revision: true, publishedAt: true, updatedAt: true },
  });
  if (!page) throw new LandingPageNotFoundError();
  return page;
}

export async function listLandingPages(): Promise<LandingPageList> {
  const { auth, vendor } = await requireVendorManagerContext();
  const scope = await getSalesProjectScope(auth.user.id, vendor.id);
  const pages = await db().landingPage.findMany({
    where: { vendorId: vendor.id, ...(scope.projectId ? { projectId: scope.projectId } : {}) },
    select: { id: true, name: true, slug: true, status: true, revision: true, publishedAt: true, updatedAt: true },
    orderBy: [{ updatedAt: "desc" }, { id: "asc" }],
  });
  return {
    pages: pages.map((page) => ({ id: page.id, name: page.name, slug: page.slug, status: page.status, revision: page.revision, publishedAt: page.publishedAt, updatedAt: page.updatedAt })),
    scope,
  };
}

export async function createLandingPage(input: Omit<LandingPageDraftInput, "id" | "revision">) {
  const scope = await editorProject();
  const name = pageName(input.name);
  const slug = pageSlug(input.slug);
  const content = inputContent(input.content);
  const formId = input.formId ? identifier(input.formId) : null;
  const liveId = input.liveId ? identifier(input.liveId) : null;
  if (!name || !slug || (input.formId && !formId) || (input.liveId && !liveId)) throw new LandingPageInputError();
  await validateBindings(db(), { ...scope, content, formId, liveId });
  return db().landingPage.create({
    data: { vendorId: scope.vendorId, projectId: scope.projectId, name, slug, draftContent: content as Prisma.InputJsonValue, draftFormId: formId, draftLiveId: liveId },
    select: { id: true, vendorId: true, projectId: true, name: true, slug: true, draftContent: true, draftFormId: true, draftLiveId: true, status: true, publishedVersionId: true, revision: true, publishedAt: true, updatedAt: true },
  });
}

export async function saveLandingPageDraft(input: Required<Pick<LandingPageDraftInput, "id" | "revision">> & Omit<LandingPageDraftInput, "id" | "revision">) {
  const scope = await editorProject();
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
  await validateBindings(db(), { ...scope, content, formId, liveId });
  const updated = await db().landingPage.updateMany({
    where: { id, vendorId: scope.vendorId, projectId: scope.projectId, revision },
    data: { name, slug, draftContent: content as Prisma.InputJsonValue, draftFormId: formId, draftLiveId: liveId, revision: { increment: 1 } },
  });
  if (updated.count !== 1) throw new LandingPageConflictError();
  return { id, revision: revision + 1 };
}

export async function getLandingPageForEditor(pageId: string): Promise<LandingPageEditorData> {
  const scope = await editorProject();
  const page = await db().landingPage.findFirst({
    where: { id: identifier(pageId) ?? "", vendorId: scope.vendorId, projectId: scope.projectId },
    select: {
      id: true, name: true, slug: true, status: true, revision: true, publishedAt: true, updatedAt: true, draftContent: true, draftFormId: true, draftLiveId: true,
      versions: { select: { id: true, version: true, createdAt: true }, orderBy: { version: "desc" } },
    },
  });
  if (!page) throw new LandingPageNotFoundError();
  const [forms, lives] = await Promise.all([
    db().registrationForm.findMany({ where: { vendorId: scope.vendorId, projectId: scope.projectId, isActive: true }, select: { id: true, slug: true, name: true }, orderBy: { name: "asc" } }),
    db().live.findMany({ where: { vendorId: scope.vendorId, projectId: scope.projectId, status: { in: [...PUBLIC_LIVE_STATUSES] } }, select: { id: true, slug: true, title: true, status: true, scheduledAt: true, formId: true }, orderBy: { scheduledAt: "desc" } }),
  ]);
  const selectedLive = page.draftLiveId ? lives.find((live) => live.id === page.draftLiveId) ?? null : null;
  const formOptions = forms.map(toFormReference);
  const liveOptions = lives.map(toLiveReference);
  return {
    page: { id: page.id, name: page.name, slug: page.slug, status: page.status, revision: page.revision, publishedAt: page.publishedAt, updatedAt: page.updatedAt, content: parseLandingPageContent(page.draftContent), formId: page.draftFormId, liveId: page.draftLiveId, versions: page.versions ?? [] },
    forms: formOptions,
    lives: liveOptions,
    context: { forms: formOptions, ...(selectedLive ? { live: toLiveReference(selectedLive) } : {}) },
  };
}

export async function publishLandingPage(pageId: string, expectedRevision: number) {
  const scope = await editorProject();
  const id = identifier(pageId);
  const revision = positiveRevision(expectedRevision);
  if (!id || !revision) throw new LandingPageInputError();
  try {
    return await db().$transaction(async (transaction) => {
      const page = await requireScopedPage(transaction, scope, id);
      if (page.revision !== revision) throw new LandingPageConflictError();
      const content = inputContent(page.draftContent);
      await validateBindings(transaction, { ...scope, content, formId: page.draftFormId, liveId: page.draftLiveId });
      const nextVersion = await transaction.landingPageVersion.count({ where: { vendorId: scope.vendorId, pageId: id } }) + 1;
      const version = await transaction.landingPageVersion.create({
        data: { vendorId: scope.vendorId, pageId: id, version: nextVersion, content: content as Prisma.InputJsonValue, formId: page.draftFormId, liveId: page.draftLiveId },
        select: { id: true, version: true, content: true, formId: true, liveId: true, createdAt: true },
      });
      const updated = await transaction.landingPage.updateMany({
        where: { id, vendorId: scope.vendorId, projectId: scope.projectId, revision },
        data: { status: "published", publishedVersionId: version.id, publishedAt: new Date(), unpublishedAt: null, revision: { increment: 1 } },
      });
      if (updated.count !== 1) throw new LandingPageConflictError();
      return { id, revision: revision + 1, version: version.version };
    });
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

export async function rollbackLandingPage(pageId: string, version: number, expectedRevision: number) {
  const scope = await editorProject();
  const id = identifier(pageId);
  const targetVersion = positiveRevision(version);
  const revision = positiveRevision(expectedRevision);
  if (!id || !targetVersion || !revision) throw new LandingPageInputError();
  const versionRecord = await db().landingPageVersion.findFirst({
    where: { pageId: id, vendorId: scope.vendorId, version: targetVersion, page: { is: { projectId: scope.projectId } } },
    select: { id: true, version: true, content: true, formId: true, liveId: true, createdAt: true },
  });
  if (!versionRecord) throw new LandingPageNotFoundError();
  const content = inputContent(versionRecord.content);
  await validateBindings(db(), { ...scope, content, formId: versionRecord.formId, liveId: versionRecord.liveId });
  const updated = await db().landingPage.updateMany({
    where: { id, vendorId: scope.vendorId, projectId: scope.projectId, revision },
    data: { draftContent: content as Prisma.InputJsonValue, draftFormId: versionRecord.formId, draftLiveId: versionRecord.liveId, revision: { increment: 1 } },
  });
  if (updated.count !== 1) throw new LandingPageConflictError();
  return { id, revision: revision + 1 };
}

async function availableCopySlug(database: LandingPageDb, slug: string) {
  const base = slug.slice(0, MAX_SLUG_LENGTH - 5) || "page";
  for (let suffix = 1; suffix <= 100; suffix += 1) {
    const candidate = `${base}-copy${suffix === 1 ? "" : `-${suffix}`}`;
    const existing = await database.landingPage.findFirst({ where: { slug: candidate }, select: { id: true } });
    if (!existing) return candidate;
  }
  throw new LandingPageConflictError();
}

export async function duplicateLandingPage(pageId: string) {
  const scope = await editorProject();
  const page = await requireScopedPage(db(), scope, pageId);
  const content = inputContent(page.draftContent);
  await validateBindings(db(), { ...scope, content, formId: page.draftFormId, liveId: page.draftLiveId });
  const slug = await availableCopySlug(db(), page.slug);
  const name = `${page.name} 副本`.slice(0, MAX_NAME_LENGTH);
  return db().landingPage.create({
    data: { vendorId: scope.vendorId, projectId: scope.projectId, name, slug, draftContent: content as Prisma.InputJsonValue, draftFormId: page.draftFormId, draftLiveId: page.draftLiveId },
    select: { id: true, vendorId: true, projectId: true, name: true, slug: true, draftContent: true, draftFormId: true, draftLiveId: true, status: true, publishedVersionId: true, revision: true, publishedAt: true, updatedAt: true },
  });
}

export async function loadPublicLandingPage(slug: string): Promise<PublicLandingPage | null> {
  // The version content and bindings are immutable. Referenced forms and live
  // sessions remain live resources, so their tenant/project/public readiness is
  // deliberately rechecked here and a stale reference fails closed.
  const safeSlug = pageSlug(slug);
  if (!safeSlug) return null;
  const page = await db().landingPage.findFirst({
    where: { slug: safeSlug, status: "published", publishedVersionId: { not: null }, project: { is: { status: "published", publishedAt: { not: null } } } },
    select: {
      id: true, vendorId: true, projectId: true, slug: true, publishedAt: true,
      publishedVersion: { select: { id: true, vendorId: true, pageId: true, version: true, content: true, formId: true, liveId: true, createdAt: true, live: { select: { id: true, slug: true, title: true, status: true, scheduledAt: true, formId: true, vendorId: true, projectId: true } } } },
    },
  });
  if (!page?.publishedVersion || !page.publishedAt || page.publishedVersion.vendorId !== page.vendorId || page.publishedVersion.pageId !== page.id) return null;
  const content = parseLandingPageContent(page.publishedVersion.content);
  if (!content) return null;
  const formIds = registrationFormIdsInContent(content);
  if (page.publishedVersion.formId) formIds.add(page.publishedVersion.formId);
  const ids = [...formIds];
  const forms = ids.length === 0 ? [] : await db().registrationForm.findMany({
    where: { id: { in: ids }, vendorId: page.vendorId, projectId: page.projectId, isActive: true },
    select: { id: true, slug: true, name: true },
  });
  if (forms.length !== ids.length) return null;
  const live = page.publishedVersion.live;
  if (page.publishedVersion.liveId && (!live || live.vendorId !== page.vendorId || live.projectId !== page.projectId || !PUBLIC_LIVE_STATUSES.has(live.status) || !live.formId || ids.length === 0 || ids.some((formId) => formId !== live.formId))) return null;
  return {
    id: page.id,
    slug: page.slug,
    content,
    context: { pageId: page.id, forms: forms.map(toFormReference), ...(live ? { live: toLiveReference(live) } : {}) },
    publishedAt: page.publishedAt,
  };
}

export { createEmptyLandingPageContent };
