"use client";

import { useState } from "react";
import { CardScheduleSchema, type CardView } from "@/lib/interaction-card-contract";
import { parseInteractionTriggerSeconds } from "@/lib/interaction-timeline";
import { selectScheduledCard } from "@/lib/interaction-card-timeline";

export function InteractionCardSchedule({ card, durationSeconds, busy, command }: {
  card: CardView; durationSeconds: number; busy: boolean; command: (body: object) => Promise<void>;
}) {
  const schedule = card.configuration.schedule;
  const [start, setStart] = useState(String(schedule?.startSeconds ?? 0));
  const [duration, setDuration] = useState(String(schedule?.durationSeconds ?? 30));
  const [previewAt, setPreviewAt] = useState("0");
  const startSeconds = parseInteractionTriggerSeconds(start);
  const length = parseInteractionTriggerSeconds(duration);
  const parsed = CardScheduleSchema.safeParse({ enabled: true, startSeconds, durationSeconds: length });
  const valid = parsed.success && parsed.data.startSeconds + parsed.data.durationSeconds <= durationSeconds;
  const preview = valid ? selectScheduledCard([{ ...card, configuration: { ...card.configuration, schedule: parsed.data } }], parseInteractionTriggerSeconds(previewAt)) : null;
  return <fieldset className="grid gap-2 rounded border p-3" disabled={busy}>
    <legend>影片時間排程</legend>
    <p className="text-sm">影片共 {durationSeconds} 秒。時間可填秒數、MM:SS 或 HH:MM:SS。</p>
    <label>出現時間<input className="ml-2 min-h-11 rounded border px-2 text-base" value={start} onChange={e => setStart(e.target.value)} /></label>
    <label>持續時間<input className="ml-2 min-h-11 rounded border px-2 text-base" value={duration} onChange={e => setDuration(e.target.value)} /></label>
    {!valid && <p role="alert">請填寫有效時間，持續至少 1 秒，且結束時間不可超過影片長度。</p>}
    <button type="button" className="min-h-11 rounded border" disabled={!valid} onClick={() => { if (valid) void command({ action: "schedule", runId: card.id, schedule: parsed.data }); }}>儲存並啟用排程</button>
    {schedule && <><p>已儲存：{schedule.startSeconds}～{schedule.startSeconds + schedule.durationSeconds} 秒 · {schedule.enabled ? "已啟用" : "已停用"}</p><button type="button" className="min-h-11 rounded border" disabled={!schedule.enabled} onClick={() => void command({ action: "schedule", runId: card.id, schedule: { ...schedule, enabled: false } })}>停用排程</button><button type="button" className="min-h-11 rounded border" onClick={() => void command({ action: "end", runId: card.id })}>結束此排程題目</button></>}
    <label>預覽播放時間<input className="ml-2 min-h-11 rounded border px-2 text-base" value={previewAt} onChange={e => setPreviewAt(e.target.value)} /></label>
    <output aria-live="polite" className="break-words rounded bg-slate-100 p-2">{preview ? `預覽卡片：${preview.title}` : "此時間沒有這張卡片"}</output>
  </fieldset>;
}
