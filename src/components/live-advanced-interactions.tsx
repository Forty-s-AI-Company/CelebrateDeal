"use client";

import { BarChart3, Gift, PartyPopper, Trophy, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { AdvancedInteractionMetadata } from "@/lib/interaction-event";

type AdvancedEvent = {
  id: string;
  eventType: string;
  triggerSec: number;
  title: string;
  metadata?: unknown;
};

type PublicRun = {
  id: string;
  eventType: string;
  title: string;
  status: string;
  startsAt: string;
  endsAt: string;
  metadata: AdvancedInteractionMetadata;
  responseCount: number;
  responded: boolean;
  ownValue: string | null;
  pollResults: Array<{ id: string; label: string; votes: number; percentage: number }> | null;
  winner: string | null;
  winnerIsViewer: boolean;
};

function metadata(value: unknown): AdvancedInteractionMetadata | null {
  if (!value || typeof value !== "object" || Array.isArray(value) || !("kind" in value)) return null;
  return value as AdvancedInteractionMetadata;
}

async function interactionRequest(body: Record<string, unknown>) {
  const response = await fetch("/api/live-interactions", {
    method: "POST",
    headers: { "content-type": "application/json", "x-celebratedeal-client": "web" },
    body: JSON.stringify(body),
  });
  if (!response.ok) throw new Error(response.status === 409 ? "這個互動已結束，或你已經參加過了。" : "互動連線暫時忙碌，請再試一次。");
  return await response.json() as { run?: PublicRun | null };
}

export function LiveAdvancedInteractions({
  vendorId,
  liveId,
  currentSeconds,
  events,
  enabled,
}: {
  vendorId: string;
  liveId: string;
  currentSeconds: number;
  events: AdvancedEvent[];
  enabled: boolean;
}) {
  const [run, setRun] = useState<PublicRun | null>(null);
  const [remainingSeconds, setRemainingSeconds] = useState(0);
  const [displayName, setDisplayName] = useState("");
  const [message, setMessage] = useState("");
  const [dismissedRunId, setDismissedRunId] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const scriptedEvent = useMemo(() => [...events].reverse().find((event) => {
    const config = metadata(event.metadata);
    return config && event.triggerSec <= currentSeconds && currentSeconds < event.triggerSec + config.durationSec;
  }), [currentSeconds, events]);

  const refresh = useCallback(async () => {
    if (!enabled) return;
    try {
      if (scriptedEvent) {
        const payload = await interactionRequest({ action: "open", vendorId, liveId, eventId: scriptedEvent.id });
        if (payload.run) setRun(payload.run);
        return;
      }
      const response = await fetch(`/api/live-interactions?vendorId=${encodeURIComponent(vendorId)}&liveId=${encodeURIComponent(liveId)}`, { cache: "no-store" });
      if (!response.ok) return;
      const payload = await response.json() as { runs?: PublicRun[] };
      setRun(payload.runs?.[0] ?? null);
    } catch {
      // Polling is best effort; the next interval can recover without hiding playback.
    }
  }, [enabled, liveId, scriptedEvent, vendorId]);

  useEffect(() => {
    if (!enabled) return;
    const immediate = window.setTimeout(() => void refresh(), 0);
    const timer = window.setInterval(() => void refresh(), 2_000);
    return () => {
      window.clearTimeout(immediate);
      window.clearInterval(timer);
    };
  }, [enabled, refresh]);

  useEffect(() => {
    if (!run) return;
    const update = () => setRemainingSeconds(Math.max(0, Math.ceil((Date.parse(run.endsAt) - Date.now()) / 1_000)));
    update();
    const timer = window.setInterval(update, 250);
    return () => window.clearInterval(timer);
  }, [run]);

  async function respond(value: string) {
    if (!run || isSubmitting) return;
    setIsSubmitting(true);
    setMessage("");
    try {
      const payload = await interactionRequest({ action: "respond", vendorId, liveId, runId: run.id, value, ...(displayName.trim() ? { displayName: displayName.trim() } : {}) });
      if (payload.run) setRun(payload.run);
      setMessage(run.eventType === "flash_voucher" ? "紅包已放進你的結帳，購買時會自動折抵。" : "已收到，結果會即時更新。");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "互動失敗，請再試一次。");
    } finally {
      setIsSubmitting(false);
    }
  }

  if (!run || dismissedRunId === run.id) return null;
  const closed = remainingSeconds <= 0 || run.status !== "active";
  const isWinner = run.winnerIsViewer;

  return (
    <section className={`fixed inset-x-3 bottom-24 z-[70] mx-auto max-w-md overflow-hidden rounded-3xl border p-5 text-slate-950 shadow-2xl ${run.eventType === "flash_voucher" ? "animate-pulse border-red-200 bg-gradient-to-br from-red-50 via-white to-amber-50" : "border-white/50 bg-white/95 backdrop-blur-xl"}`} aria-live="polite" data-testid="live-advanced-interaction">
      <button type="button" onClick={() => setDismissedRunId(run.id)} aria-label="關閉互動視窗" className="absolute right-3 top-3 grid h-9 w-9 place-items-center rounded-full bg-slate-100 text-slate-600"><X size={17} /></button>
      <div className="flex items-center gap-3 pr-10">
        <span className={`grid h-12 w-12 shrink-0 place-items-center rounded-2xl text-white ${run.eventType === "lucky_draw" ? "bg-fuchsia-600" : run.eventType === "poll" ? "bg-violet-600" : "bg-red-600"}`}>
          {run.eventType === "lucky_draw" ? <PartyPopper /> : run.eventType === "poll" ? <BarChart3 /> : <Gift />}
        </span>
        <div><p className="text-xs font-black uppercase tracking-[0.18em] text-slate-500">剩餘 {remainingSeconds} 秒 · {run.responseCount} 人參加</p><h2 className="text-xl font-black">{run.title}</h2></div>
      </div>

      {run.winner ? <div className="mt-4 rounded-2xl bg-amber-100 p-4 text-center"><Trophy className="mx-auto text-amber-700" /><p className="mt-2 text-lg font-black">恭喜 {run.winner}！</p>{isWinner ? <div aria-label="得獎彩帶" className="mt-2 text-2xl">🎉 🎊 ✨ 🎊 🎉</div> : null}</div> : null}

      {run.metadata.kind === "lucky_draw" && !run.winner ? <div className="mt-4 grid gap-3"><p className="text-sm text-slate-600">在留言框輸入口號「<strong>{run.metadata.slogan}</strong>」，倒數結束後由主播隨機抽出得獎者。</p><input value={displayName} onChange={(event) => setDisplayName(event.target.value)} maxLength={80} disabled={run.responded || closed} className="h-11 rounded-xl border border-slate-300 px-3" placeholder="你的顯示名稱" /><button type="button" disabled={run.responded || closed || isSubmitting || !displayName.trim()} onClick={() => void respond(run.metadata.kind === "lucky_draw" ? run.metadata.slogan : "")} className="min-h-11 rounded-xl bg-fuchsia-600 px-4 font-bold text-white disabled:opacity-50">{run.responded ? "已取得抽獎資格" : `留言「${run.metadata.slogan}」參加`}</button></div> : null}

      {run.metadata.kind === "poll" ? <div className="mt-4 grid gap-2"><p className="mb-1 font-bold">{run.metadata.question}</p>{(run.pollResults ?? []).map((option) => <button key={option.id} type="button" disabled={run.responded || closed || isSubmitting} onClick={() => void respond(option.id)} className="relative min-h-12 overflow-hidden rounded-xl border border-violet-200 bg-white text-left disabled:opacity-90"><span className="absolute inset-y-0 left-0 bg-violet-100 transition-[width] duration-500" style={{ width: `${option.percentage}%` }} /><span className="relative flex justify-between gap-3 px-4 py-3 font-semibold"><span>{option.label}</span><span>{option.percentage}%</span></span></button>)}</div> : null}

      {run.metadata.kind === "flash_voucher" ? <div className="mt-4 grid gap-3 text-center"><p className="text-3xl font-black text-red-700">{run.metadata.discountType === "percentage" ? `${run.metadata.discountValue}% OFF` : `折抵 NT$${run.metadata.discountValue / 100}`}</p><p className="text-sm text-slate-600">限量 {run.metadata.maxClaims} 份，目前已有 {run.responseCount} 人領取。</p><button type="button" disabled={run.responded || closed || isSubmitting} onClick={() => void respond("claim")} className="min-h-12 rounded-2xl bg-red-600 px-5 text-lg font-black text-white shadow-lg shadow-red-200 disabled:opacity-50">{run.responded ? "紅包已領取" : "一鍵領取折扣"}</button></div> : null}
      {message ? <p role="status" className="mt-3 rounded-xl bg-slate-100 px-3 py-2 text-sm font-semibold">{message}</p> : null}
    </section>
  );
}
