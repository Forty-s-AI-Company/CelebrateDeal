import type { PrismaClient } from "@prisma/client";
import { parseSafeExternalHttpUrl } from "@/lib/external-url";
import { hasActiveLiveViewerSession } from "@/lib/live-quota-admission";
import { isExistingLiveVideoReady } from "@/lib/live-video-readiness";
import { EVERGREEN_LIVE_SELECT, resolveViewerLiveRuntime } from "@/lib/evergreen-viewer-session";
import { FIXED_SESSION_LIVE_SELECT, resolveViewerFixedSessionForLive } from "@/lib/live-fixed-sessions-store";
import { publicLiveAvailabilityWhere } from "@/lib/sellable-live";
import { fixedSessionReplayAvailableUntil } from "@/lib/live-fixed-sessions";
import {
  signVideoUrl,
  STREAM_LIVE_TOKEN_TTL_SECONDS,
  STREAM_REPLAY_TOKEN_TTL_SECONDS,
} from "@/lib/cloudflare-stream-signing";

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

/**
 * Resolves a playback URL only for an unexpired session bound to this live and vendor.
 *
 * F-093: when Cloudflare Stream signing is configured, a Cloudflare video's
 * URL is returned with a short-lived token in place of the uid bound on this
 * vendor's own Video row (never a uid taken only from the URL), plus
 * `expiresInSeconds` so the player re-requests this endpoint (and so passes
 * admission again) before the token lapses. Replay tokens never outlive the
 * replay deadline. Without signing keys the stored URL is returned unchanged.
 */
export async function resolveLivePlaybackSource(db: PrismaClient, input: PlaybackSourceInput) {
  const now = input.now ?? new Date();
  if (!await hasActiveLiveViewerSession(db, { ...input, now })) return null;

  const live = await db.live.findFirst({
    where: {
      id: input.liveId,
      vendorId: input.vendorId,
      // Same audience predicate as the watch page and admission, including F-036 suspension.
      ...publicLiveAvailabilityWhere(),
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
          cloudflareStreamUid: true,
          cloudflarePlaybackId: true,
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
  const storedUrl = parseSafeExternalHttpUrl(live?.video?.videoUrl);
  if (!storedUrl) return null;
  const isReplay = runtime.state === "replay";
  const signed = signVideoUrl({ ...live.video, videoUrl: storedUrl }, {
    vendorId: input.vendorId,
    now,
    ttlSeconds: isReplay ? STREAM_REPLAY_TOKEN_TTL_SECONDS : STREAM_LIVE_TOKEN_TTL_SECONDS,
    notAfter: isReplay
      ? fixedSession
        ? fixedSessionReplayAvailableUntil(fixedSession, live, live.video.durationSec ?? 0)
        : live.replayAvailableUntil
      : null,
  });
  if (!signed) return null;
  const source = signed.signed
    ? {
      playbackUrl: signed.url,
      expiresInSeconds: Math.max(1, Math.floor((signed.expiresAt.getTime() - now.getTime()) / 1_000)),
    }
    : { playbackUrl: signed.url };
  return runtime.playbackStartSeconds === null
    ? source
    : { ...source, playbackStartSeconds: runtime.playbackStartSeconds };
}
