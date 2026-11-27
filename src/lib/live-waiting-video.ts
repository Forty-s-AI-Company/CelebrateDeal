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
 * - 商家自填網址（`url`）的影片長度是商家自己填的：只接受路徑以 `.mp4`、`.webm`、
 *   `.mov` 結尾的直接影片檔（不接受 `.m3u8` 或其他 manifest），而且不能指向
 *   Cloudflare Stream：填 60 秒卻指向 2 小時的 Stream 影片就能繞過 5 分鐘上限
 *   （PR #734 審查 m-A、#736 審查 m-1）。副檔名只看路徑，擋不住 302 轉址到 Stream，
 *   這要靠 Production 的 Stream 簽章鎖定；商家自己主機上的長檔仍可自報長度。
 *   兩者都是已知的殘留風險（見 PRISMA_INVARIANTS）。
 * - 只在這位觀眾的開播時間前 60 分鐘內提供，更早只顯示海報。
 * - 簽章與端點的窗口在開播時間後還有一段寬限：VOD、預錄排程、常青場與指定場次
 *   60 秒（開播後主影片接手）；手動開播的即時直播（OBS、瀏覽器推流）30 分鐘，
 *   因為主播晚開時觀眾仍在等候室（審查 m-B）。
 */
export const WAITING_VIDEO_SOURCE_TYPES: ReadonlySet<string> = new Set(["url", "cloudflare_stream"]);
/** Longest waiting loop: 5 minutes. A length of 0 (unknown) is refused. */
export const WAITING_VIDEO_MAX_DURATION_SECONDS = 300;
/** The waiting video is served only this long before the viewer's own start. */
export const WAITING_VIDEO_LEAD_MS = 60 * 60_000;
/** A signed waiting URL expires at most this long after the viewer's own start (VOD and scheduled pre-recorded shows). */
export const WAITING_VIDEO_TOKEN_GRACE_SECONDS = 60;
/** A manually started live show (OBS or browser broadcast) keeps its waiting room until the host starts: 30 minutes. */
export const WAITING_VIDEO_MANUAL_START_GRACE_SECONDS = 30 * 60;

/**
 * Hosts of Cloudflare Stream (playback, thumbnails, iframe and customer
 * subdomains). Wider than `parseCloudflareStreamUrl` on purpose: a manifest
 * with a query string, an iframe page or another path on these hosts still
 * plays Stream content of any length.
 */
const CLOUDFLARE_STREAM_HOSTS = ["videodelivery.net", "cloudflarestream.com"] as const;

/** True when the URL points at Cloudflare Stream; an unparsable value is not a Stream URL. */
export function isCloudflareStreamHostedUrl(value: string | null | undefined) {
  if (typeof value !== "string") return false;
  let host: string;
  try {
    host = new URL(value.trim()).hostname.toLowerCase().replace(/\.+$/, "");
  } catch {
    return false;
  }
  return CLOUDFLARE_STREAM_HOSTS.some((suffix) => host === suffix || host.endsWith(`.${suffix}`));
}

/** Direct video files a merchant-entered waiting video may point at; no HLS/DASH manifest or page. */
const DIRECT_VIDEO_FILE_EXTENSIONS = [".mp4", ".webm", ".mov"] as const;

/** True when the URL's path (query and fragment ignored) ends in .mp4, .webm or .mov; an unparsable value is not. */
export function isDirectVideoFileUrl(value: string | null | undefined) {
  if (typeof value !== "string") return false;
  let pathname: string;
  try {
    pathname = new URL(value.trim()).pathname.toLowerCase();
  } catch {
    return false;
  }
  return DIRECT_VIDEO_FILE_EXTENSIONS.some((extension) => pathname.endsWith(extension));
}

/**
 * A merchant-entered (`url`) video that cannot be a waiting video: its length
 * is self-reported, so it must be a direct video file and must not be on
 * Cloudflare Stream (a Stream download is also an .mp4). Fails closed: a
 * missing or unparsable URL is refused. Provider rows (`cloudflare_stream`)
 * take their length from Cloudflare and are never refused here.
 */
