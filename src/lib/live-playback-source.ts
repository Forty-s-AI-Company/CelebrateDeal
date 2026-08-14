import type { PrismaClient } from "@prisma/client";
import { parseSafeExternalHttpUrl } from "@/lib/external-url";
import { hasActiveLiveViewerSession } from "@/lib/live-quota-admission";
import { isLiveVideoReady } from "@/lib/live-video-readiness";

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
      video: {
        select: {
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
  if (!isLiveVideoReady(live?.video)) return null;
  const playbackUrl = parseSafeExternalHttpUrl(live?.video?.videoUrl);
  return playbackUrl ? { playbackUrl } : null;
}
