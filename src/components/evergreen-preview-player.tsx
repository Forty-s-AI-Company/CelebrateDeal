"use client";

import { useState } from "react";
import { parseSafeExternalHttpUrl } from "@/lib/external-url";

export function EvergreenPreviewPlayer({
  videoUrl,
  playbackRate,
  events,
  orientation = "landscape",
}: {
  videoUrl: string;
  playbackRate: number;
  orientation?: "landscape" | "portrait";
  events: Array<{ id: string; triggerSec: number; title: string; eventType: string }>;
}) {
  const [currentSeconds, setCurrentSeconds] = useState(0);
  const safeUrl = parseSafeExternalHttpUrl(videoUrl);
  if (!safeUrl) return <p role="alert" className="rounded-lg bg-amber-50 p-4 text-sm text-amber-900">來源影片網址無法安全預覽。</p>;
  const triggered = events.filter((event) => event.triggerSec <= currentSeconds);
  const latest = triggered.at(-1);
  return (
    <div className="grid gap-3">
      <video
        src={safeUrl}
        controls
        playsInline
        style={{ aspectRatio: orientation === "portrait" ? "9 / 16" : "16 / 9", maxHeight: "70dvh" }}
        className="w-full rounded-lg bg-black object-contain"
        onLoadedMetadata={(event) => { event.currentTarget.playbackRate = playbackRate; }}
        onTimeUpdate={(event) => setCurrentSeconds(Math.floor(event.currentTarget.currentTime))}
      />
      <div className="flex flex-wrap items-center gap-2 text-xs text-slate-600">
        <span className="rounded-full bg-blue-50 px-2 py-1 font-semibold text-blue-800">商家預覽 {playbackRate}×</span>
        <span>{Math.floor(currentSeconds / 60)}:{String(currentSeconds % 60).padStart(2, "0")}</span>
        {latest ? <span className="rounded-full bg-orange-50 px-2 py-1 font-semibold text-orange-800">已觸發：{latest.title || latest.eventType}</span> : <span>尚未觸發時間軸事件</span>}
      </div>
    </div>
  );
}
