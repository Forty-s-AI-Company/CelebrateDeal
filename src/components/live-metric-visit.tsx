"use client";

import { useEffect, useRef } from "react";
import { createMetricVisitClient } from "@/lib/live-metric-visit-client";

/** A logical page visit owns one driver, including React effect replays. This
 * invisible collector never changes playback or claims complete coverage.
 */
export function LiveMetricVisit({ vendorId, liveId, eventId }: { vendorId: string; liveId: string; eventId: string }) {
  const saved = useRef<{ scope: string; client: ReturnType<typeof createMetricVisitClient> } | null>(null);
  useEffect(() => {
    const scope = JSON.stringify([vendorId, liveId, eventId]);
    if (!saved.current || saved.current.scope !== scope) saved.current = { scope, client: createMetricVisitClient(vendorId, liveId, { eventId }) };
    const client = saved.current.client;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let failures = 0;
    const delays = [1000, 5000, 15000];
    async function collect() {
      const result = await client.collect();
      if (stopped || result.status === "recorded" || !result.retryable || failures >= delays.length) return;
      timer = setTimeout(() => { void collect(); }, delays[failures++]);
    }
    void collect();
    return () => { stopped = true; if (timer !== undefined) clearTimeout(timer); };
  }, [vendorId, liveId, eventId]);
  return null;
}
