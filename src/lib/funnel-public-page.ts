import type { PageDocument } from "@/lib/funnel-page-document";
import { parseFunnelStepPages, type FunnelStepPages } from "@/lib/funnel-step-pages";

/** Public routes always use the first step, never the editor's last selection. */
export function getPublicFunnelPage(state: FunnelStepPages, stepPath?: string): PageDocument | null {
  const parsed = parseFunnelStepPages(state);
  if (!parsed) return null;
  const step = stepPath
    ? parsed.flow.steps.find((candidate) => candidate.path === stepPath)
    : parsed.flow.steps[0];
  if (!step) return null;
  const page = parsed.pages[step.id];
  return page ? { ...page, flow: parsed.flow } : null;
}

/** Returns only a validated, non-system successor. The public slug comes from
 * the server route, never from authored flow.domain. */
export function getNextPublicFunnelStepPath(state: FunnelStepPages, currentPageId: string, options: { excludeStepIds?: readonly string[] } = {}): string | null {
  const parsed = parseFunnelStepPages(state);
  if (!parsed) return null;
  const currentIndex = parsed.flow.steps.findIndex((step) => parsed.pages[step.id]?.id === currentPageId);
  if (currentIndex < 0) return null;
  const excluded = new Set(options.excludeStepIds ?? []);
  return parsed.flow.steps.slice(currentIndex + 1).find((step) => !step.isSystem && !excluded.has(step.id))?.path ?? null;
}
