import type { Prisma } from "@prisma/client";
import { isExistingLiveVideoReady, type LiveVideoReadiness } from "@/lib/live-video-readiness";

/**
 * 開播前等候影片（owner 2026-11-27）：商家為一場直播選一支自己的預錄影片，
 * 開播前在等候室背景靜音循環播放。這個檔案只放 client 也能用的規則；
 * 播放來源在 `live-waiting-source.ts`（server only）。
 *
 * 只接受點播影片（`url`、`cloudflare_stream`）：即時直播輸入或瀏覽器直播不能當背景循環。
 */
export const WAITING_VIDEO_SOURCE_TYPES: ReadonlySet<string> = new Set(["url", "cloudflare_stream"]);

/** New bindings: a ready, same-vendor VOD (the stepper options and the publish action). */
export function liveWaitingVideoWhere(vendorId: string, id?: string): Prisma.VideoWhereInput {
  return {
    vendorId,
    ...(id ? { id } : {}),
    OR: [
      { sourceType: "url", status: "ready" },
      { sourceType: "cloudflare_stream", status: "ready", cloudflareReadyToStream: true },
    ],
  };
}

export function isWaitingVideoSourceType(sourceType: string | null | undefined) {
  return typeof sourceType === "string" && WAITING_VIDEO_SOURCE_TYPES.has(sourceType);
}

/**
 * An existing binding keeps playing after a soft archive, like the main video
 * (isExistingLiveVideoReady); it must still be a VOD of the Live's own vendor.
 */
export function isWaitingVideoPlayable(
  video: (LiveVideoReadiness & { vendorId: string }) | null | undefined,
  vendorId: string,
) {
  return Boolean(
    video
    && video.vendorId === vendorId
    && isWaitingVideoSourceType(video.sourceType)
    && isExistingLiveVideoReady(video),
  );
}

export const WAITING_VIDEO_READINESS_SELECT = {
  vendorId: true,
  sourceType: true,
  status: true,
  cloudflareReadyToStream: true,
  cloudflareLiveInputUid: true,
  liveInputStatus: true,
} as const satisfies Prisma.VideoSelect;
