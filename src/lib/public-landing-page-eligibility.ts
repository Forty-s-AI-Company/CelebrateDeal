import type { Prisma } from "@prisma/client";
import { parseLandingPageContent, type LandingPageContent } from "@/lib/landing-page-content";
import { parsePageDocument, type PageDocument } from "@/lib/funnel-page-document";
import { parseFunnelStepPages, type FunnelStepPages } from "@/lib/funnel-step-pages";
import { getFunnelStepCatalog, type FunnelStepGroup, type FunnelStepType } from "@/lib/funnel-flow";
import { pageDocumentCommerceKinds, pageDocumentHasCommerce, type PageDocumentCommerceKind } from "@/lib/funnel-registration-surface";

/**
 * Public-URL eligibility shared by the full public loader and the proxy's
 * pre-stream HTTP status check. Keep this module free of auth, commerce and
 * other request-scoped imports: the proxy lazy-loads it for every `/lp`
 * document request.
 */

/** Legacy (schema v1) documents remain readable: published legacy versions render until republished, and legacy drafts open converted in the editor. */
export type LandingPageStoredContent = LandingPageContent | PageDocument | FunnelStepPages;

export const MAX_LANDING_PAGE_SLUG_LENGTH = 100;
export const PUBLIC_LIVE_STATUSES = new Set(["scheduled", "live", "ended"]);

/** Merchant-only reason codes. Never render these on an anonymous response. */
export type PublicLandingPageUnavailableReason =
  | "invalid_slug"
  | "not_unique"
  | "version_mismatch"
  | "invalid_content"
  | "form_unavailable"
  | "live_unavailable"
  /** An independently published audience Funnel bound to a live of an unpublished project. */
  | "live_requires_published_project";

export function normalizeLandingPageSlug(value: string) {
  const trimmed = value.trim().toLowerCase();
  return trimmed.length > 0 && trimmed.length <= MAX_LANDING_PAGE_SLUG_LENGTH && /^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(trimmed)
    ? trimmed
    : null;
}

/**
 * 公開網址 `/lp/<slug>` 不可冒充平台頁面（登入、後台、客服、驗證等），避免含
 * 自訂程式碼的頁面被包裝成平台流程。只在「新設定」slug 時檢查；既有頁面沿用
 * 原 slug 儲存不受影響，公開載入也不受影響。
 */
export const RESERVED_LANDING_PAGE_SLUGS: ReadonlySet<string> = new Set([
  "login", "logout", "signin", "sign-in", "signout", "sign-out", "signup", "sign-up", "register", "registration",
  "admin", "administrator", "account", "accounts", "dashboard", "settings", "support", "help", "verify", "verify-email", "verify-email-change",
  "verification", "password", "password-reset", "reset-password", "forgot-password", "auth", "oauth", "sso", "mfa", "2fa",
  "security", "billing", "checkout", "payment", "payments", "api", "www", "policies", "privacy", "terms", "official",
]);

export function isReservedLandingPageSlug(slug: string): boolean {
  const normalized = slug.trim().toLowerCase();
  return RESERVED_LANDING_PAGE_SLUGS.has(normalized) || normalized.includes("celebratedeal");
}

export function isWebinarContent(content: LandingPageStoredContent) {
  return "flow" in content && content.flow?.goal === "webinar";
}

export function invalidWebinarContainer(content: LandingPageStoredContent) {
  return isWebinarContent(content) && !("pages" in content);
}

