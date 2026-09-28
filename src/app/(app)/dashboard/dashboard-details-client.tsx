"use client";

import { useEffect, useState } from "react";
import type { DashboardMeasurementSnapshot } from "@/lib/dashboard-read-model";
import type { DashboardDetailsData, DashboardDetailsLoadResult } from "./dashboard-details";
import DashboardDetailsLoading from "./dashboard-details-loading";
import DashboardDetailsContent from "./dashboard-details-view";

type SerializedDashboardDetailsData = Omit<DashboardDetailsData, "now" | "recentLives" | "upcomingLives"> & {
  now: string;
  recentLives: Array<Omit<DashboardDetailsData["recentLives"][number], "scheduledAt"> & { scheduledAt: string }>;
  upcomingLives: Array<Omit<DashboardDetailsData["upcomingLives"][number], "scheduledAt"> & { scheduledAt: string }>;
};
type DashboardDetailsResponse = { data: SerializedDashboardDetailsData | null; measurement: DashboardMeasurementSnapshot };

function reviveDashboardDetails(payload: DashboardDetailsResponse): DashboardDetailsLoadResult {
  if (!payload.data) return { data: null, measurement: payload.measurement };
  return {
    measurement: payload.measurement,
    data: {
      ...payload.data,
      now: new Date(payload.data.now),
      recentLives: payload.data.recentLives.map((live) => ({ ...live, scheduledAt: new Date(live.scheduledAt) })),
      upcomingLives: payload.data.upcomingLives.map((live) => ({ ...live, scheduledAt: new Date(live.scheduledAt) })),
    },
  };
}

function DashboardDetailsError() {
  return <section role="alert" className="rounded-xl border border-orange-200 bg-orange-50 p-5 text-sm text-orange-900">
    Dashboard 明細暫時無法載入，KPI 與其他操作不受影響。請稍後重新整理。
  </section>;
}

/** The authenticated shell can finish loading even when secondary reads are slow. */
export default function DashboardDetailsClient({ diagnosticDelayMs }: { diagnosticDelayMs: number }) {
  const [result, setResult] = useState<DashboardDetailsLoadResult | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    const query = diagnosticDelayMs > 0 ? `?e2eDashboardDetailsDelayMs=${diagnosticDelayMs}` : "";
    void fetch(`/api/dashboard/details${query}`, {
      cache: "no-store", credentials: "same-origin", signal: controller.signal,
    }).then(async (response) => {
      if (!response.ok || !response.headers.get("content-type")?.includes("application/json")) throw new Error("DETAILS_UNAVAILABLE");
      return reviveDashboardDetails(await response.json() as DashboardDetailsResponse);
    }).then((loaded) => {
      if (!controller.signal.aborted) setResult(loaded);
    }).catch(() => {
      if (!controller.signal.aborted) setFailed(true);
    });
    return () => controller.abort();
  }, [diagnosticDelayMs]);

  if (!result && !failed) return <DashboardDetailsLoading />;
  // Keep the QA counters fixed and aggregate-only; the read model stays server-side.
  return <div data-dashboard-scope="details"
    data-dashboard-read-operation-count={result?.measurement.readOperationCount}
    data-dashboard-read-operation-duration-ms={result ? Math.round(result.measurement.totalDurationMs) : undefined}>
    {result?.data ? <DashboardDetailsContent data={result.data} /> : <DashboardDetailsError />}
  </div>;
}
