import type { PrismaClient } from "@prisma/client";
import { parseSafeExternalHttpUrl } from "@/lib/external-url";
import { EVERGREEN_LIVE_SELECT, resolveViewerLiveRuntime } from "@/lib/evergreen-viewer-session";
import { FIXED_SESSION_LIVE_SELECT, resolveViewerFixedSessionForLive } from "@/lib/live-fixed-sessions-store";
import { getRuntimeLivePublishReadiness } from "@/lib/live-runtime-readiness";
import {
  isWaitingVideoPlayable,
  isWithinWaitingVideoWindow,
  WAITING_VIDEO_READINESS_SELECT,
  WAITING_VIDEO_TOKEN_GRACE_SECONDS,
} from "@/lib/live-waiting-video";
import { publicLiveAvailabilityWhere } from "@/lib/sellable-live";
import { readVendorStreamUsageSeconds } from "@/lib/stream-usage-counter";
import { signVideoUrl, STREAM_LIVE_TOKEN_TTL_SECONDS } from "@/lib/cloudflare-stream-signing";

/**
 * 開播前等候影片的播放來源（server only）。
 *
 * - 只收 vendorId＋liveId，不收影片 id：回傳的永遠是這一場 `Live.waitingVideoId`
 *   綁定、而且屬於同一個 vendor 的影片，不能被拿來播任意影片。
 * - 只在這位觀眾自己的場次（常青場、指定場次或共同開播時間）仍在等候、而且距離
 *   開播 60 分鐘以內時回應；更早只顯示海報，開播後主影片接手，這裡改回 403。
 * - 影片必須是 5 分鐘以內、長度已知的點播影片，而且不是這場的主影片（審查 M-1）。
 * - 不經直播容量入場（不建立 LiveViewerSession、不占同時觀看人數），也不寫
 *   Stream 用量帳本：與報名頁宣傳影片相同，屬於開播前的公開預告素材。商家
 *   授權被撤銷或本月 Stream 分鐘數已用完時不提供（觀眾只看到海報）。
 * - Cloudflare 影片以 F-093 短效 token 簽章（10 分鐘，且不晚於這位觀眾的開播時間＋60 秒），
 *   播放器到期前回到這裡續期。
 */
type WaitingSourceInput = {
  vendorId: string;
  liveId: string;
  /** Signed evergreen session cookie; only read when the Live is evergreen. */
  evergreenToken?: string | null;
  /** Signed registration cookie; only read when the Live has fixed sessions. */
  registrationToken?: string | null;
  /** This Live's session-hint cookie (A2-10); only read when the Live has fixed sessions. */
  sessionHintToken?: string | null;
  now?: Date;
};

export type LiveWaitingSource = {
  playbackUrl: string;
  /** F-093: signed Stream URL lifetime; the player renews through the same endpoint. */
  expiresInSeconds?: number;
};

