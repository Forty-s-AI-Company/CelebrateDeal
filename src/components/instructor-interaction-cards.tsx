"use client";

import { useEffect, useState } from "react";
import type { CardConfig, InstructorCard } from "@/lib/interaction-card-contract";
import { InteractionCardSchedule } from "@/components/interaction-card-schedule";

export function InstructorInteractionCards({ liveId }: { liveId: string }) { return <CardStudio key={liveId} liveId={liveId} />; }
function CardStudio({ liveId }: { liveId: string }) {
  const [cards, setCards] = useState<InstructorCard[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [kind, setKind] = useState<CardConfig["answerType"]>("text");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [version, setVersion] = useState(0);
  const [capability, setCapability] = useState<{ enabled: boolean; durationSeconds: number | null } | null>(null);
  useEffect(() => {
    let active = true;
    async function refresh() {
      try {
        const response = await fetch(`/api/live-interactions/cards?mode=instructor&liveId=${encodeURIComponent(liveId)}${selected ? `&answerRunId=${encodeURIComponent(selected)}` : ""}`, { cache: "no-store", headers: { "x-celebratedeal-client": "web" } });
        if (!response.ok) throw new Error();
        const data = await response.json(); if (active) { setCards(data.cards); setCapability(data.timelineCapability ?? null); }
      } catch { if (active) setMessage("讀取失敗，正在重新連線。"); }
    }
    void refresh(); const timer = window.setInterval(() => void refresh(), 3000);
    return () => { active = false; window.clearInterval(timer); };
  }, [liveId, version, selected]);
  async function command(body: object) {
    setBusy(true); setMessage("");
    try {
      const response = await fetch("/api/live-interactions/cards?mode=instructor", { method: "POST", headers: { "content-type": "application/json", "x-celebratedeal-client": "web" }, body: JSON.stringify({ ...body, liveId }) });
      if (!response.ok) throw new Error("操作失敗，請檢查題目與選項後重試。");
      setVersion(v => v + 1); setMessage("已儲存。");
    } catch (error) { setMessage(error instanceof Error ? error.message : "操作失敗"); }
    finally { setBusy(false); }
  }
  return <section className="my-6 grid gap-4 rounded-2xl border bg-white p-4 text-slate-900" aria-label="互動卡片控場">
    <h2 className="text-xl font-bold">畫面內互動卡片</h2><p className="text-sm">提前備題或現場新增，真直播與預錄均可手動發送。發送下一題會結束上一題。</p>
    <p className="text-sm">手動題優先；結束後只恢復當下仍有效的排程，不補發過期題目。重疊時顯示最晚開始的一題。倒轉／重播沿用同一回答。</p>
    {capability && !capability.enabled && <p>此活動目前只開放手動發題：真直播、未設定影片長度，或未固定場次的常青講座尚不支援影片排程。</p>}
    <form className="grid gap-3" onSubmit={event => { event.preventDefault(); const data = new FormData(event.currentTarget); void command({ action: "create", title: data.get("title"), configuration: { version: 1, kind: "interaction_card", answerType: kind, visibility: data.get("visibility"), options: kind === "single" || kind === "quick" ? String(data.get("options") ?? "").split(/\r?\n/).map(s => s.trim()).filter(Boolean) : [] } }); }}>
      <label className="grid gap-1">題目<input name="title" required maxLength={160} className="min-h-11 rounded border px-3 text-base" /></label>
      <label className="grid gap-1">回答方式<select value={kind} onChange={e => setKind(e.target.value as CardConfig["answerType"])} className="min-h-11 rounded border px-3"><option value="text">短文字</option><option value="single">單選題</option><option value="quick">快捷文字</option><option value="sticker">內建表情／貼圖</option></select></label>
      {(kind === "single" || kind === "quick") && <label className="grid gap-1">選項，每行一個，2～8 個<textarea key={kind} name="options" required defaultValue={kind === "quick" ? "666\n111\n222" : ""} rows={3} className="rounded border p-2 text-base" /></label>}
      <label className="grid gap-1">回答可見性<select name="visibility" className="min-h-11 rounded border px-3"><option value="instructor_only">僅講師可見</option><option value="public_display">可公開展示</option></select></label>
      <p className="text-sm">建立後可見性固定；公開展示不會自動產生彈幕。</p><button disabled={busy} className="min-h-11 rounded bg-indigo-700 px-4 font-bold text-white disabled:opacity-50">建立待發題目</button>
    </form>
    {message && <p role="status">{message}</p>}
    <p className="text-sm">最近 100 題及所有啟用排程／回答中題目；每題顯示最新 100 筆回答，統計包含全部回答。最多啟用 100 個排程。</p>
    {cards.map(card => <article key={card.id} className="grid gap-2 rounded-xl border p-3"><h3 className="break-words font-bold">{card.title}</h3><p className="text-sm">{card.status === "draft" ? "待發送" : card.status === "active" ? "回答中" : "已結束"} · {card.configuration.visibility === "instructor_only" ? "僅講師可見" : "可公開展示"} · {card.responseCount} 人回答</p>
      {card.status === "draft" && capability?.enabled && capability.durationSeconds && <InteractionCardSchedule key={`${card.id}:${JSON.stringify(card.configuration.schedule)}`} card={card} busy={busy} durationSeconds={capability.durationSeconds} command={command} />}
      {card.status !== "closed" && <button disabled={busy} onClick={() => void command({ action: card.status === "draft" ? "start" : "end", runId: card.id })} className="min-h-11 rounded border px-3 font-semibold">{card.status === "draft" ? "發送這一題" : "結束回答"}</button>}
      {card.options.map(option => <p key={option.value}>{option.value}：{option.count} 票</p>)}
      <details open={selected === card.id} onToggle={event => { if (event.currentTarget.open) setSelected(card.id); }}><summary className="min-h-11 cursor-pointer py-2">查看回答</summary><ul className="max-h-60 overflow-y-auto">{card.answers.map(answer => <li key={answer.id} className="break-words border-t py-2">{answer.value} <time className="text-xs" dateTime={answer.createdAt}>{new Date(answer.createdAt).toLocaleTimeString()}</time></li>)}</ul>{card.hasMoreAnswers && <p>僅顯示最新 100 筆，完整紀錄已保留。</p>}</details>
    </article>)}
  </section>;
}
