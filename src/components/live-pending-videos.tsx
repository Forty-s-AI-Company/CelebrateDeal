"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { LoaderCircle, RotateCcw } from "lucide-react";
import {
  fetchVideoProviderSnapshot,
  isVideoProviderError,
  isVideoProviderReady,
  VideoProviderStatusError,
} from "@/components/video-provider-status";

/**
 * Waits between status checks of an uploaded video: soon after the upload,
 * then further apart up to three minutes (about 13 minutes in all). After the
 * last one the row offers 「重新檢查」, which starts the schedule again.
 */
export const LIVE_PENDING_VIDEO_POLL_DELAYS_MS: readonly number[] = [
  3_000, 5_000, 10_000, 15_000, 30_000, 30_000, 60_000, 60_000, 120_000, 120_000, 180_000, 180_000,
];

/**
 * An uploaded video the studio is waiting for. `outcome` is set by the studio
 * once the video is playable: selected for this Live, or only added to the
 * options because the merchant picked another video meanwhile.
 */
export type LivePendingVideo = {
  id: string;
  title: string;
  /** The studio's manual video selection count when the upload finished. */
  manualSelectionAtStart: number;
  /** The video select's value when the upload finished: auto-select only if it still holds this. */
  selectedVideoIdAtStart: string;
  /** Upload order; a video is never auto-selected once a later upload exists. */
  uploadSeq: number;
  outcome?: "selected" | "added";
  /** Why a ready video was only added to the options (set with `outcome: "added"`). */
  addedReason?: LivePendingAddedReason;
};

export type LivePendingAddedReason = "other-selection" | "newer-upload" | "submitting";

export type LivePendingVideoProblem = "failed" | "archived" | "missing";

type PollState = "checking" | "stalled" | "ready" | LivePendingVideoProblem;

function isPageHidden() {
  return typeof document !== "undefined" && document.visibilityState === "hidden";
}

/**
 * Polls the tenant-scoped status route on the schedule above while the page
 * is visible. A hidden page waits: the due check runs when it is shown again.
 * Request failures other than 404 count as an attempt and keep the schedule.
 */
function usePendingVideoPoll(videoId: string, enabled: boolean, onReady: () => void, onProblem: (problem: LivePendingVideoProblem) => void) {
  const [state, setState] = useState<PollState>("checking");
  const [round, setRound] = useState(0);
  const callbacksRef = useRef({ onReady, onProblem });
  useEffect(() => { callbacksRef.current = { onReady, onProblem }; });

  useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();
    let attempt = 0;
    let timer: number | undefined;
    let dueWhileHidden = false;

    const finish = (next: PollState) => {
      setState(next);
      if (next === "ready") callbacksRef.current.onReady();
      else if (next === "failed" || next === "archived" || next === "missing") callbacksRef.current.onProblem(next);
    };

    const schedule = () => {
      const delay = LIVE_PENDING_VIDEO_POLL_DELAYS_MS[attempt];
      if (delay === undefined) {
        setState("stalled");
        return;
      }
      timer = window.setTimeout(() => { timer = undefined; void check(); }, delay);
    };

    const check = async () => {
      if (controller.signal.aborted) return;
      if (isPageHidden()) {
        dueWhileHidden = true;
        return;
      }
      attempt += 1;
      try {
        const snapshot = await fetchVideoProviderSnapshot(videoId, controller.signal);
        if (controller.signal.aborted) return;
        if (isVideoProviderReady(snapshot)) return finish("ready");
        if (isVideoProviderError(snapshot)) return finish("failed");
        if (snapshot.status === "archived") return finish("archived");
      } catch (reason) {
        if (controller.signal.aborted) return;
        if (reason instanceof VideoProviderStatusError && reason.httpStatus === 404) return finish("missing");
      }
      schedule();
    };

    const resumeWhenVisible = () => {
      if (isPageHidden() || !dueWhileHidden) return;
      dueWhileHidden = false;
      void check();
    };

    document.addEventListener("visibilitychange", resumeWhenVisible);
    schedule();
    return () => {
      controller.abort();
      document.removeEventListener("visibilitychange", resumeWhenVisible);
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, [enabled, round, videoId]);

  function retry() {
    setState("checking");
    setRound((value) => value + 1);
  }

  return { state, retry };
}

