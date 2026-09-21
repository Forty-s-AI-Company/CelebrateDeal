"use client";

import { useEffect, useRef, useState, type RefObject } from "react";
import { DanmakuQueue, type DanmakuItem, type DanmakuSnapshot, type DanmakuState } from "@/lib/live-danmaku-contract";
import { ScriptedRolesControl } from "./scripted-roles-control";

const headers = { "Content-Type": "application/json", "x-celebratedeal-client": "web" };
const buttonClass = "min-h-11 rounded-lg border border-current px-3 text-sm disabled:opacity-50";

/** Both instructor entrances read/write exactly the same persisted activity setting. */
export function InstructorDanmakuSwitch({ liveId }: { liveId: string }) {
  const [state, setState] = useState<DanmakuState | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const revision = useRef(0);
  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    async function poll() {
      const version = revision.current;
      try {
        const response = await fetch(`/api/live-danmaku?mode=instructor&liveId=${encodeURIComponent(liveId)}`, { headers, cache: "no-store", signal: controller.signal });
        if (!response.ok) throw new Error();
        const data = await response.json();
        if (active && version === revision.current) { setState(data.state); setError(""); }
      } catch { if (active && version === revision.current) { setState(null); setError("彈幕設定同步中斷"); } }
      if (active) timer = setTimeout(poll, 2000);
    }
    void poll();
    return () => { active = false; controller.abort(); clearTimeout(timer); };
  }, [liveId]);
  async function toggle() {
    if (!state || busy) return;
    revision.current++; setBusy(true);
    try {
      const response = await fetch("/api/live-danmaku?mode=instructor", { method: "POST", headers, body: JSON.stringify({ liveId, enabled: !state.enabled }) });
      if (!response.ok) throw new Error();
      const data = await response.json(); setState(data.state); setError("");
    } catch { setState(null); setError("設定未確認，正在重新同步。"); }
    finally { revision.current++; setBusy(false); }
  }
  return <div className="flex flex-wrap items-center gap-3" aria-label="活動彈幕設定">
    <button type="button" className={buttonClass} disabled={!state || busy} aria-pressed={state?.enabled ?? false} onClick={() => void toggle()}>{state?.enabled ? "關閉全場彈幕" : "開啟全場彈幕"}</button>
    <span className="text-xs">公開卡片回答顯示為「觀眾」；預編內容標示「暖場角色」。關閉會清空待播內容。</span>
    {error && <span role="status">{error}</span>}
    <ScriptedRolesControl liveId={liveId} />
  </div>;
}

