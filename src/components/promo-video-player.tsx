"use client";

import { useEffect, useRef, useState } from "react";

import { parseSafeExternalHttpUrl } from "@/lib/external-url";

export function isHlsVideoUrl(value: string) {
  try {
    return new URL(value).pathname.toLowerCase().endsWith(".m3u8");
  } catch {
    return false;
  }
}

export function shouldRenderPromoVideo(safeSrc: string | null, failedSrc: string | null) {
  return Boolean(safeSrc && failedSrc !== safeSrc);
}

export function PromoVideoPlayer({ src, title }: { src: string; title: string }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  const [retryNonce, setRetryNonce] = useState(0);
  const safeSrc = parseSafeExternalHttpUrl(src);

  useEffect(() => {
    if (!safeSrc) {
      return;
    }

    const video = videoRef.current;
    if (!video) return;

    let disposed = false;
    let hls: import("hls.js").default | null = null;

    function markError() {
      if (!disposed) setFailedSrc(safeSrc);
    }

    video.addEventListener("error", markError);

    if (!isHlsVideoUrl(safeSrc)) {
      video.src = safeSrc;
    } else if (video.canPlayType("application/vnd.apple.mpegurl")) {
      video.src = safeSrc;
    } else {
      video.removeAttribute("src");
      void import("hls.js")
        .then(({ default: Hls }) => {
          if (disposed) return;
          if (!Hls.isSupported()) {
            markError();
            return;
          }
          hls = new Hls();
          hls.on(Hls.Events.ERROR, (_event, data) => {
            if (data.fatal) markError();
          });
          hls.loadSource(safeSrc);
          hls.attachMedia(video);
        })
        .catch(markError);
    }

    return () => {
      disposed = true;
      video.removeEventListener("error", markError);
      hls?.destroy();
      video.removeAttribute("src");
      video.load();
    };
  }, [retryNonce, safeSrc]);

  if (!shouldRenderPromoVideo(safeSrc, failedSrc)) {
    return (
      <div role="alert" className="grid gap-3 rounded-lg bg-amber-50 p-3 text-sm text-amber-900">
        <p>影片目前無法播放，請確認網路或稍後重試。</p>
        <button
          type="button"
          onClick={() => {
            setFailedSrc(null);
            setRetryNonce((value) => value + 1);
          }}
          className="inline-flex min-h-10 w-fit items-center justify-center rounded-md border border-amber-300 bg-white px-3 font-semibold text-amber-900 hover:bg-amber-100"
        >
          重試播放
        </button>
      </div>
    );
  }

  return (
    <video
      key={safeSrc}
      ref={videoRef}
      controls
      playsInline
      preload="metadata"
      aria-label={title}
      className="aspect-video w-full rounded-xl bg-slate-950 object-contain"
    />
  );
}