function monthKey(date: Date) {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

/** Read-only: a revoked entitlement or exhausted included minutes serve no waiting video. */
async function vendorStreamDeliveryAllowed(db: PrismaClient, vendorId: string, now: Date) {
  const usageLimit = await db.vendorUsageLimit.findUnique({
    where: { vendorId },
    select: { entitlementStatus: true, streamMinutesLimit: true, streamMinutesUsed: true, resetAt: true },
  });
  if (usageLimit?.entitlementStatus === "revoked") return false;
  const limitMinutes = usageLimit?.streamMinutesLimit ?? 0;
  if (limitMinutes <= 0) return true;
  const ledgerSeconds = await readVendorStreamUsageSeconds(db, { vendorId, monthKey: monthKey(now) });
  const legacySeconds = usageLimit?.resetAt && usageLimit.resetAt > now ? (usageLimit.streamMinutesUsed ?? 0) * 60 : 0;
  return Math.max(ledgerSeconds, legacySeconds) < limitMinutes * 60;
}

/**
 * Resolves the waiting-room video of this Live for this viewer, only while the
 * viewer's own runtime is still waiting, the Live passes the same public
 * availability and runtime readiness gates as the watch page, and the bound
 * video is a playable VOD of the Live's vendor. Null otherwise; the route
 * answers every refusal with the same 403.
 */
export async function resolveLiveWaitingSource(db: PrismaClient, input: WaitingSourceInput): Promise<LiveWaitingSource | null> {
  const now = input.now ?? new Date();
  const live = await db.live.findFirst({
    where: {
      id: input.liveId,
      vendorId: input.vendorId,
      waitingVideoId: { not: null },
      ...publicLiveAvailabilityWhere(),
    },
    select: {
      ...EVERGREEN_LIVE_SELECT,
      ...FIXED_SESSION_LIVE_SELECT,
      vendor: { select: { timezone: true } },
      videoId: true,
      waitingVideoId: true,
      scheduledAt: true,
      startedAt: true,
      endedAt: true,
      video: {
        select: {
          vendorId: true,
          durationSec: true,
          sourceType: true,
          status: true,
          cloudflareReadyToStream: true,
          cloudflareLiveInputUid: true,
          liveInputStatus: true,
        },
      },
      form: { select: { vendorId: true, isActive: true, fields: true } },
      messageTemplate: { select: { vendorId: true, channel: true, trigger: true, isActive: true, subject: true, body: true } },
      interactionScript: { select: { vendorId: true, status: true } },
      products: {
        select: {
          vendorId: true,
          product: { select: { vendorId: true, isActive: true, fulfillmentTypeConfirmed: true } },
        },
      },
      waitingVideo: {
        select: {
          ...WAITING_VIDEO_READINESS_SELECT,
          videoUrl: true,
          cloudflareStreamUid: true,
          cloudflarePlaybackId: true,
        },
      },
    },
  });
  if (!live || live.vendorId !== input.vendorId) return null;
  if (!getRuntimeLivePublishReadiness(live).ready) return null;
  const waitingVideo = live.waitingVideo;
  if (!waitingVideo || !isWaitingVideoPlayable(waitingVideo, live)) return null;

  const fixedSession = await resolveViewerFixedSessionForLive(db, live, {
    registrationToken: input.registrationToken,
    sessionHintToken: input.sessionHintToken,
    now,
  });
  const runtime = resolveViewerLiveRuntime(live, {
    vendorTimezone: live.vendor?.timezone,
    evergreenToken: input.evergreenToken,
    now,
    fixedSession,
  });
  if (runtime.state !== "waiting") return null;
  // An evergreen visitor without an assigned session sees the preparing notice, not the room.
  if (runtime.evergreen && !runtime.evergreen.assigned) return null;
  // The viewer's own start: the fixed session they follow, their evergreen session, or the shared start.
  const startsAt = fixedSession?.startAt ?? runtime.evergreen?.sessionStartAt ?? live.scheduledAt;
  if (!isWithinWaitingVideoWindow(startsAt.getTime(), now.getTime())) return null;
  if (!await vendorStreamDeliveryAllowed(db, input.vendorId, now)) return null;

  const storedUrl = parseSafeExternalHttpUrl(waitingVideo.videoUrl);
  if (!storedUrl) return null;
  const signed = signVideoUrl({ ...waitingVideo, videoUrl: storedUrl }, {
    vendorId: input.vendorId,
    now,
    ttlSeconds: STREAM_LIVE_TOKEN_TTL_SECONDS,
    // A leaked URL stops working shortly after this viewer's show starts.
    notAfter: new Date(startsAt.getTime() + WAITING_VIDEO_TOKEN_GRACE_SECONDS * 1_000),
  });
  if (!signed) return null;
  return signed.signed
    ? {
      playbackUrl: signed.url,
      expiresInSeconds: Math.max(1, Math.floor((signed.expiresAt.getTime() - now.getTime()) / 1_000)),
    }
    : { playbackUrl: signed.url };
}