/** Finds every validated registration action without relying on editor component details. */
export function registrationFormIdsInContent(content: LandingPageStoredContent) {
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

/**
 * Owner decision 2026-10-24: a lead-capture ("audience") Funnel is published
 * on its own, like a systeme.io funnel. Its public URL does not wait for the
 * sales project; every other goal (sell, webinar, custom, legacy documents)
 * still needs a published project.
 */
export const INDEPENDENT_PUBLISH_FUNNEL_GOAL = "audience";

/** "audience" is merchant-declared, so independence also requires lead-only steps. */
const INDEPENDENT_STEP_GROUPS: ReadonlySet<FunnelStepGroup> = new Set(["audience", "general", "system"]);
const NON_INDEPENDENT_STEP_TYPES = getFunnelStepCatalog().filter((step) => !INDEPENDENT_STEP_GROUPS.has(step.group)).map((step) => step.type);

const PUBLISHED_SALES_PROJECT = { status: "published", publishedAt: { not: null } } as const;

/**
 * Project gate of every public Funnel read: the sales project is published,
 * or the published version is an independent audience Funnel of a project
 * that is not archived. The version's `flow.goal` and step types are matched
 * inside the same SQL statement, so the proxy check stays one indexed lookup.
 * Per-page commerce cannot be expressed as a JSON path; callers that parse
 * the content re-check everything with {@link publicProjectGateSatisfied},
 * which is authoritative and fails closed.
 *
 * Known trade-off (accepted for the beta): the database reads the published
 * version's JSONB for the path checks on every `/lp` document request. If
 * that cost matters, persist a boolean on LandingPageVersion at publish time
 * (forward migration) and match it here instead.
 */
export function publicFunnelProjectGateWhere(): Prisma.LandingPageWhereInput {
  return {
    OR: [
      { project: { is: PUBLISHED_SALES_PROJECT } },
      {
        project: { is: { status: { not: "archived" } } },
        publishedVersion: { is: independentAudienceVersionWhere() },
      },
    ],
  };
}

/** SQL pre-filter of a version that may be public without its project: audience goal, lead-only steps. */
export function independentAudienceVersionWhere(): Prisma.LandingPageVersionWhereInput {
  return {
    content: { path: ["flow", "goal"], equals: INDEPENDENT_PUBLISH_FUNNEL_GOAL },
    NOT: NON_INDEPENDENT_STEP_TYPES.map((type) => ({ content: { path: ["flow", "steps"], array_contains: [{ type }] } })),
  };
}

/**
 * Published pages of a vendor that are public only through independent
 * audience publication: not archived, project neither published nor archived,
 * published version passing the SQL pre-filter and bound to no live (a live
 * keeps the page closed until its project publishes). Callers re-check the
 * parsed content with {@link isIndependentlyPublishedFunnel}.
 */
export function independentlyPublishedPageCandidatesWhere(vendorId: string): Prisma.LandingPageWhereInput {
  return {
    vendorId,
    status: "published",
    publishedVersionId: { not: null },
    archivedAt: null,
    project: { is: { status: { not: "archived" }, NOT: PUBLISHED_SALES_PROJECT } },
    publishedVersion: { is: { vendorId, liveId: null, ...independentAudienceVersionWhere() } },
  };
}

/** The slug is globally unique; the Funnel is published and passes the project gate. */
export function publicLandingPageCandidateWhere(slug: string): Prisma.LandingPageWhereInput {
  return {
    slug,
    status: "published",
    publishedVersionId: { not: null },
    archivedAt: null,
    ...publicFunnelProjectGateWhere(),
  };
}

export function isPublishedSalesProject(project: { status: string; publishedAt: Date | null } | null | undefined) {
  return Boolean(project && project.status === "published" && project.publishedAt);
}

/** A multi-step Funnel whose goal is audience (merchant-declared, not yet structural). */
export function isAudienceFunnel(content: LandingPageStoredContent | null | undefined): content is FunnelStepPages {
  return Boolean(content && "pages" in content && "flow" in content && content.flow.goal === INDEPENDENT_PUBLISH_FUNNEL_GOAL);
}

/**
 * Structural guarantee for publishing without a sales project: the goal is
 * audience, every step is a lead or general step, and no page carries a
 * commerce binding, payment block or checkout form.
 */
export function isIndependentlyPublishedFunnel(content: LandingPageStoredContent | null | undefined) {
  if (!isAudienceFunnel(content)) return false;
  if (content.flow.steps.some((step) => NON_INDEPENDENT_STEP_TYPES.includes(step.type))) return false;
  return !Object.values(content.pages).some((document) => pageDocumentHasCommerce(document));
}

export type IndependentPublishBlocker =
  | { kind: "step"; stepId: string; stepName: string; stepType: FunnelStepType; group: FunnelStepGroup }
  | { kind: "commerce"; stepId: string; stepName: string; commerce: PageDocumentCommerceKind[] };

/**
 * Why an audience Funnel cannot be public without its project, by step and
 * page, in step order. Empty exactly when {@link isIndependentlyPublishedFunnel}
 * holds; not meaningful for other goals.
 */
export function independentPublishBlockers(content: FunnelStepPages): IndependentPublishBlocker[] {
  const groups = new Map(getFunnelStepCatalog().map((step) => [step.type, step.group]));
  const blockers: IndependentPublishBlocker[] = [];
  for (const step of content.flow.steps) {
    const group = groups.get(step.type) ?? "sales";
    if (!INDEPENDENT_STEP_GROUPS.has(group)) blockers.push({ kind: "step", stepId: step.id, stepName: step.name, stepType: step.type, group });
  }
  for (const step of content.flow.steps) {
    const document = content.pages[step.id];
    const commerce = document ? pageDocumentCommerceKinds(document) : [];
    if (commerce.length) blockers.push({ kind: "commerce", stepId: step.id, stepName: step.name, commerce });
  }
  // Pages that no step references still reach the public renderer's checks.
  const stepIds = new Set(content.flow.steps.map((step) => step.id));
  for (const [pageKey, document] of Object.entries(content.pages)) {
    if (stepIds.has(pageKey)) continue;
    const commerce = pageDocumentCommerceKinds(document);
    if (commerce.length) blockers.push({ kind: "commerce", stepId: pageKey, stepName: pageKey, commerce });
  }
  return blockers;
}

/** Code-side mirror of {@link publicFunnelProjectGateWhere} on parsed content; authoritative. */
export function publicProjectGateSatisfied(
  project: { status: string; publishedAt: Date | null } | null | undefined,
  content: LandingPageStoredContent | null | undefined,
) {
  if (isPublishedSalesProject(project)) return true;
  return Boolean(project && project.status !== "archived" && isIndependentlyPublishedFunnel(content));
}

type CandidateVersion = { vendorId: string; pageId: string; content: unknown; formId: string | null };

/** Validates the published version and returns its content plus every form it needs. */
export function publishedLandingPageContent<V extends CandidateVersion>(page: { id: string; vendorId: string; publishedAt: Date | null; publishedVersion: V | null }):
  | { version: V; publishedAt: Date; content: LandingPageStoredContent; formIds: string[] }
  | { reason: PublicLandingPageUnavailableReason } {
  const version = page.publishedVersion;
  if (!version || !page.publishedAt || version.vendorId !== page.vendorId || version.pageId !== page.id) return { reason: "version_mismatch" };
  const content = parseFunnelStepPages(version.content) ?? parsePageDocument(version.content) ?? parseLandingPageContent(version.content);
  if (!content || invalidWebinarContainer(content)) return { reason: "invalid_content" };
  const formIds = registrationFormIdsInContent(content);
  if (version.formId) formIds.add(version.formId);
  return { version, publishedAt: page.publishedAt, content, formIds: [...formIds] };
}

/** A bound live must belong to the same tenant/project, be public and own every referenced form. */
export function publicLiveBindingValid(
  page: { vendorId: string; projectId: string | null },
  liveId: string | null,
  live: { vendorId: string; projectId: string | null; status: string; formId: string | null } | null | undefined,
  formIds: readonly string[],
) {
  if (!liveId) return true;
  return Boolean(live
    && live.vendorId === page.vendorId
    && live.projectId === page.projectId
    && PUBLIC_LIVE_STATUSES.has(live.status)
    && live.formId
    && formIds.length > 0
    && formIds.every((formId) => formId === live.formId));
}
