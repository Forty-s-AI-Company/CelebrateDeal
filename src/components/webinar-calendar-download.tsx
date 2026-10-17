"use client";

import { useState, useSyncExternalStore } from "react";
import { createWebinarCalendar, type WebinarCalendarInput } from "@/lib/webinar-calendar";

const subscribeToHydration = () => () => undefined;

export function WebinarCalendarDownload({ event, upcoming, preview = false }: {
  event: Omit<WebinarCalendarInput, "origin">;
  upcoming: boolean;
  preview?: boolean;
}) {
  const [error, setError] = useState("");
  const hydrated = useSyncExternalStore(subscribeToHydration, () => true, () => false);
  if (!upcoming) return null;
  function download() {
    if (preview || !hydrated) return;
    const calendar = createWebinarCalendar({ ...event, origin: window.location.origin });
    if (!calendar) { setError("目前無法產生活動行事曆，請確認最新活動時間與資訊。"); return; }
    try {
      const href = URL.createObjectURL(new Blob([calendar], { type: "text/calendar;charset=utf-8" }));
      const link = document.createElement("a");
      link.href = href; link.download = "webinar.ics";
      document.body.appendChild(link);
      try { link.click(); } finally { link.remove(); window.setTimeout(() => URL.revokeObjectURL(href), 30_000); }
      setError("");
    } catch { setError("目前無法下載行事曆，請稍後再試。"); }
  }
  return <section aria-label="保存活動時間" className="mt-4 rounded-lg border border-slate-300 p-4">
    <h2 className="font-semibold">把活動加入行事曆</h2>
    <p className="mt-2 text-sm font-medium">{event.title}</p>
    <p className="mt-2 text-sm">下載後請匯入你的行事曆，並選擇提醒方式。仍須完成 Email 確認才能取得觀看資格；活動改期時，請更新已加入的行程。</p>
    <button type="button" disabled={preview || !hydrated} aria-busy={!hydrated} onClick={download} className="mt-3 min-h-11 rounded-lg bg-blue-700 px-4 py-2 text-white disabled:opacity-50">{preview ? "預覽模式，不下載行事曆" : "下載活動行事曆（.ics）"}</button>
    {error ? <p role="alert" className="mt-2 text-sm text-red-700">{error}</p> : null}
  </section>;
}