function VideosLink() {
  return (
    <Link href="/videos" target="_blank" rel="noopener" className="font-semibold text-primary underline">
      到影片列表查看<span className="sr-only">（另開新分頁）</span>
    </Link>
  );
}

function PendingVideoRow({
  video,
  onReady,
  onProblem,
}: {
  video: LivePendingVideo;
  onReady: (video: LivePendingVideo) => void;
  onProblem: (video: LivePendingVideo, problem: LivePendingVideoProblem) => void;
}) {
  const poll = usePendingVideoPoll(video.id, !video.outcome, () => onReady(video), (problem) => onProblem(video, problem));
  const name = `「${video.title}」`;
  let body: ReactNode;
  if (video.outcome === "selected") {
    body = <p className="font-medium text-emerald-800">{name}已可播放，已自動選為這場直播的影片。</p>;
  } else if (video.outcome === "added") {
    const reason = video.addedReason === "submitting"
      ? "精靈正在送出，所以沒有自動選取；請在送出完成後從影片選單手動選取。"
      : video.addedReason === "newer-upload"
        ? "你之後又新增了其他影片，所以沒有自動切換。"
        : "你已選了其他影片，所以沒有自動切換。";
    body = <p className="font-medium text-emerald-800">{name}已可播放並加入選單；{reason}</p>;
  } else if (poll.state === "failed") {
    body = <p className="text-red-800">{name}轉檔失敗，無法播放。請重新上傳，或<VideosLink />。</p>;
  } else if (poll.state === "archived") {
    body = <p className="text-red-800">{name}已被封存，不能選為直播影片。<VideosLink /></p>;
  } else if (poll.state === "missing") {
    body = <p className="text-red-800">找不到{name}，可能已被刪除。<VideosLink /></p>;
  } else if (poll.state === "stalled") {
    body = (
      <div className="grid gap-2">
        <p className="text-slate-700">{name}仍在轉檔，已暫停自動檢查。可以稍後再檢查，或<VideosLink />。</p>
        <button
          type="button"
          onClick={poll.retry}
          className="inline-flex min-h-11 w-fit items-center gap-2 rounded-md border border-border bg-white px-3 text-sm font-semibold text-slate-700 hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
        >
          <RotateCcw size={14} aria-hidden="true" />
          重新檢查<span className="sr-only">{name}</span>
        </button>
      </div>
    );
  } else {
    body = (
      <p className="flex items-start gap-2 text-slate-700">
        <LoaderCircle size={16} className="mt-0.5 shrink-0 animate-spin motion-reduce:animate-none" aria-hidden="true" />
        <span>處理中的影片：{name}，轉檔完成後會自動選取。</span>
      </p>
    );
  }
  const problem = poll.state === "failed" || poll.state === "archived" || poll.state === "missing";
  return (
    <li data-pending-video={video.id} className={`rounded-md border px-3 py-2 text-sm ${video.outcome ? "border-emerald-200 bg-emerald-50" : problem ? "border-red-200 bg-red-50" : "border-blue-100 bg-blue-50"}`}>
      {body}
    </li>
  );
}

/**
 * Uploaded videos under the studio's video select until they can play. The
 * list lives in this page only: after a reload the videos stay in /videos and
 * join the select once ready, so the hint says the merchant can move on.
 */
export function LivePendingVideos({
  videos,
  onReady,
  onProblem,
}: {
  videos: LivePendingVideo[];
  onReady: (video: LivePendingVideo) => void;
  onProblem: (video: LivePendingVideo, problem: LivePendingVideoProblem) => void;
}) {
  if (videos.length === 0) return null;
  const waiting = videos.some((video) => !video.outcome);
  return (
    <div className="grid gap-2" data-live-pending-videos="true">
      <ul aria-label="上傳的影片" className="grid gap-2">
        {videos.map((video) => <PendingVideoRow key={video.id} video={video} onReady={onReady} onProblem={onProblem} />)}
      </ul>
      {waiting ? (
        <p className="text-xs leading-5 text-slate-600">
          可以先繼續其他步驟。離開或重新整理這頁後這裡不會再顯示，但影片仍在「影片」列表，轉檔完成後也會出現在上方選單。重新整理或重新載入精靈後這份清單會消失，屆時請從影片下拉手動選取。
        </p>
      ) : null}
    </div>
  );
}
