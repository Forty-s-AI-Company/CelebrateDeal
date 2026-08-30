"use client";

import { useEffect, useRef, useState } from "react";
import { LoaderCircle, RotateCcw } from "lucide-react";

export const VIDEO_STATUS_POLL_INTERVAL_MS = 4_000;
export const VIDEO_STATUS_MAX_POLL_ATTEMPTS = 15;

export type VideoProviderSnapshot = {
  status: string;
  cloudflareReadyToStream: boolean;
  durationSec: number;
  estimatedMinutes: number;
  thumbnailUrl: string | null;
  videoUrl: string | null;
  resourceId: string;
};

type VideoProviderStatusProps = {
  videoId: string;
  initial: VideoProviderSnapshot;
  durationInputName?: string;
  estimatedMinutesInputName?: string;
};

type CheckPhase = "idle" | "checking" | "error";

export function isVideoProviderReady(snapshot: Pick<VideoProviderSnapshot, "status" | "cloudflareReadyToStream">) {
  return snapshot.status === "ready" && snapshot.cloudflareReadyToStream;
}

export function isVideoProviderError(snapshot: Pick<VideoProviderSnapshot, "status">) {
  return snapshot.status === "error";
}

function validNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : 0;
}

export function parseVideoProviderSnapshot(value: unknown, fallbackId: string): VideoProviderSnapshot | null {
  if (!value || typeof value !== "object" || !("video" in value)) return null;
  const video = value.video;
  if (!video || typeof video !== "object") return null;
  const candidate = video as Record<string, unknown>;
  if (typeof candidate.status !== "string" || typeof candidate.cloudflareReadyToStream !== "boolean") return null;
  return {
    status: candidate.status,
    cloudflareReadyToStream: candidate.cloudflareReadyToStream,
    durationSec: validNumber(candidate.durationSec),
    estimatedMinutes: validNumber(candidate.estimatedMinutes),
    thumbnailUrl: typeof candidate.thumbnailUrl === "string" ? candidate.thumbnailUrl : null,
    videoUrl: typeof candidate.videoUrl === "string" ? candidate.videoUrl : null,
    resourceId: typeof candidate.resourceId === "string" ? candidate.resourceId : fallbackId,
  };
}

function updateFormNumber(root: HTMLElement | null, name: string | undefined, value: number) {
  if (!root || !name) return;
  const input = root.closest("form")?.elements.namedItem(name);
  if (!(input instanceof HTMLInputElement || input instanceof HTMLTextAreaElement)) return;
  input.value = String(value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
  input.dispatchEvent(new Event("change", { bubbles: true }));
}

export function VideoProviderStatus({
  videoId,
  initial,
  durationInputName,
  estimatedMinutesInputName,
}: VideoProviderStatusProps) {
  const [snapshot, setSnapshot] = useState(initial);
  const [phase, setPhase] = useState<CheckPhase>("idle");
  const [error, setError] = useState("");
  const [retryNonce, setRetryNonce] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);

  const ready = isVideoProviderReady(snapshot);
  const providerError = isVideoProviderError(snapshot);

  useEffect(() => {
    updateFormNumber(rootRef.current, durationInputName, snapshot.durationSec);
    updateFormNumber(rootRef.current, estimatedMinutesInputName, snapshot.estimatedMinutes);
  }, [durationInputName, estimatedMinutesInputName, snapshot.durationSec, snapshot.estimatedMinutes]);

  useEffect(() => {
    if (ready || providerError) return;

    const controller = new AbortController();
    let attempts = 0;
    let timer: number | undefined;

    const check = async () => {
      if (controller.signal.aborted) return;
      attempts += 1;
      setPhase("checking");
      try {
        const response = await fetch(`/api/media/videos/status?id=${encodeURIComponent(videoId)}`, {
          method: "GET",
          cache: "no-store",
          signal: controller.signal,
          headers: {
            accept: "application/json",
            "x-celebratedeal-client": "web",
          },
        });
        if (!response.ok) throw new Error("status_request_failed");
        const next = parseVideoProviderSnapshot(await response.json(), videoId);
        if (!next) throw new Error("invalid_status_response");
        setSnapshot(next);
        setError("");
        if (isVideoProviderReady(next) || isVideoProviderError(next)) return;
        if (attempts >= VIDEO_STATUS_MAX_POLL_ATTEMPTS) {
          setPhase("error");
          setError("狀態檢查已達重試上限，影片仍不可播放。可以重新檢查。 ");
          return;
        }
        timer = window.setTimeout(() => void check(), VIDEO_STATUS_POLL_INTERVAL_MS);
      } catch (reason) {
        if (controller.signal.aborted) return;
        setPhase("error");
        setError(reason instanceof Error && reason.message === "invalid_status_response"
          ? "狀態服務回傳格式不完整，影片仍不可播放。"
          : "暫時無法取得 Cloudflare 狀態，影片仍不可播放。",
        );
      }
    };

    void check();
    return () => {
      controller.abort();
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, [providerError, ready, retryNonce, videoId]);

  function retryStatusCheck() {
    setError("");
    setPhase("idle");
    setSnapshot((current) => current.status === "error"
      ? { ...current, status: "processing", cloudflareReadyToStream: false }
      : current);
    setRetryNonce((value) => value + 1);
  }

  return (
    <div ref={rootRef} className="rounded-lg border border-border bg-slate-50 p-3 text-sm text-slate-700" role="status" aria-live="polite">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="font-semibold">
          Provider 狀態：{ready ? "ready" : providerError ? "error" : "processing"}
        </p>
        {phase === "checking" && !ready && !providerError ? <LoaderCircle size={16} className="animate-spin motion-reduce:animate-none" aria-label="檢查中" /> : null}
      </div>
      <p className="mt-1 text-xs text-slate-500">
        {ready
          ? "Cloudflare ready，影片可播放。"
          : providerError
            ? "Cloudflare processing 失敗，影片目前不可播放。"
            : phase === "error"
              ? error
              : phase === "checking"
                ? "正在等待 Cloudflare 轉檔狀態；影片目前尚未可播放。"
                : "Cloudflare 正在處理，影片目前尚未可播放。"}
      </p>
      {phase === "error" || providerError ? (
        <button
          type="button"
          onClick={retryStatusCheck}
          disabled={phase === "checking"}
          className="mt-3 inline-flex min-h-9 items-center gap-2 rounded-md border border-border bg-white px-3 text-xs font-semibold text-slate-700 disabled:cursor-not-allowed disabled:opacity-50"
        >
          <RotateCcw size={14} aria-hidden="true" />
          重新檢查
        </button>
      ) : null}
    </div>
  );
}