export function LiveDanmaku({ vendorId, liveId, enabled, videoRef }: { vendorId: string; liveId: string; enabled: boolean; videoRef?: RefObject<HTMLVideoElement | null> }) {
  const [hidden, setHidden] = useState(false);
  const [available, setAvailable] = useState(false);
  const [item, setItem] = useState<DanmakuItem | null>(null);
  const preference = useRef(false);
  const queue = useRef(new DanmakuQueue());
  const played = useRef(new Set<string>());
  const lastWarmup = useRef(0);
  const key = `celebratedeal:danmaku:${vendorId}:${liveId}`;
  useEffect(() => {
    try { preference.current = localStorage.getItem(key) === "hidden"; } catch { preference.current = false; }
    try {
      const ids: unknown = JSON.parse(sessionStorage.getItem(`${key}:played`) ?? "[]");
      if (Array.isArray(ids)) played.current = new Set(ids.filter(id => typeof id === "string" && id.startsWith("warmup:") && id.length < 512).slice(-1000));
    } catch { /* Storage 被封鎖時，同頁去重仍保留。 */ }
    setHidden(preference.current);
  }, [key]);
  useEffect(() => {
    if (!enabled) return;
    const pending = queue.current;
    let active = true;
    let cursor: string | undefined;
    let epoch: string | undefined;
    let controller: AbortController | undefined;
    let timer: ReturnType<typeof setTimeout>;
    let generation = 0;
    const clear = () => { queue.current.clear(); setItem(null); setAvailable(false); cursor = undefined; epoch = undefined; };
    async function poll() {
      if (!active || document.hidden) return;
      const version = generation;
      controller = new AbortController();
      const timeout = setTimeout(() => controller?.abort(), 4000);
      try {
        const params = new URLSearchParams({ vendorId, liveId });
        const video = videoRef?.current;
        const mediaPosition = video && !video.seeking && !video.paused && !video.ended && video.readyState >= 1 ? video.currentTime : null;
        if (mediaPosition !== null && Number.isFinite(mediaPosition)) params.set("positionSeconds", String(mediaPosition));
        if (cursor && epoch && !preference.current) { params.set("cursor", cursor); params.set("epoch", epoch); }
        const response = await fetch(`/api/live-danmaku?${params}`, { headers, cache: "no-store", signal: controller.signal });
        if (!response.ok) throw new Error();
        const snapshot: DanmakuSnapshot = await response.json();
        if (!active || version !== generation) return;
        if (epoch !== snapshot.state.epoch || !snapshot.state.enabled) setItem(null);
        cursor = snapshot.cursor; epoch = snapshot.state.epoch;
        setAvailable(snapshot.state.enabled);
        // 排程訊息在同一觀看頁只播一次；重連、倒轉及腳本開關不重置此紀錄。
        snapshot.items = snapshot.items.filter(next => !next.source || !played.current.has(next.id));
        queue.current.accept(snapshot, !preference.current);
      } catch { if (active && version === generation) clear(); }
      finally { clearTimeout(timeout); }
      if (active && version === generation) timer = setTimeout(poll, 2000);
    }
    function visibility() {
      generation++; controller?.abort(); clearTimeout(timer); clear();
      if (!document.hidden) void poll();
    }
    clear(); void poll();
    let displayUntil = 0;
    const display = setInterval(() => {
      if (preference.current || Date.now() < displayUntil) return;
      const next = queue.current.next();
      if (next?.source === "scripted_role") {
        if (played.current.has(next.id) || Date.now() - lastWarmup.current < 5000) { setItem(null); return; }
        lastWarmup.current = Date.now(); played.current.add(next.id);
        // 單一腳本最多一百則；跨腳本仍維持有界的去重記憶體。
        if (played.current.size > 1000) played.current = new Set([...played.current].slice(-500));
        try { sessionStorage.setItem(`${key}:played`, JSON.stringify([...played.current])); } catch { /* 保留記憶體去重。 */ }
      }
      displayUntil = next ? Date.now() + 3500 : 0;
      setItem(next);
    }, 250);
    const video = videoRef?.current;
    // Seek／暫停先清空已收內容；下一次輪詢只採當下媒體時間。
    const mediaReset = () => { generation++; controller?.abort(); clearTimeout(timer); clear(); if (!document.hidden) void poll(); };
    video?.addEventListener("seeking", mediaReset); video?.addEventListener("pause", mediaReset);
    document.addEventListener("visibilitychange", visibility);
    return () => { active = false; generation++; controller?.abort(); clearTimeout(timer); clearInterval(display); pending.clear(); document.removeEventListener("visibilitychange", visibility); video?.removeEventListener("seeking", mediaReset); video?.removeEventListener("pause", mediaReset); };
  }, [enabled, liveId, vendorId, videoRef, key]);
  if (!enabled) return null;
  function toggle() {
    preference.current = !preference.current; setHidden(preference.current); queue.current.clear(); setItem(null);
    try { localStorage.setItem(key, preference.current ? "hidden" : "visible"); } catch { /* Memory preference still works when storage is unavailable. */ }
  }
  return <aside className="danmaku-strip" aria-label="公開互動彈幕">
    <button type="button" className={buttonClass} aria-pressed={!hidden} onClick={toggle}>{hidden ? "顯示彈幕" : "隱藏彈幕"}</button>
    <div className="danmaku-lane" aria-live="off">
      {!hidden && available && item ? <span key={item.id} className="danmaku-message">{item.source === "scripted_role" && <><strong>暖場角色／預設互動 · </strong>{item.avatarUrl && <span aria-hidden="true" className="mr-1 inline-block h-6 w-6 rounded-full align-middle bg-cover" style={{ backgroundImage: `url("${item.avatarUrl}")` }} />}</>}{item.displayName}：{item.value}</span> : <span className="text-xs opacity-70">{hidden ? "已為你隱藏" : available ? "公開卡片回答與暖場角色會在這裡出現" : "全場彈幕尚未開啟或正在同步"}</span>}
    </div>
  </aside>;
}
