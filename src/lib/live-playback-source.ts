import type { PrismaClient } from "@prisma/client";
import { parseSafeExternalHttpUrl } from "@/lib/external-url";
import { hasActiveLiveViewerSession } from "@/lib/live-quota-admission";
import { isExistingLiveVideoReady } from "@/lib/live-video-readiness";
import { EVERGREEN_LIVE_SELECT, resolveViewerLiveRuntime } from "@/lib/evergreen-viewer-session";
import { FIXED_SESSION_LIVE_SELECT, resolveViewerFixedSessionForLive } from "@/lib/live-fixed-sessions-store";

type PlaybackSourceInput = {
  vendorId: string;
  liveId: string;
  token: string;
  /** Signed evergreen session cookie; only read when the Live is evergreen. */
  evergreenToken?: string | null;
  /** Signed registration cookie; only read when the Live has fixed sessions. */
  registrationToken?: string | null;
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
      ...EVERGREEN_LIVE_SELECT,
      ...FIXED_SESSION_LIVE_SELECT,
      vendor: { select: { timezone: true } },
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
  if (!live) return null;
  // An evergreen Live serves media only inside the visitor's own signed
  // session, from that session's server-computed offset.
  // A fixed-session Live serves media from the viewer's own session offset.
  const fixedSession = await resolveViewerFixedSessionForLive(db, live, { registrationToken: input.registrationToken, now });
  const runtime = resolveViewerLiveRuntime(live, {
    vendorTimezone: live.vendor?.timezone,
    evergreenToken: input.evergreenToken,
    now,
    fixedSession,
  });
  if (runtime.state === "unavailable" || runtime.state === "waiting") return null;
  if (live?.video?.vendorId !== input.vendorId) return null;
  if (!isExistingLiveVideoReady(live?.video)) return null;
  if (live.video.sourceType === "browser_live") {
    return { protocol: "whep", playbackUrl: "/api/live-media?direction=read" };
  }
  const playbackUrl = parseSafeExternalHttpUrl(live?.video?.videoUrl);
  if (!playbackUrl) return null;
  return runtime.playbackStartSeconds === null
    ? { playbackUrl }
    : { playbackUrl, playbackStartSeconds: runtime.playbackStartSeconds };
}
