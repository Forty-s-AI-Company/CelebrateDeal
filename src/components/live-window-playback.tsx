"use client";

import { useMemo, useRef, useState, type ReactNode, type RefObject } from "react";
import { Maximize2, Play, Volume2, VolumeX } from "lucide-react";

export type LiveAutoplayStatus = "pending" | "muted" | "settled" | "ended";

/** How far behind the live position a resumed broadcast may be before it jumps forward. */
export const LIVE_RESUME_TOLERANCE_SECONDS = 3;

function enterVideoFullscreen(video: HTMLVideoElement | null) {
  if (!video) return;
  if (typeof video.requestFullscreen === "function") void video.requestFullscreen().catch(() => undefined);
  else (video as HTMLVideoElement & { webkitEnterFullscreen?: () => void }).webkitEnterFullscreen?.();
}

/**
 * Controls for a broadcast inside its live window. There is deliberately no
 * pause or seek UI: a live starts by itself, and the only things a viewer can
 * do are turn the sound on and go fullscreen. The big overlay button covers the
 * two cases where the browser refused autoplay.
 */
export function LiveAutoplayControls({ videoRef, status, isPaused, isMuted, onUnmute, onResume }: {
  videoRef: RefObject<HTMLVideoElement | null>;
  status: LiveAutoplayStatus;
  isPaused: boolean;
  isMuted: boolean;
  onUnmute: () => void;
  onResume: () => void;
}) {
  const needsResume = isPaused && (status === "settled" || status === "muted");
  const needsUnmute = !isPaused && isMuted && status === "muted";
  const overlayButtonClass = "pointer-events-auto inline-flex min-h-12 items-center gap-2 rounded-full bg-white px-6 text-base font-black text-slate-950 shadow-xl shadow-black/40 hover:bg-white/90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white";
  const smallButtonClass = "inline-flex min-h-11 min-w-11 items-center justify-center rounded-full bg-white/15 px-3 text-white backdrop-blur-md hover:bg-white/25 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white";
  return (
    <>
      <p role="status" aria-live="polite" data-testid="live-autoplay-status" className="sr-only">
        {needsUnmute ? "直播已靜音開始播放，請點「開啟聲音」收聽。" : ""}
      </p>
      {needsResume || needsUnmute ? (
        <div className="pointer-events-none absolute inset-x-0 top-1/3 z-20 flex justify-center px-4">
          {needsResume ? (
            <button type="button" onClick={onResume} data-testid="live-autoplay-resume" className={overlayButtonClass}>
              <Play size={20} aria-hidden="true" />
              點一下觀看直播
            </button>
          ) : (
            <button type="button" onClick={onUnmute} data-testid="live-autoplay-unmute" className={overlayButtonClass}>
              <VolumeX size={20} aria-hidden="true" />
              點一下開啟聲音
            </button>
          )}
        </div>
      ) : null}
      <button type="button" aria-label={isMuted ? "開啟直播聲音" : "將直播靜音"} aria-pressed={isMuted} data-testid="live-mute-toggle" className={smallButtonClass}
        onClick={() => {
          const video = videoRef.current;
          if (!video) return;
          if (video.muted) onUnmute();
          else video.muted = true;
        }}>
        {isMuted ? <VolumeX size={16} aria-hidden="true" /> : <Volume2 size={16} aria-hidden="true" />}
      </button>
      <button type="button" aria-label="全螢幕觀看直播" data-testid="live-fullscreen" className={smallButtonClass}
        onClick={() => enterVideoFullscreen(videoRef.current)}>
        <Maximize2 size={16} aria-hidden="true" />
      </button>
    </>
  );
}

/**
 * Autoplay and live-position behaviour for a scheduled broadcast inside its
 * live window. Outside it (replay, waiting, unavailable) every member is inert,
 * so the regular player is untouched.
 */
export function useLiveWindowPlayback({
  runtimeState,
  isPlayableRuntime,
  admitted,
  streamQuotaExhausted,
  evergreenLocked,
  isBrowserStream,
  hasVideo,
  videoRef,
  isPaused,
  isMuted,
  setIsMuted,
}: {
  runtimeState: string;
  isPlayableRuntime: boolean;
  admitted: boolean;
  streamQuotaExhausted: boolean;
  /** A locked evergreen session follows its own clock. */
  evergreenLocked: boolean;
  /** A browser stream has no offset to track. */
  isBrowserStream: boolean;
  hasVideo: boolean;
  videoRef: RefObject<HTMLVideoElement | null>;
  isPaused: boolean;
  isMuted: boolean;
  setIsMuted: (muted: boolean) => void;
}) {
  const active = isPlayableRuntime && runtimeState === "playing";
  const autoplayEnabled = active && admitted && !streamQuotaExhausted;
  const trackClock = active && !evergreenLocked && !isBrowserStream;
  const [status, setStatus] = useState<LiveAutoplayStatus>("pending");
  const clockRef = useRef<{ startSeconds: number; atMs: number } | null>(null);

  const play = useMemo(() => async (video: HTMLVideoElement) => {
    const attempt = async () => {
      const result = video.play() as Promise<void> | undefined;
      if (result && typeof result.then === "function") await result;
    };
    try {
      await attempt();
      setStatus(video.muted ? "muted" : "settled");
    } catch (error) {
      if ((error as { name?: string } | null)?.name !== "NotAllowedError") return setStatus("settled");
      // Browsers refuse autoplay with sound; muted autoplay is always allowed.
      video.muted = true;
      setIsMuted(true);
      try {
        await attempt();
        setStatus("muted");
      } catch {
        video.muted = false;
        setIsMuted(false);
        setStatus("settled");
      }
    }
  }, [setIsMuted]);

  const begin = useMemo(() => (video: HTMLVideoElement, startSeconds: number) => {
    // The live position keeps moving while the viewer is away or paused.
    clockRef.current = trackClock ? { startSeconds, atMs: Date.now() } : null;
    if (autoplayEnabled) void play(video);
  }, [autoplayEnabled, play, trackClock]);

  const seekToLivePosition = useMemo(() => (video: HTMLVideoElement) => {
    const clock = clockRef.current;
    if (!active || !clock) return;
    let target = clock.startSeconds + (Date.now() - clock.atMs) / 1_000;
    if (Number.isFinite(video.duration) && video.duration > 0) target = Math.min(target, video.duration);
    if (video.currentTime < target - LIVE_RESUME_TOLERANCE_SECONDS) video.currentTime = target;
  }, [active]);

  const resume = useMemo(() => () => {
    const video = videoRef.current;
    if (!video) return;
    seekToLivePosition(video);
    void play(video);
  }, [play, seekToLivePosition, videoRef]);

  const unmute = useMemo(() => () => {
    const video = videoRef.current;
    if (!video) return;
    video.muted = false;
    if (video.volume === 0) video.volume = 1;
    setIsMuted(false);
    setStatus("settled");
  }, [setIsMuted, videoRef]);

  const controls: ReactNode = active && hasVideo && admitted && !streamQuotaExhausted
    ? <LiveAutoplayControls videoRef={videoRef} status={status} isPaused={isPaused} isMuted={isMuted} onUnmute={unmute} onResume={resume} />
    : undefined;

  return { active, begin, seekToLivePosition, resumeWhenLive: active ? resume : undefined, controls, markEnded: () => setStatus("ended") };
}
