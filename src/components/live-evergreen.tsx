"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { EvergreenRoomState, EvergreenScheduleMode } from "@/lib/evergreen-webinar";

const clientHeaders = {
  "Content-Type": "application/json",
  "X-CelebrateDeal-Client": "web",
};

export const EVERGREEN_SESSION_ENDPOINT = "/api/live-evergreen-session";
/** Seconds a viewer may run ahead of the session clock before being pulled back. */
export const EVERGREEN_SEEK_TOLERANCE_SECONDS = 2;
/** Resuming further behind than this rejoins the session at its current second. */
export const EVERGREEN_REJOIN_GAP_SECONDS = 3;
const REVEAL_REFRESH_PADDING_MS = 750;
const MIN_REFRESH_DELAY_MS = 1_000;

/** Server projection of the visitor's own evergreen session (never the cookie). */
export type LiveEvergreenData = {
  assigned: boolean;
  mode: EvergreenScheduleMode;
  timezone: string;
  roomState: EvergreenRoomState;
  sessionStartAt: string;
  sessionEndAt: string;
  /** Session offset at the page's serverNow. */
  offsetSeconds: number;
  /** Next withheld offer second, or null when nothing else will be revealed. */
  nextRevealAtSec: number | null;
  canRejoin: boolean;
};

type EvergreenLive = {
  id: string;
  vendorId: string;
  evergreen?: LiveEvergreenData;
};

