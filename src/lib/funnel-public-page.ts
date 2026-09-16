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
