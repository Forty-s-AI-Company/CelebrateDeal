"use client";

import { useRef, useState } from "react";
import { parseFunnelWebinarSettings } from "@/lib/funnel-webinar";
import type { FunnelStepPages } from "@/lib/funnel-step-pages";

/** Keep incomplete input local; only validated schedule snapshots enter persistence. */
export function FunnelWebinarSettings({ state, disabled, onChange, onValidityChange }: { state: FunnelStepPages; disabled?: boolean; onChange: (state: FunnelStepPages) => void; onValidityChange: (valid: boolean) => void }) {
  const initialDraft = state.flow.webinar ?? { timezone: "Asia/Taipei", startsAt: null, endsAt: null, replayEndsAt: null };
  const [draft, setDraft] = useState(initialDraft);
  const draftRef = useRef(draft);
  const [error, setError] = useState("");
  const fields = [["timezone", "線上講座時區"], ["startsAt", "線上講座開始時間（UTC）"], ["endsAt", "線上講座結束時間（UTC）"], ["replayEndsAt", "重播截止時間（UTC）"]] as const;
  return <section aria-label="線上講座排程" className="rounded-xl border border-blue-200 bg-white p-3">
    <h3 className="text-sm font-bold">線上講座排程與重播</h3>
    <p className="my-2 text-xs leading-5 text-slate-600">設定線上講座時區、開始與結束時間，以及重播截止時間。時間以 UTC 保存，訪客依指定時區查看；留空重播截止時間表示不提供重播。</p>
    <div className="grid gap-3">{fields.map(([key, label]) => <label key={key} className="grid gap-1 text-sm">{label}<input disabled={disabled} value={draft[key] ?? ""} placeholder={key === "timezone" ? "Asia/Taipei" : "2026-09-17T10:00:00.000Z"} className="min-h-10 min-w-0 rounded border px-3" onChange={(event) => {
      // Playwright and fast keyboard input can dispatch several changes before
      // React renders again; keep the full draft outside the render closure.
      const next = { ...draftRef.current, [key]: event.target.value || null };
      draftRef.current = next as typeof draft;
      setDraft(next as typeof draft);
      const parsed = parseFunnelWebinarSettings(next);
      onValidityChange(Boolean(parsed));
      setError(parsed ? "" : "請填入有效 IANA 時區與 UTC ISO 時間，並確認開始、結束、重播截止的順序。無效輸入尚未套用。");
      if (parsed) onChange({ ...state, flow: { ...state.flow, webinar: parsed } });
    }} /></label>)}</div>
    {error ? <p role="alert" className="mt-2 text-sm text-red-700">{error}</p> : null}
  </section>;
}
