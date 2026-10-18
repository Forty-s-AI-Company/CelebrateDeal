import type { PrismaClient } from "@prisma/client";
import { getDb } from "@/lib/db";
import { parseFunnelOperations } from "@/lib/funnel-operations";
import { getPublicFunnelPage } from "@/lib/funnel-public-page";
import { decidePublicFunnelRuntime } from "@/lib/funnel-runtime";
import { parseFunnelStepPages, type FunnelStepPages } from "@/lib/funnel-step-pages";
import {
  normalizeLandingPageSlug,
  publicLandingPageCandidateWhere,
  publicLiveBindingValid,
  publishedLandingPageContent,
  type LandingPageStoredContent,
} from "@/lib/public-landing-page-eligibility";

type StatusDb = Pick<PrismaClient, "landingPage" | "registrationForm">;

function isFunnelStepPages(content: LandingPageStoredContent): content is FunnelStepPages {
  return "pages" in content && "flow" in content;
}

/**
 * Pure mirror of the routing decisions in `src/app/lp/[slug]/page.tsx` and
 * `src/app/lp/[slug]/[stepPath]/page.tsx` that end in `notFound()`. Closed
 * and redirect outcomes stay 200 so the route renders them. Keep in sync with
 * those pages: a stricter answer here would hide a working public page.
 */
export function publicFunnelRouteStatus(input: {
  pageId: string;
  content: LandingPageStoredContent;
  operations: unknown;
  stepPath?: string;
  visitorId: string;
  now?: Date;
}): 200 | 404 {
  let steps: FunnelStepPages;
  let requestedStepId: string;
  if (input.stepPath === undefined) {
    if (!isFunnelStepPages(input.content)) return 200;
    steps = input.content;
    const requested = steps.flow.steps.find((step) => !step.isSystem);
    if (!requested) return 404;
    requestedStepId = requested.id;
  } else {
    const parsed = parseFunnelStepPages(input.content);
    if (!parsed || !getPublicFunnelPage(parsed, input.stepPath)) return 404;
    const requested = parsed.flow.steps.find((step) => step.path === input.stepPath);
    if (!requested || requested.isSystem) return 404;
    steps = parsed;
    requestedStepId = requested.id;
  }
  const decision = decidePublicFunnelRuntime({
    pageId: input.pageId,
    requestedStepId,
    steps: steps.flow.steps,
    operations: parseFunnelOperations(input.operations),
    visitorId: input.visitorId,
    now: input.now,
  });
  if (decision.status === "unavailable") return 404;
  if (decision.status !== "render" || steps.flow.goal === "webinar") return 200;
  const rendered = steps.flow.steps.find((step) => step.id === decision.renderedStepId);
  return getPublicFunnelPage(steps, rendered?.path) ? 200 : 404;
}

/**
 * Read-only pre-stream check for a public `/lp/{slug}[/{stepPath}]` document.
 * Looks up the page by its public slug only, records nothing, caches nothing
 * and never returns a reason. Database errors propagate so the caller can
 * answer 503 instead of a false 404.
 */
export async function publicLandingPageStatus(pathname: string, visitorId: string, database: StatusDb = getDb()): Promise<200 | 404> {
  const segments = pathname.split("/").filter(Boolean);
  if (segments[0] !== "lp" || segments.length < 2 || segments.length > 3) return 404;
  let slug: string;
  let stepPath: string | undefined;
  try {
    slug = decodeURIComponent(segments[1]!);
    stepPath = segments[2] === undefined ? undefined : decodeURIComponent(segments[2]);
  } catch {
    return 404;
  }
  const safeSlug = normalizeLandingPageSlug(slug);
  if (!safeSlug) return 404;
  // One slug lookup (unique index) with the published version and its bound
  // live; no presentation, commerce, consultation or video data.
  const candidates = await database.landingPage.findMany({
    where: publicLandingPageCandidateWhere(safeSlug),
    take: 2,
    select: {
      id: true,
      vendorId: true,
      projectId: true,
      publishedAt: true,
      operations: true,
      publishedVersion: {
        select: {
          vendorId: true,
          pageId: true,
          content: true,
          formId: true,
          liveId: true,
          live: { select: { vendorId: true, projectId: true, status: true, formId: true } },
        },
      },
    },
  });
  const page = candidates.length === 1 ? candidates[0] : undefined;
  if (!page) return 404;
  const published = publishedLandingPageContent(page);
  if ("reason" in published) return 404;
  const { version, content, formIds } = published;
  if (!publicLiveBindingValid(page, version.liveId, version.live, formIds)) return 404;
  const status = publicFunnelRouteStatus({ pageId: page.id, content, operations: page.operations, stepPath, visitorId });
  if (status === 404 || formIds.length === 0) return status;
  // Primary-key count, only when the published content references forms.
  const activeForms = await database.registrationForm.count({
    where: { id: { in: formIds }, vendorId: page.vendorId, projectId: page.projectId, isActive: true },
  });
  return activeForms === formIds.length ? 200 : 404;
}
