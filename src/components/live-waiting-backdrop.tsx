"use client";

import { useEffect, useRef, useState } from "react";
import { Volume2, VolumeX } from "lucide-react";
import { parseSafeExternalHttpUrl } from "@/lib/external-url";
import { attachHlsPlayback } from "@/lib/hls-playback-attachment";
import type { RenewablePlaybackSource } from "@/lib/signed-playback-renewal";

const clientHeaders = {
  "Content-Type": "application/json",
  "X-CelebrateDeal-Client": "web",
};

export const LIVE_WAITING_SOURCE_ENDPOINT = "/api/live-waiting-source";

function isHlsManifestUrl(url: string) {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" && parsed.pathname.endsWith("/manifest/video.m3u8");
  } catch {
    return false;
  }
}

/** Accepts only a safe http(s) URL and a positive lifetime; anything else is no source. */
export function projectWaitingVideoSource(payload: unknown): RenewablePlaybackSource | null {
  if (typeof payload !== "object" || payload === null || Array.isArray(payload)) return null;
  const rawUrl = (payload as { playbackUrl?: unknown }).playbackUrl;
  const playbackUrl = typeof rawUrl === "string" ? parseSafeExternalHttpUrl(rawUrl) : null;
  if (!playbackUrl) return null;
  const rawExpires = (payload as { expiresInSeconds?: unknown }).expiresInSeconds;
  const expiresInSeconds = typeof rawExpires === "number" && Number.isFinite(rawExpires) && rawExpires > 0
    ? Math.floor(rawExpires)
    : null;
  return expiresInSeconds === null ? { playbackUrl } : { playbackUrl, expiresInSeconds };
}

/** Only the Live is named: the server answers with this Live's own bound waiting video or 403. */
export async function fetchLiveWaitingSource(vendorId: string, liveId: string) {
  const query = new URLSearchParams({ vendorId, liveId });
  const response = await fetch(`${LIVE_WAITING_SOURCE_ENDPOINT}?${query.toString()}`, { headers: clientHeaders });
  if (!response.ok) return null;
  return projectWaitingVideoSource(await response.json());
}

/** Releases the element's media: no request keeps running after the room closes. */
function releaseVideo(video: HTMLVideoElement) {
  video.pause();
  video.removeAttribute("src");
  video.load();
}

function playMuted(video: HTMLVideoElement) {
  void video.play()?.catch(() => undefined);
}

/**
 * The waiting room's full-bleed background: the merchant's poster, and when the
 * Live has a waiting video, that video muted, looped and autoplaying over it
 * (the poster stays as its poster). There is no pause, seek bar or controls,
 * only a sound toggle. When the room closes (the show starts) this unmounts:
 * hls.js is destroyed, the renewal stops and the element's source is dropped
 * before the main player takes over.
 */
export function LiveWaitingBackdrop({
  vendorId,
  liveId,
  heroImageUrl,
  hasWaitingVideo,
}: {
  vendorId: string;
  liveId: string;
  heroImageUrl: string | null;
  hasWaitingVideo: boolean;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [sourceState, setSourceState] = useState<{ scope: string; source: RenewablePlaybackSource | null }>({ scope: "", source: null });
  const [muted, setMuted] = useState(true);
  const scope = `${vendorId}:${liveId}`;
  const source = hasWaitingVideo && sourceState.scope === scope ? sourceState.source : null;
  const poster = parseSafeExternalHttpUrl(heroImageUrl);

  useEffect(() => {
    if (!hasWaitingVideo) return;
    let disposed = false;
    void fetchLiveWaitingSource(vendorId, liveId)
      .then((next) => { if (!disposed) setSourceState({ scope, source: next }); })
      .catch(() => { if (!disposed) setSourceState({ scope, source: null }); });
    return () => { disposed = true; };
  }, [hasWaitingVideo, liveId, scope, vendorId]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !source) return;
    // Muted before any source is attached, so mobile autoplay policies allow it.
    video.muted = true;
    let detach: (() => void) | null = null;
    if (isHlsManifestUrl(source.playbackUrl)) {
      detach = attachHlsPlayback({
        video,
        url: source.playbackUrl,
        expiresInSeconds: source.expiresInSeconds,
        fetchSource: () => fetchLiveWaitingSource(vendorId, liveId),
      });
    } else {
      video.src = source.playbackUrl;
    }
    playMuted(video);
    return () => {
      detach?.();
      releaseVideo(video);
    };
  }, [liveId, source, vendorId]);

  // A failed element keeps showing its poster; native HLS recovers through the renewal.
  const showVideo = Boolean(source);
  return (
    <div data-testid="live-waiting-backdrop" data-waiting-video={showVideo ? "on" : "off"} className="absolute inset-0 overflow-hidden bg-slate-950">
      {poster ? (
        <div aria-hidden="true" className="absolute inset-0 bg-cover bg-center" style={{ backgroundImage: `url(${JSON.stringify(poster)})` }} />
      ) : null}
      {showVideo ? (
        <video
          ref={videoRef}
          data-testid="live-waiting-video"
          aria-hidden="true"
          tabIndex={-1}
          className="pointer-events-none absolute inset-0 h-full w-full object-cover"
          poster={poster ?? undefined}
          muted
          loop
          autoPlay
          playsInline
          preload="auto"
          disablePictureInPicture
          disableRemotePlayback
          controls={false}
          onVolumeChange={(event) => setMuted(event.currentTarget.muted)}
          // `loop` restarts by itself; this covers an engine that still reports the end.
          onEnded={(event) => { event.currentTarget.currentTime = 0; playMuted(event.currentTarget); }}
        />
      ) : null}
      {/* Darker towards the middle and bottom so the countdown card stays readable over any poster or video. */}
      <div aria-hidden="true" className="pointer-events-none absolute inset-0 bg-gradient-to-b from-black/60 via-black/45 to-black/85" />
      {showVideo ? (
        <button
          type="button"
          data-testid="live-waiting-sound"
          aria-pressed={!muted}
          onClick={() => {
            const video = videoRef.current;
            if (!video) return;
            video.muted = !video.muted;
            setMuted(video.muted);
            if (!video.muted) playMuted(video);
          }}
          className="absolute bottom-8 right-4 z-20 inline-flex min-h-11 items-center gap-2 rounded-full bg-black/55 px-4 text-sm font-bold text-white backdrop-blur-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
        >
          {muted ? <VolumeX className="h-4 w-4" aria-hidden="true" /> : <Volume2 className="h-4 w-4" aria-hidden="true" />}
          {muted ? "開啟聲音" : "關閉聲音"}
        </button>
      ) : null}
    </div>
  );
}
