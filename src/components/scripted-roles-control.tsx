"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { type ScriptedCommand, type ScriptedState, type WarmupEvent } from "@/lib/scripted-roles-contract";

type Snapshot = { state: ScriptedState | null; scripts: { id: string; name: string }[]; events: WarmupEvent[]; canSchedule: boolean };
const headers = { "Content-Type": "application/json", "x-celebratedeal-client": "web" };
const control = "min-h-11 rounded-lg border px-3 text-sm disabled:opacity-50";

/** 活動只保存執行狀態，內容仍在原本角色／互動腳本編輯器管理。 */
export function ScriptedRolesControl({ liveId }: { liveId: string }) {
  const [data, setData] = useState<Snapshot | null>(null);
  const [selected, setSelected] = useState("");
  const [preview, setPreview] = useState<WarmupEvent | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const revision = useRef(0);
  useEffect(() => {
    let active = true;
    let timer: ReturnType<typeof setTimeout>;
    const controller = new AbortController();
    async function poll() {
      const version = revision.current;
      try {
        const response = await fetch(`/api/live-danmaku/scripted?liveId=${encodeURIComponent(liveId)}`, { headers, cache: "no-store", signal: AbortSignal.any([controller.signal, AbortSignal.timeout(4000)]) });
        if (!response.ok) throw new Error();
        const next: Snapshot = await response.json();
        if (!Array.isArray(next.scripts) || !Array.isArray(next.events)) throw new Error();
        if (active && version === revision.current) setData(next);
      } catch { if (active && version === revision.current) setData(null); }
      if (active) timer = setTimeout(poll, 2000);
    }
    void poll();
    return () => { active = false; controller.abort(); clearTimeout(timer); };
  }, [liveId]);
  async function command(value: ScriptedCommand) {
    if (busy) return;
    revision.current++; setBusy(true); setError("");
    try {
      const response = await fetch("/api/live-danmaku/scripted", { method: "POST", headers, body: JSON.stringify(value), signal: AbortSignal.timeout(4000) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error);
      setData(null); setPreview(null);
    } catch (e) { setError(e instanceof Error ? e.message : "暖場設定未確認，請重試。"); }
    finally { revision.current++; setBusy(false); }
  }
  const scriptId = selected || data?.state?.scriptId || data?.scripts[0]?.id || "";
  return <section className="grid w-full min-w-0 gap-3 rounded-lg border p-3" aria-label="暖場角色腳本">
    <strong>暖場角色／預設互動</strong>
    <p className="text-sm">預先編輯的文字與貼圖，會清楚標示為暖場角色，不計入真人參與或成交。請勿撰寫虛構購買或見證。</p>
    <div className="flex flex-wrap gap-3 text-sm underline"><Link href="/interaction-roles/new">建立暖場角色與內建頭像</Link><Link href="/interaction-roles">管理／停用角色</Link><Link href="/interaction-scripts/new">編輯文字與貼圖腳本</Link></div>
    <p className="text-xs">角色請開啟「排程角色」，腳本須先發布才會列出。彈幕只接受 160 字內的聊天／提醒事件；最多 100 則，時間至少相隔五秒，須在影片長度內。貼圖使用內建表情符號。</p>
    <div className="flex flex-wrap gap-2">
      <select aria-label="選擇暖場腳本" className={`${control} max-w-full`} value={scriptId} onChange={e => setSelected(e.target.value)} disabled={busy || !data}>{data?.scripts.map(script => <option key={script.id} value={script.id}>{script.name}</option>)}</select>
      <button type="button" className={control} disabled={!scriptId || busy || !data} onClick={() => void command({ action: "select", liveId, scriptId, scheduled: false })}>載入手動暖場</button>
      <button type="button" className={control} disabled={!scriptId || busy || !data?.canSchedule} onClick={() => void command({ action: "select", liveId, scriptId, scheduled: true })}>啟用播放時間排程</button>
      <button type="button" className={control} disabled={busy} onClick={() => void command({ action: "stop", liveId })}>停止並停用當前腳本</button>
    </div>
    {data?.scripts.length === 0 && <p className="text-sm">目前沒有已發布腳本。請先建立角色，再到腳本編輯器選用「暖場互動」範本並發布。</p>}
    <p role="status" className="text-sm">{error || (!data ? "正在同步暖場設定…" : data.state?.enabled ? data.state.scheduled ? "播放時間排程已啟用" : "手動暖場已載入" : "暖場腳本已停用")}</p>
    {data?.state && <Link className="text-sm underline" href={`/interaction-scripts/${data.state.scriptId}/edit`}>修改目前腳本與觸發時間</Link>}
    {preview && <p className="rounded border p-2" aria-label="暖場預覽">預覽 · 暖場角色／預設互動 · {preview.displayName}：{preview.value}</p>}
    <ul className="grid max-h-72 gap-2 overflow-auto">{data?.events.map(event => <li key={event.id} className="flex min-w-0 flex-wrap items-center gap-2 border-b py-2">
      <span className="min-w-0 flex-1 break-words text-sm">{event.triggerSec}s · {event.displayName}：{event.value}</span>
      <button type="button" className={control} onClick={() => setPreview(event)}>預覽</button>
      <button type="button" className={control} disabled={busy || !data.state?.enabled} onClick={() => void command({ action: "send", liveId, eventId: event.id, requestId: crypto.randomUUID() })}>手動發送</button>
    </li>)}</ul>
  </section>;
}