export function isRefusedSelfReportedWaitingUrl(video: { sourceType?: string | null; videoUrl?: string | null }) {
  return video.sourceType === "url"
    && (isCloudflareStreamHostedUrl(video.videoUrl) || !isDirectVideoFileUrl(video.videoUrl));
}

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

/**
 * A stepper option, as the server hands it to the studio: the video's URL
 * stays on the server and only whether a self-reported URL is refused is sent.
 */
export type WaitingVideoOptionFields = {
  sourceType?: string;
  durationSec?: number | null;
  /** Set on the server by toLiveVideoOption: a `url` video that is not a direct file, or is on Cloudflare Stream. */
  selfReportedUrlRefused?: boolean;
};

/** A stepper option that can be offered as the waiting video. */
export function isWaitingVideoOption(video: WaitingVideoOptionFields) {
  return isWaitingVideoSourceType(video.sourceType)
    && isWaitingVideoDurationAllowed(video.durationSec)
    && video.selfReportedUrlRefused !== true;
}

/** Server side: drops the video URL from a studio option and keeps only the refused-URL flag. */
export function toLiveVideoOption<T extends { sourceType: string; videoUrl: string }>(video: T) {
  const { videoUrl, ...option } = video;
  return { ...option, selfReportedUrlRefused: isRefusedSelfReportedWaitingUrl({ sourceType: video.sourceType, videoUrl }) };
}

/**
 * An existing binding keeps playing after a soft archive, like the main video
 * (isExistingLiveVideoReady); it must still be a short VOD of the Live's own
 * vendor and not the Live's main video.
 */
export function isWaitingVideoPlayable(
  video: (LiveVideoReadiness & { vendorId: string; durationSec: number | null; videoUrl: string }) | null | undefined,
  live: { vendorId: string; videoId: string | null; waitingVideoId: string | null },
) {
  return Boolean(
    video
    && live.waitingVideoId
    && live.waitingVideoId !== live.videoId
    && video.vendorId === live.vendorId
    && isWaitingVideoSourceType(video.sourceType)
    && isWaitingVideoDurationAllowed(video.durationSec)
    && !isRefusedSelfReportedWaitingUrl(video)
    && isExistingLiveVideoReady(video),
  );
}

/** When the waiting video may start for a viewer whose own start is `startMs`. */
export function waitingVideoWindowOpensAtMs(startMs: number) {
  return startMs - WAITING_VIDEO_LEAD_MS;
}

/**
 * How long after the viewer's own start the waiting video may still be served
 * and its signed URL stay valid. Only a Live-input show (`streamMode` other
 * than `vod`) that the viewer follows on the shared start waits for the host
 * to go live, so it alone gets 30 minutes; VOD, scheduled pre-recorded,
 * evergreen and fixed-session viewers switch to the main video at their start.
 */
export function waitingVideoGraceSeconds(input: { streamMode: string; followsSharedStart: boolean }) {
  return input.streamMode !== "vod" && input.followsSharedStart
    ? WAITING_VIDEO_MANUAL_START_GRACE_SECONDS
    : WAITING_VIDEO_TOKEN_GRACE_SECONDS;
}

/** True from 60 minutes before the viewer's own start (inclusive) until `graceSeconds` after it (exclusive). */
export function isWithinWaitingVideoWindow(startMs: number, nowMs: number, graceSeconds = WAITING_VIDEO_TOKEN_GRACE_SECONDS) {
  return Number.isFinite(startMs) && Number.isFinite(nowMs) && Number.isFinite(graceSeconds)
    && nowMs >= waitingVideoWindowOpensAtMs(startMs)
    && nowMs < startMs + graceSeconds * 1_000;
}

export const WAITING_VIDEO_READINESS_SELECT = {
  vendorId: true,
  sourceType: true,
  status: true,
  durationSec: true,
  cloudflareReadyToStream: true,
  cloudflareLiveInputUid: true,
  liveInputStatus: true,
  videoUrl: true,
} as const satisfies Prisma.VideoSelect;
