"use client";

import { useEffect, useRef, useState } from "react";
import { isHlsVideoUrl } from "@/components/promo-video-player";
import { parseSafeExternalHttpUrl } from "@/lib/external-url";
import { attachHlsPlayback } from "@/lib/hls-playback-attachment";

// The preview URL is a one-shot signed URL: no renewal source, so an expired token ends the preview.
const noRenewalSource = async () => null;

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
  const videoRef = useRef<HTMLVideoElement>(null);
  const safeUrl = parseSafeExternalHttpUrl(videoUrl);
  const isHls = safeUrl !== null && isHlsVideoUrl(safeUrl);
  useEffect(() => {
    const video = videoRef.current;
    if (!safeUrl || !isHls || !video) return;
    // hls.js where MSE is supported (Chrome/Firefox), native HLS otherwise (Safari/iOS).
    return attachHlsPlayback({ video, url: safeUrl, fetchSource: noRenewalSource });
  }, [safeUrl, isHls]);
  if (!safeUrl) return <p role="alert" className="rounded-lg bg-amber-50 p-4 text-sm text-amber-900">來源影片網址無法安全預覽。</p>;
  const triggered = events.filter((event) => event.triggerSec <= currentSeconds);
  const latest = triggered.at(-1);
  return (
    <div className="grid gap-3">
      <video
        ref={videoRef}
        src={isHls ? undefined : safeUrl}
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
