import { parseFunnelStepPages, type FunnelStepPages } from "@/lib/funnel-step-pages";

export type FunnelStepPagesHistory = { past: FunnelStepPages[]; future: FunnelStepPages[] };

const copy = (state: FunnelStepPages) => structuredClone(state);

export function createFunnelStepPagesHistory(): FunnelStepPagesHistory { return { past: [], future: [] }; }

export function recordFunnelStepPages(history: FunnelStepPagesHistory, previous: FunnelStepPages): FunnelStepPagesHistory {
  const parsed = parseFunnelStepPages(previous);
  return parsed ? { past: [...history.past, copy(parsed)], future: [] } : history;
}

export function undoFunnelStepPages(history: FunnelStepPagesHistory, current: FunnelStepPages): { history: FunnelStepPagesHistory; state: FunnelStepPages } | null {
  const previous = history.past.at(-1);
  const parsedCurrent = parseFunnelStepPages(current);
  return previous && parsedCurrent ? { state: copy(previous), history: { past: history.past.slice(0, -1), future: [copy(parsedCurrent), ...history.future] } } : null;
}

export function redoFunnelStepPages(history: FunnelStepPagesHistory, current: FunnelStepPages): { history: FunnelStepPagesHistory; state: FunnelStepPages } | null {
  const next = history.future[0];
  const parsedCurrent = parseFunnelStepPages(current);
  return next && parsedCurrent ? { state: copy(next), history: { past: [...history.past, copy(parsedCurrent)], future: history.future.slice(1) } } : null;
}
