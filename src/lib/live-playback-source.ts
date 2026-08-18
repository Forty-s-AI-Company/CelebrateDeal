import type { PrismaClient } from "@prisma/client";
import { parseSafeExternalHttpUrl } from "@/lib/external-url";
import { hasActiveLiveViewerSession } from "@/lib/live-quota-admission";
import { isLiveVideoReady } from "@/lib/live-video-readiness";
import { resolveLiveRuntime } from "@/lib/live-runtime-state";

type PlaybackSourceInput = {
  vendorId: string;
  liveId: string;
  token: string;
  now?: Date;
};

/** Resolves a playback URL only for an unexpired session bound to this live and vendor. */
export async function resolveLivePlaybackSource(db: PrismaClient, input: PlaybackSourceInput) {
  const now = input.now ?? new Date();
  if (!await hasActiveLiveViewerSession(db, { ...input, now })) return null;

  const live = await db.live.findFirst({
    where: {
      id: input.liveId,
      vendorId: input.vendorId,
      OR: [
        { status: { in: ["scheduled", "live"] } },
        { status: "ended", replayEnabled: true },
      ],
    },
    select: {
      streamMode: true,
      scheduledAt: true,
      status: true,
      startedAt: true,
      endedAt: true,
      replayAvailableUntil: true,
      replayEnabled: true,
      video: {
        select: {
          vendorId: true,
          durationSec: true,
          videoUrl: true,
          sourceType: true,
          status: true,
          cloudflareReadyToStream: true,
          cloudflareLiveInputUid: true,
          liveInputStatus: true,
        },
      },
    },
  });
  const runtime = resolveLiveRuntime(live ?? {
    streamMode: "unknown",
    scheduledAt: null,
    status: "unknown",
    startedAt: null,
    endedAt: null,
    replayAvailableUntil: null,
    replayEnabled: false,
  }, now);
  if (runtime.state === "unavailable" || runtime.state === "waiting") return null;
  if (live?.video?.vendorId !== input.vendorId) return null;
  if (!isLiveVideoReady(live?.video)) return null;
  const playbackUrl = parseSafeExternalHttpUrl(live?.video?.videoUrl);
  if (!playbackUrl) return null;
  return runtime.playbackStartSeconds === null
    ? { playbackUrl }
    : { playbackUrl, playbackStartSeconds: runtime.playbackStartSeconds };
}
