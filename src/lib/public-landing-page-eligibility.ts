import type { Prisma } from "@prisma/client";
import { parseLandingPageContent, type LandingPageContent } from "@/lib/landing-page-content";
import { parsePageDocument, type PageDocument } from "@/lib/funnel-page-document";
import { parseFunnelStepPages, type FunnelStepPages } from "@/lib/funnel-step-pages";

/**
 * Public-URL eligibility shared by the full public loader and the proxy's
 * pre-stream HTTP status check. Keep this module free of auth, commerce and
 * other request-scoped imports: the proxy lazy-loads it for every `/lp`
 * document request.
 */

/** Existing Puck documents remain readable while new Funnel documents roll out additively. */
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
  | "live_unavailable";

export function normalizeLandingPageSlug(value: string) {
  const trimmed = value.trim().toLowerCase();
  return trimmed.length > 0 && trimmed.length <= MAX_LANDING_PAGE_SLUG_LENGTH && /^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(trimmed)
    ? trimmed
    : null;
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

/** Both the Funnel and its sales project must be published; the slug is globally unique. */
export function publicLandingPageCandidateWhere(slug: string): Prisma.LandingPageWhereInput {
  return {
    slug,
    status: "published",
    publishedVersionId: { not: null },
    archivedAt: null,
    project: { is: { status: "published", publishedAt: { not: null } } },
  };
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
