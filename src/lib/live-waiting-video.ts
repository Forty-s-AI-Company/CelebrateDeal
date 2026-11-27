import type { Prisma } from "@prisma/client";
import { isExistingLiveVideoReady, type LiveVideoReadiness } from "@/lib/live-video-readiness";

/**
 * 開播前等候影片（owner 2026-11-27）：商家為一場直播選一支自己的預錄影片，
 * 開播前在等候室背景靜音循環播放。這個檔案只放 client 也能用的規則；
 * 播放來源在 `live-waiting-source.ts`（server only）。
 *
 * - 只接受點播影片（`url`、`cloudflare_stream`）：即時直播輸入或瀏覽器直播不能當背景循環。
 * - 只接受 5 分鐘以內、長度已知的影片，而且不能是這場的主影片：等候影片不入場、
 *   不計量，不能被拿來免費、不限人數地播放完整內容（PR #734 審查 M-1）。
 * - 只在這位觀眾的開播時間前 60 分鐘內提供，更早只顯示海報。
 */
export const WAITING_VIDEO_SOURCE_TYPES: ReadonlySet<string> = new Set(["url", "cloudflare_stream"]);
/** Longest waiting loop: 5 minutes. A length of 0 (unknown) is refused. */
export const WAITING_VIDEO_MAX_DURATION_SECONDS = 300;
/** The waiting video is served only this long before the viewer's own start. */
export const WAITING_VIDEO_LEAD_MS = 60 * 60_000;
/** A signed waiting URL expires at most this long after the viewer's own start. */
export const WAITING_VIDEO_TOKEN_GRACE_SECONDS = 60;

/** New bindings: a ready, same-vendor VOD of a known length up to 5 minutes (the stepper options and the publish action). */
export function liveWaitingVideoWhere(vendorId: string, id?: string): Prisma.VideoWhereInput {
  return {
    vendorId,
    ...(id ? { id } : {}),
    durationSec: { gt: 0, lte: WAITING_VIDEO_MAX_DURATION_SECONDS },
    OR: [
      { sourceType: "url", status: "ready" },
      { sourceType: "cloudflare_stream", status: "ready", cloudflareReadyToStream: true },
    ],
  };
}

export function isWaitingVideoSourceType(sourceType: string | null | undefined) {
  return typeof sourceType === "string" && WAITING_VIDEO_SOURCE_TYPES.has(sourceType);
}

/** A known length (seconds) of at least 1 second and at most 5 minutes; null, 0 or anything else is refused. */
export function isWaitingVideoDurationAllowed(durationSec: number | null | undefined) {
  return typeof durationSec === "number" && Number.isInteger(durationSec)
    && durationSec > 0 && durationSec <= WAITING_VIDEO_MAX_DURATION_SECONDS;
}

/** A stepper option that can be offered as the waiting video. */
export function isWaitingVideoOption(video: { sourceType?: string; durationSec?: number | null }) {
  return isWaitingVideoSourceType(video.sourceType) && isWaitingVideoDurationAllowed(video.durationSec);
}

/**
 * An existing binding keeps playing after a soft archive, like the main video
 * (isExistingLiveVideoReady); it must still be a short VOD of the Live's own
 * vendor and not the Live's main video.
 */
export function isWaitingVideoPlayable(
  video: (LiveVideoReadiness & { vendorId: string; durationSec: number | null }) | null | undefined,
  live: { vendorId: string; videoId: string | null; waitingVideoId: string | null },
) {
  return Boolean(
    video
    && live.waitingVideoId
    && live.waitingVideoId !== live.videoId
    && video.vendorId === live.vendorId
    && isWaitingVideoSourceType(video.sourceType)
    && isWaitingVideoDurationAllowed(video.durationSec)
    && isExistingLiveVideoReady(video),
  );
}

/** When the waiting video may start for a viewer whose own start is `startMs`. */
export function waitingVideoWindowOpensAtMs(startMs: number) {
  return startMs - WAITING_VIDEO_LEAD_MS;
}

/** True from 60 minutes before the viewer's own start (inclusive). */
export function isWithinWaitingVideoWindow(startMs: number, nowMs: number) {
  return Number.isFinite(startMs) && Number.isFinite(nowMs) && nowMs >= waitingVideoWindowOpensAtMs(startMs);
}

export const WAITING_VIDEO_READINESS_SELECT = {
  vendorId: true,
  sourceType: true,
  status: true,
  durationSec: true,
  cloudflareReadyToStream: true,
  cloudflareLiveInputUid: true,
  liveInputStatus: true,
} as const satisfies Prisma.VideoSelect;
