import type { PrismaClient } from "@prisma/client";
import { getDb } from "@/lib/db";
import { parseFunnelOperations } from "@/lib/funnel-operations";
import { assignFunnelExperiment, decidePublicFunnelRuntime } from "@/lib/funnel-runtime";
import type { FunnelStepPages } from "@/lib/funnel-step-pages";
import {
  normalizeLandingPageSlug,
  publicLandingPageCandidateWhere,
  type LandingPageStoredContent,
} from "@/lib/public-landing-page-eligibility";

type StatusDb = Pick<PrismaClient, "landingPage">;

function isFunnelStepPages(content: LandingPageStoredContent): content is FunnelStepPages {
  return "pages" in content && "flow" in content;
}

/**
 * Same lookup as getPublicFunnelPage() without re-running
 * parseFunnelStepPages(): the content was already parsed by
 * publishedLandingPageContent(). An empty or missing path means the first step.
 */
function hasPublicFunnelPage(steps: FunnelStepPages, stepPath?: string) {
  const step = stepPath ? steps.flow.steps.find((candidate) => candidate.path === stepPath) : steps.flow.steps[0];
  return Boolean(step && steps.pages[step.id]);
}

/**
 * Pure mirror of the routing decisions in `src/app/lp/[slug]/page.tsx` and
 * `src/app/lp/[slug]/[stepPath]/page.tsx` that end in `notFound()`. Closed
 * and redirect outcomes stay 200 so the route renders them. Keep in sync with
 * those pages: a stricter answer here would hide a working public page.
 */
type RouteInput = {
  pageId: string;
  content: LandingPageStoredContent;
  operations: unknown;
  stepPath?: string;
  visitorId: string;
  now?: Date;
};

/** Like publicFunnelRouteStatus, but also names the step a deadline redirect sends the visitor to. */
export function publicFunnelRouteOutcome(input: RouteInput): { status: 200 | 404; redirectPath?: string } {
  // Root: legacy and single-page documents render. A step path needs Funnel steps.
  if (!isFunnelStepPages(input.content)) return { status: input.stepPath === undefined ? 200 : 404 };
  const steps = input.content;
  let requestedStepId: string;
  if (input.stepPath === undefined) {
    const requested = steps.flow.steps.find((step) => !step.isSystem);
    if (!requested) return { status: 404 };
    requestedStepId = requested.id;
  } else {
    if (!hasPublicFunnelPage(steps, input.stepPath)) return { status: 404 };
    const requested = steps.flow.steps.find((step) => step.path === input.stepPath);
    if (!requested || requested.isSystem) return { status: 404 };
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
  if (decision.status === "unavailable") return { status: 404 };
  if (decision.status === "redirect") return { status: 200, redirectPath: decision.path };
  if (decision.status !== "render" || steps.flow.goal === "webinar") return { status: 200 };
  const rendered = steps.flow.steps.find((step) => step.id === decision.renderedStepId);
  return { status: hasPublicFunnelPage(steps, rendered?.path) ? 200 : 404 };
}

export function publicFunnelRouteStatus(input: RouteInput): 200 | 404 {
  return publicFunnelRouteOutcome(input).status;
}

// Running arms weigh at least 1%, so 2048 probes miss one with probability < 1e-8.
const MAX_REPRESENTATIVE_VISITOR_PROBES = 2048;

/**
 * Deterministic synthetic visitors, one per A/B outcome (no experiment,
 * control, variant), so a merchant diagnosis does not flip between refreshes.
 * Only used for the merchant diagnosis; never issued as a cookie.
 */
export function representativeFunnelVisitorIds(pageId: string, operations: unknown): string[] {
  const parsed = parseFunnelOperations(operations);
  const byArm = new Map<string, string>();
  for (let index = 0; index < MAX_REPRESENTATIVE_VISITOR_PROBES; index += 1) {
    const visitorId = `diagnosis-visitor-${String(index).padStart(6, "0")}`;
    const arm = assignFunnelExperiment(pageId, parsed?.experiment ?? null, visitorId)?.arm ?? "none";
    if (!byArm.has(arm)) byArm.set(arm, visitorId);
    // A running experiment has both arms; every other state has exactly one outcome.
    if (byArm.size >= (parsed?.experiment?.status === "running" ? 2 : 1)) break;
  }
  return [...byArm.values()];
}

/**
 * Read-only pre-stream check for a public `/lp/{slug}[/{stepPath}]` document
 * (F-015 / B05-04). Proxy runs it on every GET/HEAD, including RSC
 * navigations and prefetches, so it is one indexed SQL statement that reads
 * only `slug -> id` and the publication state (page published with a
 * published version, not archived, sales project published). It never reads
 * the published `content` JSON or any related row.
 *
 * Everything else (version/tenant consistency, bound live, step paths,
 * Funnel operations, referenced forms, content validity) is decided by the
 * page, whose `notFound()` runs before any Suspense boundary (`/lp` has no
 * loading.tsx) and therefore still answers HTTP 404. Records nothing, caches
 * nothing, never returns a reason. Database errors propagate so the caller
 * can answer 503 instead of a false 404.
 */
export async function publicLandingPageStatus(pathname: string, database: StatusDb = getDb()): Promise<200 | 404> {
  const segments = pathname.split("/").filter(Boolean);
  if (segments[0] !== "lp" || segments.length < 2 || segments.length > 3) return 404;
  let slug: string;
  try {
    slug = decodeURIComponent(segments[1]!);
    if (segments[2] !== undefined) decodeURIComponent(segments[2]);
  } catch {
    return 404;
  }
  const safeSlug = normalizeLandingPageSlug(slug);
  if (!safeSlug) return 404;
  // Unique slug index; the project condition is part of the same statement.
  const candidates = await database.landingPage.findMany({
    where: publicLandingPageCandidateWhere(safeSlug),
    take: 2,
    select: { id: true },
  });
  return candidates.length === 1 ? 200 : 404;
}
