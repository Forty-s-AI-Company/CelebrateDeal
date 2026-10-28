"use client";

import { createContext, useContext, useEffect, useState } from "react";
import { funnelEventSchedule, type FunnelEventSchedule } from "@/lib/funnel-event-time";

/**
 * I-5 render context: the page's event schedule plus the server render time.
 * `initialNow` comes from the server (public routes) so the first client render
 * shows exactly what the server rendered (no hydration drift); surfaces
 * without it (editor) render a neutral state until mounted.
 */
export type FunnelEventRenderContext = { schedule: FunnelEventSchedule; initialNow: number | null };

export const FunnelEventContext = createContext<FunnelEventRenderContext>({ schedule: funnelEventSchedule({}), initialNow: null });

export function useFunnelEvent(): FunnelEventRenderContext {
  return useContext(FunnelEventContext);
}

/**
 * Current time, starting at the server render time and ticking every
 * `intervalMs` after mount. Returns null until a time is known.
 */
export function useFunnelNow(intervalMs: number, enabled = true): number | null {
  const { initialNow } = useFunnelEvent();
  const [now, setNow] = useState<number | null>(initialNow);
  useEffect(() => {
    if (!enabled) return;
    const tick = () => setNow(Date.now());
    const first = window.setTimeout(tick, 0);
    const timer = window.setInterval(tick, intervalMs);
    return () => { window.clearTimeout(first); window.clearInterval(timer); };
  }, [intervalMs, enabled]);
  return now;
}
