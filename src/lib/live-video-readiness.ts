import type { Prisma } from "@prisma/client";

export type LiveVideoReadiness = {
  sourceType: string;
  status: string;
  cloudflareReadyToStream: boolean;
  cloudflareLiveInputUid: string | null;
  liveInputStatus: string | null;
};

/** Shared fail-closed selector for every surface that can expose a live video. */
export function liveReadyVideoWhere(vendorId: string, id?: string): Prisma.VideoWhereInput {
  return {
    vendorId,
    ...(id ? { id } : {}),
    OR: [
      { sourceType: "url", status: "ready" },
      { sourceType: "cloudflare_stream", status: "ready", cloudflareReadyToStream: true },
      {
        sourceType: "cloudflare_live",
        status: { not: "archived" },
        cloudflareLiveInputUid: { not: null },
        liveInputStatus: "created",
      },
    ],
  };
}

export function isLiveVideoReady(video: LiveVideoReadiness | null | undefined) {
  if (!video) return false;
  if (video.sourceType === "url") return video.status === "ready";
  if (video.sourceType === "cloudflare_stream") {
    return video.status === "ready" && video.cloudflareReadyToStream;
  }
  if (video.sourceType === "cloudflare_live") {
    return video.status !== "archived"
      && Boolean(video.cloudflareLiveInputUid)
      && video.liveInputStatus === "created";
  }
  return false;
}

/**
 * Existing Live and registration-page references may keep playing after a
 * soft archive. New bindings must continue using isLiveVideoReady above.
 */
export function isExistingLiveVideoReady(video: LiveVideoReadiness | null | undefined) {
  if (!video) return false;
  if (video.sourceType === "url") return video.status === "ready" || video.status === "archived";
  if (video.sourceType === "cloudflare_stream") {
    return (video.status === "ready" || video.status === "archived") && video.cloudflareReadyToStream;
  }
  if (video.sourceType === "cloudflare_live") {
    return Boolean(video.cloudflareLiveInputUid) && video.liveInputStatus === "created";
  }
  return false;
}