export function evergreenSessionTimeLabel(evergreen: Pick<LiveEvergreenData, "sessionStartAt" | "timezone">) {
  const start = new Date(evergreen.sessionStartAt);
  if (!Number.isFinite(start.getTime())) return null;
  try {
    const formatted = new Intl.DateTimeFormat("zh-TW", {
      timeZone: evergreen.timezone,
      month: "long",
      day: "numeric",
      weekday: "short",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).format(start);
    return `${formatted}（${evergreen.timezone}）`;
  } catch {
    return null;
  }
}

export function evergreenCountdownLabel(seconds: number | null) {
  if (seconds === null) return "場次時間待確認";
  if (seconds <= 0) return "你的場次即將開始，正在更新…";
  const hours = Math.floor(seconds / 3_600);
  const minutes = Math.floor((seconds % 3_600) / 60);
  const remain = seconds % 60;
  const clock = `${String(minutes).padStart(2, "0")}:${String(remain).padStart(2, "0")}`;
  return `距離你的場次開始 ${hours > 0 ? `${hours}:${clock}` : clock}`;
}

/** True while public playback must stay locked to the session clock. */
export function isEvergreenSessionLocked(live: EvergreenLive, runtimeState: string) {
  return live.evergreen?.assigned === true && live.evergreen.roomState === "playing" && runtimeState === "playing";
}

async function postEvergreenSession(live: EvergreenLive, intent: "claim" | "rejoin") {
  const response = await fetch(EVERGREEN_SESSION_ENDPOINT, {
    method: "POST",
    headers: clientHeaders,
    body: JSON.stringify({ vendorId: live.vendorId, liveId: live.id, intent }),
  });
  return response.ok;
}

export type EvergreenClaimStatus = "idle" | "claiming" | "cookie_blocked" | "failed";

/**
 * A first visit has no signed session; Server Components cannot write one,
 * so the page asks the session Route Handler once and re-renders. Only the
 * server picks the start time.
 */
export function useEvergreenSessionClaim(live: EvergreenLive, refresh: () => void): EvergreenClaimStatus {
  const identity = `${live.vendorId}:${live.id}`;
  const needsClaim = Boolean(live.evergreen && !live.evergreen.assigned);
  const [claim, setClaim] = useState<{ identity: string; status: "pending" | "done" | "failed"; live: EvergreenLive | null }>(
    () => ({ identity: "", status: "pending", live: null }),
  );
  const attemptedRef = useRef<string | null>(null);
  const liveRef = useRef(live);
  useEffect(() => {
    liveRef.current = live;
  });

  useEffect(() => {
    if (!needsClaim || attemptedRef.current === identity) return;
    attemptedRef.current = identity;
    void postEvergreenSession(liveRef.current, "claim")
      .then((ok) => {
        setClaim({ identity, status: ok ? "done" : "failed", live: liveRef.current });
        if (ok) refresh();
      })
      .catch(() => setClaim({ identity, status: "failed", live: liveRef.current }));
  }, [identity, needsClaim, refresh]);

  if (!needsClaim) return "idle";
  if (claim.identity !== identity) return "claiming";
  if (claim.status === "failed") return "failed";
  // The server rendered again after a successful claim and still saw no
  // session: the browser refused the cookie.
  if (claim.status === "done" && claim.live !== live) return "cookie_blocked";
  return "claiming";
}

/**
 * The furthest second this visitor's session has reached, measured from the
 * server offset plus local elapsed time. Before the base is captured it falls
 * back to the server offset, so it never runs ahead.
 */
export function useEvergreenSessionClock(live: EvergreenLive, durationSeconds: number | null) {
  const evergreen = live.evergreen;
  const identity = evergreen ? `${live.id}:${evergreen.sessionStartAt}:${evergreen.offsetSeconds}` : "";
  const baseRef = useRef<{ identity: string; receivedAtMs: number } | null>(null);
  useEffect(() => {
    if (!identity) return;
    if (baseRef.current?.identity !== identity) baseRef.current = { identity, receivedAtMs: Date.now() };
  }, [identity]);
  const offsetSeconds = evergreen?.offsetSeconds ?? 0;
  return useMemo(() => () => {
    const base = baseRef.current;
    const elapsed = base && base.identity === identity ? Math.max(0, (Date.now() - base.receivedAtMs) / 1_000) : 0;
    const allowed = offsetSeconds + elapsed;
    return durationSeconds !== null && durationSeconds > 0 ? Math.min(durationSeconds, allowed) : allowed;
  }, [durationSeconds, identity, offsetSeconds]);
}

/**
 * Re-renders from the server when the session reaches its next withheld offer
 * or its end, so newly reached offers arrive from the server, not the client.
 */
export function useEvergreenRevealRefresh(live: EvergreenLive, locked: boolean, refresh: () => void) {
  const evergreen = live.evergreen;
  const nextRevealAtSec = evergreen?.nextRevealAtSec ?? null;
  const offsetSeconds = evergreen?.offsetSeconds ?? 0;
  const sessionStartAt = evergreen?.sessionStartAt ?? "";
  const sessionEndAt = evergreen?.sessionEndAt ?? "";
  useEffect(() => {
    if (!locked || typeof window === "undefined") return;
    const startMs = Date.parse(sessionStartAt);
    const endMs = Date.parse(sessionEndAt);
    const durationSeconds = Number.isFinite(startMs) && Number.isFinite(endMs) ? (endMs - startMs) / 1_000 : null;
    const targets = [nextRevealAtSec, durationSeconds].filter((value): value is number => value !== null && Number.isFinite(value));
    if (targets.length === 0) return;
    const target = Math.min(...targets);
    const delay = Math.max(MIN_REFRESH_DELAY_MS, (target - offsetSeconds) * 1_000 + REVEAL_REFRESH_PADDING_MS);
    const timer = window.setTimeout(refresh, delay);
    return () => window.clearTimeout(timer);
  }, [locked, nextRevealAtSec, offsetSeconds, refresh, sessionEndAt, sessionStartAt]);
}

/** Keeps a locked session at normal speed and never ahead of its clock. */
export function enforceEvergreenPosition(video: Pick<HTMLVideoElement, "currentTime" | "playbackRate">, allowedSeconds: number, options: { rejoin?: boolean } = {}) {
  if (video.playbackRate !== 1) video.playbackRate = 1;
  if (video.currentTime > allowedSeconds + EVERGREEN_SEEK_TOLERANCE_SECONDS) {
    video.currentTime = allowedSeconds;
  } else if (options.rejoin && video.currentTime < allowedSeconds - EVERGREEN_REJOIN_GAP_SECONDS) {
    video.currentTime = allowedSeconds;
  }
  return Math.min(video.currentTime, allowedSeconds);
}

export function useEvergreenRejoin(live: EvergreenLive, refresh: () => void) {
  const [state, setState] = useState<{ identity: string; status: "idle" | "pending" | "failed" }>({ identity: "", status: "idle" });
  const identity = `${live.vendorId}:${live.id}:${live.evergreen?.sessionStartAt ?? ""}`;
  const status = state.identity === identity ? state.status : "idle";
  return {
    status,
    rejoin: async () => {
      if (status === "pending") return;
      setState({ identity, status: "pending" });
      try {
        const ok = await postEvergreenSession(live, "rejoin");
        setState({ identity, status: ok ? "idle" : "failed" });
        if (ok) refresh();
      } catch {
        setState({ identity, status: "failed" });
      }
    },
  };
}

function sessionDurationSeconds(evergreen: LiveEvergreenData | undefined) {
  if (!evergreen) return null;
  const seconds = (Date.parse(evergreen.sessionEndAt) - Date.parse(evergreen.sessionStartAt)) / 1_000;
  return Number.isFinite(seconds) && seconds > 0 ? seconds : null;
}

type GuardedVideo = Pick<HTMLVideoElement, "currentTime" | "playbackRate">;

/**
 * Everything the public player needs for an evergreen Live. For any other
 * Live `locked` is false and every handler is a no-op, so the regular
 * playback path stays unchanged.
 */
export function useEvergreenPlayback({ live, runtimeState, refresh, onTick }: {
  live: EvergreenLive;
  runtimeState: string;
  refresh: () => void;
  /** Receives the session second while locked, whether or not the video plays. */
  onTick: (seconds: number) => void;
}) {
  const locked = isEvergreenSessionLocked(live, runtimeState);
  const claimStatus = useEvergreenSessionClaim(live, refresh);
  const allowedSeconds = useEvergreenSessionClock(live, sessionDurationSeconds(live.evergreen));
  useEvergreenRevealRefresh(live, locked, refresh);
  useEffect(() => {
    if (!locked || typeof window === "undefined") return;
    const tick = () => onTick(Math.floor(allowedSeconds()));
    tick();
    const timer = window.setInterval(tick, 1_000);
    return () => window.clearInterval(timer);
  }, [allowedSeconds, locked, onTick]);
  const rejoin = useEvergreenRejoin(live, refresh);
  return {
    locked,
    claimStatus,
    rejoin,
    /**
     * Timeline position. A locked session follows its own clock, like a live
     * room: pausing or seeking the video neither stops nor advances it.
     */
    position: (video: GuardedVideo) => {
      if (!locked) return video.currentTime;
      enforceEvergreenPosition(video, allowedSeconds());
      return allowedSeconds();
    },
    /** Seek, rate change and resume guard; `resume` rejoins the session's current second. */
    guard: (video: GuardedVideo, resume = false) => {
      if (locked) enforceEvergreenPosition(video, allowedSeconds(), { rejoin: resume });
    },
  };
}

export function EvergreenPreparingNotice({ status }: { status: EvergreenClaimStatus }) {
  const message = status === "cookie_blocked"
    ? "瀏覽器未保存你的場次。請允許此網站使用 Cookie 後重新整理頁面。"
    : status === "failed"
      ? "目前無法安排你的場次，請稍後重新整理頁面再試。"
      : "正在為你安排場次…";
  return (
    <div data-testid="evergreen-preparing" role="status" className="relative z-10 mx-4 mb-24 rounded-3xl border border-white/15 bg-black/45 p-6 text-center shadow-2xl backdrop-blur-md">
      <p className="text-xs font-black uppercase tracking-[0.24em] text-white/60">自動播放場次</p>
      <p className="mt-3 text-base font-black" aria-live="polite">{message}</p>
      <p className="mt-2 text-xs leading-5 text-white/55">場次時間由系統依主辦方排程安排；安排完成前不會載入播放來源。</p>
    </div>
  );
}

export function EvergreenEndedNotice({
  title,
  evergreen,
  rejoinStatus,
  onRejoin,
}: {
  title: string;
  evergreen: LiveEvergreenData;
  rejoinStatus: "idle" | "pending" | "failed";
  onRejoin: () => void;
}) {
  const label = evergreen.mode === "on_demand" ? "重新觀看" : "安排下一場";
  return (
    <div data-testid="evergreen-ended" role="status" className="relative z-10 mx-4 mb-24 rounded-3xl border border-white/15 bg-black/45 p-6 text-center shadow-2xl backdrop-blur-md">
      <div className="mx-auto grid max-w-xs gap-3">
        <p className="text-xs font-black uppercase tracking-[0.24em] text-white/60">場次狀態</p>
        <h2 className="text-2xl font-black">你的場次已結束</h2>
        <p className="text-sm leading-6 text-white/75">「{title}」這一場已播放完畢，主辦方目前未開放回放。</p>
        {evergreen.canRejoin ? (
          <button type="button" onClick={onRejoin} disabled={rejoinStatus === "pending"} aria-busy={rejoinStatus === "pending"}
            className="min-h-11 rounded-xl bg-white px-4 text-sm font-black text-slate-950 disabled:opacity-60">
            {rejoinStatus === "pending" ? "安排中…" : label}
          </button>
        ) : null}
        {rejoinStatus === "failed" ? <p role="alert" className="text-xs text-amber-200">目前無法安排新場次，請稍後再試。</p> : null}
      </div>
    </div>
  );
}

/** Honest disclosure: an evergreen session is a pre-recorded video, not a live broadcast. */
export const EVERGREEN_DISCLOSURE = "本場為預先錄製的影片，依你的場次時間自動播放，不是即時直播。";
