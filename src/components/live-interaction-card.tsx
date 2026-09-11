"use client";

import { useEffect, useRef, useState, type RefObject } from "react";
import { cardOptions, type CardView } from "@/lib/interaction-card-contract";
import { selectTimelineCard, type CardTimeline } from "@/lib/interaction-card-timeline";
import { observeCardMedia } from "@/lib/interaction-card-media";

export function LiveInteractionCard(props: { vendorId: string; liveId: string; enabled: boolean; videoRef?: RefObject<HTMLVideoElement | null> }) {
  // 活動變更即卸載舊狀態，也隔離尚未完成的 fetch。
  return props.enabled ? <CardSession key={`${props.vendorId}:${props.liveId}`} {...props} /> : null;
}
function CardSession({ vendorId, liveId, videoRef }: { vendorId: string; liveId: string; videoRef?: RefObject<HTMLVideoElement | null> }) {
  const [card, setCard] = useState<CardView | null>(null);
  const [timeline, setTimeline] = useState<CardTimeline | null>(null);
  const [mediaSeconds, setMediaSeconds] = useState<number | null>(null);
  const [tick, setTick] = useState(0);
  const [receivedAt, setReceivedAt] = useState<number | null>(null);
  const [roundTripSeconds, setRoundTripSeconds] = useState(0);
  const [error, setError] = useState("");
  const revision = useRef(0);
  useEffect(() => {
    const video = videoRef?.current;
    return video ? observeCardMedia(video, setMediaSeconds) : undefined;
  }, [videoRef]);
  useEffect(() => {
    let active = true;
    let inFlight = false;
    const controller = new AbortController();
    async function refresh() {
      if (inFlight || document.hidden) return;
      inFlight = true;
      const sequence = ++revision.current;
      const started = performance.now();
      try {
        const response = await fetch(`/api/live-interactions/cards?vendorId=${encodeURIComponent(vendorId)}&liveId=${encodeURIComponent(liveId)}`, { cache: "no-store", signal: controller.signal, headers: { "x-celebratedeal-client": "web" } });
        if (!response.ok) throw new Error("互動連線中斷，正在重新連線。");
        const payload = await response.json();
        const received = performance.now();
        if (active && sequence === revision.current && received - started < 4000) { setRoundTripSeconds((received - started) / 1000); setReceivedAt(received); setTick(received); setCard(payload.card); setTimeline(payload.timeline ?? null); setError(""); }
      } catch { if (active) setError("互動連線中斷，正在重新連線。"); }
      finally { inFlight = false; }
    }
    function resume() {
      // 背景恢復和重連不能先顯示快取題目；舊請求回應也不得重新寫回。
      setReceivedAt(null); revision.current++; setTick(performance.now());
      void refresh();
    }
    void refresh();
    const timer = window.setInterval(() => void refresh(), 1500);
    const clock = window.setInterval(() => setTick(performance.now()), 100);
    document.addEventListener("visibilitychange", resume);
    window.addEventListener("online", resume);
    return () => { active = false; controller.abort(); window.clearInterval(timer); window.clearInterval(clock); document.removeEventListener("visibilitychange", resume); window.removeEventListener("online", resume); };
  }, [vendorId, liveId]);
  const age = receivedAt === null ? Infinity : Math.max(0, (tick - receivedAt) / 1000);
  const visible = age < 4 ? card ?? (timeline ? selectTimelineCard(timeline, mediaSeconds, age, roundTripSeconds) : null) : null;
  return visible ? <CardForm key={visible.id} card={visible} vendorId={vendorId} liveId={liveId} offline={Boolean(error)} positionSeconds={timeline?.clock.mode === "personal" ? mediaSeconds : null} /> : null;
}
function CardForm({ card, vendorId, liveId, offline, positionSeconds }: { card: CardView; vendorId: string; liveId: string; offline: boolean; positionSeconds: number | null }) {
  const [collapsed, setCollapsed] = useState(false);
  const [value, setValue] = useState("");
  const [sent, setSent] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const inFlight = useRef(false);
  const formRef = useRef<HTMLFormElement>(null);
  const answered = sent ?? card.ownValue;
  async function submit() {
    if (inFlight.current || answered !== null || !value.trim()) return;
    inFlight.current = true; setBusy(true); setMessage("");
    try {
      const response = await fetch("/api/live-interactions/cards", { method: "POST", headers: { "content-type": "application/json", "x-celebratedeal-client": "web" }, body: JSON.stringify({ vendorId, liveId, runId: card.id, value: value.trim(), ...(positionSeconds !== null ? { positionSeconds } : {}) }) });
      if (!response.ok) throw new Error(response.status === 429 ? "回應太快，請等 10 秒後再試，回答已保留。" : response.status === 409 ? "題目已結束或已有不同回答，請等候更新。" : "送出失敗，已保留回答，請再試一次。");
      setSent(value.trim()); setMessage("回答已儲存。");
      formRef.current?.scrollTo({ top: 0 });
    } catch (error) { setMessage(error instanceof Error ? error.message : "送出失敗"); }
    finally { inFlight.current = false; setBusy(false); }
  }
  return <aside aria-label="畫面內互動卡片" className="absolute bottom-20 left-2 z-[65] w-[min(22rem,calc(100%-1rem))] rounded-2xl border border-slate-200 bg-white p-3 text-slate-950 shadow-lg" onKeyDown={event => { if (event.key === "Escape") { setCollapsed(true); event.currentTarget.querySelector<HTMLButtonElement>("button")?.focus(); } }}>
    <div className="flex items-center justify-between gap-2"><h2 className="truncate font-bold">講師互動</h2><button type="button" aria-expanded={!collapsed} onClick={() => setCollapsed(!collapsed)} className="min-h-11 px-3 text-sm font-bold">{collapsed ? "展開回答" : "關閉／收合"}</button></div>
    {!collapsed && <form ref={formRef} onSubmit={event => { event.preventDefault(); void submit(); }} className="grid max-h-[32dvh] gap-2 overflow-y-auto overscroll-contain">
      <p className="break-words font-semibold">{card.title}</p>
      <p className="text-sm font-semibold text-indigo-800">{card.configuration.visibility === "instructor_only" ? "僅講師可見：回答不會公開展示。" : "可公開展示：送出即同意此回答或貼圖供公開展示。彈幕名稱統一為「觀眾」，請勿填入私人聯絡資料。"}</p>
      {answered !== null ? <p role="status" className="break-words">已回答：{answered}</p> : <>
        {card.configuration.answerType === "text" ? <label className="grid gap-1 text-sm">你的回答<input value={value} onChange={e => setValue(e.target.value)} maxLength={160} required className="min-h-11 rounded border px-2 text-base" /></label> : <div role="group" aria-label="回答選項" className="flex flex-wrap gap-2">{cardOptions(card.configuration).map(option => <button key={option} type="button" aria-pressed={value === option} onClick={() => setValue(option)} className={`min-h-11 min-w-11 break-words rounded-lg border px-3 text-base ${value === option ? "bg-indigo-700 text-white" : "bg-slate-50"}`}>{option}</button>)}</div>}
        <button disabled={busy || offline || !value.trim()} className="min-h-11 rounded-lg bg-indigo-700 px-3 font-bold text-white disabled:opacity-50">{busy ? "儲存中…" : "送出回答"}</button>
      </>}
      {(message || offline) && <p role="status" className="text-sm">{offline ? "正在重新連線，回答已保留。" : message}</p>}
      <p className="text-xs text-slate-600">請使用頁內觀看；手機原生全螢幕可能無法顯示卡片。</p>
    </form>}
  </aside>;
}
