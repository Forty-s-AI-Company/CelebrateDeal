"use client";

import { useEffect, useState } from "react";
import { Activity } from "lucide-react";

export const HEALTH_POLL_INTERVAL_MS = 60_000;

export type SystemStatus = "checking" | "ok" | "error";

export async function checkSystemHealth(fetcher: typeof fetch = fetch): Promise<SystemStatus> {
  try {
    const response = await fetcher("/api/health", { cache: "no-store" });
    if (!response.ok) return "error";
    const body = (await response.json()) as { ok?: boolean };
    return body.ok === true ? "ok" : "error";
  } catch {
    return "error";
  }
}

const presentation: Record<SystemStatus, { label: string; dot: string; ping: boolean }> = {
  checking: { label: "檢查連線中…", dot: "bg-slate-400", ping: false },
  ok: { label: "系統連線正常", dot: "bg-emerald-500", ping: true },
  error: { label: "連線異常", dot: "bg-red-500", ping: false },
};

export function SystemStatusView({ status }: { status: SystemStatus }) {
  const view = presentation[status];
  return (
    <div className="mb-2 flex items-center justify-between rounded-lg px-3 py-2 text-[11px] text-slate-500">
      <span role="status" aria-live="polite" className={`inline-flex items-center gap-2 ${status === "error" ? "font-semibold text-red-700" : ""}`}>
        <span className="relative flex size-2">
          {view.ping ? <span className="absolute inline-flex size-full animate-ping rounded-full bg-emerald-400 opacity-60 motion-reduce:animate-none" /> : null}
          <span className={`relative inline-flex size-2 rounded-full ${view.dot}`} />
        </span>
        {view.label}
      </span>
      <Activity className="size-3.5" aria-hidden="true" />
    </div>
  );
}

export function SystemStatusIndicator() {
  const [status, setStatus] = useState<SystemStatus>("checking");

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      if (document.visibilityState === "hidden") return;
      const next = await checkSystemHealth();
      if (!cancelled) setStatus(next);
    };
    void run();
    const timer = window.setInterval(() => void run(), HEALTH_POLL_INTERVAL_MS);
    const onVisible = () => void run();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);

  return <SystemStatusView status={status} />;
}
