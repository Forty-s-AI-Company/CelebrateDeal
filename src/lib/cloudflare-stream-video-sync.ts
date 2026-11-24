import { z } from "zod";
import { convergeCloudflareVideoTransition } from "@/lib/cloudflare-video-transition";
import type { CloudflareVideoStatus } from "@/lib/cloudflare-video-status";
import type { getDb } from "@/lib/db";

/**
 * The one place a Cloudflare Stream provider state is written to `Video`.
 *
 * Both sources of provider state go through `applyCloudflareStreamProviderState`:
 * - the signed webhook (`src/lib/cloudflare-stream-webhook-handler.ts`), the
 *   primary path;
 * - the read-only `GET /stream/{uid}` fallback
 *   (`src/lib/cloudflare-stream-ready-sync.ts`), used when a webhook never
 *   arrived (a Cloudflare account has only one webhook URL).
 *
 * So status, ready flag, playback mapping, thumbnail and duration follow one
 * transition table and one set of conditional writes, whichever arrives first.
 */

export const MAX_CLOUDFLARE_DURATION_SECONDS = 6 * 60 * 60;

export const CloudflareStreamProviderPayload = z.object({
  uid: z.string().min(1),
  status: z.object({
    state: z.string().optional(),
    pctComplete: z.string().optional(),
  }).optional(),
  readyToStream: z.boolean().optional(),
  thumbnail: z.string().optional(),
  duration: z.number().finite().nonnegative().max(MAX_CLOUDFLARE_DURATION_SECONDS).optional(),
  playback: z.object({
    hls: z.string().optional(),
    dash: z.string().optional(),
  }).optional(),
});

export type CloudflareStreamProviderPayload = z.infer<typeof CloudflareStreamProviderPayload>;

type SyncDatabase = ReturnType<typeof getDb>;

function normalizedDurationSeconds(duration: number) {
  return Math.ceil(duration);
}

export function normalizedCloudflareStreamStatus(payload: CloudflareStreamProviderPayload): CloudflareVideoStatus | null {
  if (payload.readyToStream === true) return "ready";

  const providerState = payload.status?.state?.trim().toLowerCase();
  if (["pendingupload", "queued", "downloading", "inprogress", "processing"].includes(providerState ?? "")) {
    return "processing";
  }
  if (providerState === "error") return "error";
  return null;
}

function playbackManifestUrl(uid: string) {
  return `https://videodelivery.net/${uid}/manifest/video.m3u8`;
}

/**
 * Every write is conditioned on the row still being mapped to this provider
 * UID. A replacement upload (`persistStreamVideo`) re-points all three UID
 * columns, so a late state for the previous asset cannot overwrite the new
 * one's playback mapping, whether it came from a webhook or from a poll.
 */
function providerUidMatch(uid: string) {
  return {
    OR: [
      { cloudflareStreamUid: uid },
      { cloudflareLiveInputUid: uid },
      { cloudflarePlaybackId: uid },
    ],
  };
}

function readyProviderMetadata(payload: CloudflareStreamProviderPayload) {
  const duration = payload.duration;
  const base = {
    cloudflareReadyToStream: true,
    cloudflarePlaybackId: payload.uid,
    videoUrl: playbackManifestUrl(payload.uid),
    ...(payload.thumbnail !== undefined ? { thumbnailUrl: payload.thumbnail } : {}),
  };
  if (duration === undefined) return base;
  const durationSec = normalizedDurationSeconds(duration);
  return { ...base, durationSec, estimatedMinutes: Math.ceil(durationSec / 60) };
}

function readyMetadataChanged(
  match: {
    cloudflareReadyToStream: boolean;
    cloudflarePlaybackId: string | null;
    videoUrl: string;
    thumbnailUrl: string | null;
    durationSec: number;
    estimatedMinutes: number;
  },
  payload: CloudflareStreamProviderPayload,
) {
  const durationSec = payload.duration === undefined ? undefined : normalizedDurationSeconds(payload.duration);
  return match.cloudflareReadyToStream !== true
    || match.cloudflarePlaybackId !== payload.uid
    || match.videoUrl !== playbackManifestUrl(payload.uid)
    || (payload.thumbnail !== undefined && match.thumbnailUrl !== payload.thumbnail)
    || (durationSec !== undefined && (
      match.durationSec !== durationSec
      || match.estimatedMinutes !== Math.ceil(durationSec / 60)
    ));
}

export type CloudflareStreamSyncOutcome =
  /** The provider state names no status this app maps (nothing read or written). */
  | "unsupported_status"
  /** No local video uses this UID. */
  | "unmapped"
  /** The UID maps to more than one local video, or to one without a vendor; nothing written. */
  | "ambiguous"
  /** The UID maps to a different video or vendor than the caller expected; nothing written. */
  | "scope_mismatch"
  /** A conditional write changed the row. */
  | "updated"
  /** Stale, already applied, or lost the race to an equivalent write. */
  | "unchanged"
  /** The bounded compare-and-swap retry could not converge. */
  | "contention_exhausted";

export type CloudflareStreamSyncResult = {
  outcome: CloudflareStreamSyncOutcome;
  status: CloudflareVideoStatus | null;
  updated: number;
};

/**
 * Applies one provider state for `payload.uid`.
 *
 * `expectedVideo` is set by callers that start from a known local video (the
 * poll fallback): the UID lookup must then resolve to exactly that video and
 * vendor, otherwise nothing is written. Every write is a conditional
 * `updateMany` on `{ id, vendorId, status, uid }`, so concurrent webhook and
 * poll deliveries of the same state apply once and the loser sees
 * `unchanged`.
 */
export async function applyCloudflareStreamProviderState({
  db,
  payload,
  expectedVideo,
  converge = convergeCloudflareVideoTransition,
}: {
  db: SyncDatabase;
  payload: CloudflareStreamProviderPayload;
  expectedVideo?: { id: string; vendorId: string };
  converge?: typeof convergeCloudflareVideoTransition;
}): Promise<CloudflareStreamSyncResult> {
  const status = normalizedCloudflareStreamStatus(payload);
  if (!status) return { outcome: "unsupported_status", status: null, updated: 0 };

  const matches = await db.video.findMany({
    where: providerUidMatch(payload.uid),
    select: {
      id: true,
      vendorId: true,
      status: true,
      cloudflareReadyToStream: true,
      cloudflarePlaybackId: true,
      videoUrl: true,
      thumbnailUrl: true,
      durationSec: true,
      estimatedMinutes: true,
    },
    take: 2,
  });

  // Provider UID 沒有 tenant context；若本機 mapping 不唯一就停止寫入。
  if (matches.length > 1) return { outcome: "ambiguous", status, updated: 0 };
  const match = matches[0];
  if (!match) return { outcome: "unmapped", status, updated: 0 };
  if (!match.vendorId) return { outcome: "ambiguous", status, updated: 0 };
  if (expectedVideo && (match.id !== expectedVideo.id || match.vendorId !== expectedVideo.vendorId)) {
    return { outcome: "scope_mismatch", status, updated: 0 };
  }
  const vendorId = match.vendorId;
  const uidMatch = providerUidMatch(payload.uid);

  if (match.status === "archived") {
    // Keep the application-owned archive state terminal while still
    // accepting authoritative provider metadata from a ready state.
    if (status !== "ready" || !readyMetadataChanged(match, payload)) {
      return { outcome: "unchanged", status, updated: 0 };
    }
    const updated = await db.video.updateMany({
      where: { id: match.id, vendorId, status: "archived", ...uidMatch },
      data: readyProviderMetadata(payload),
    });
    return { outcome: updated.count > 0 ? "updated" : "unchanged", status, updated: updated.count };
  }

  if (match.status === "ready" && status === "ready") {
    if (!readyMetadataChanged(match, payload)) return { outcome: "unchanged", status, updated: 0 };
    const updated = await db.video.updateMany({
      where: { id: match.id, vendorId, status: "ready", ...uidMatch },
      data: readyProviderMetadata(payload),
    });
    return { outcome: updated.count > 0 ? "updated" : "unchanged", status, updated: updated.count };
  }

  // Set when a lost claim re-reads a row that a concurrent delivery (webhook
  // or poll) already made ready with the same metadata: nothing is left to
  // write, so the retry settles without a second write.
  let latestReady: Parameters<typeof readyMetadataChanged>[0] | null = null;
  let settledWithoutWrite = false;

  const transition = await converge({
    snapshot: match,
    incomingStatus: status,
    claim: async ({ id, vendorId: claimVendorId, expectedStatus, nextStatus }) => {
      if (
        expectedStatus === "ready"
        && nextStatus === "ready"
        && latestReady
        && !readyMetadataChanged(latestReady, payload)
      ) {
        settledWithoutWrite = true;
        return true;
      }
      const updated = await db.video.updateMany({
        // 狀態條件是 optimistic claim；若較新的 callback 已先完成，helper 會重新讀取狀態。
        where: { id, vendorId: claimVendorId ?? vendorId, status: expectedStatus, ...uidMatch },
        data: {
          status: nextStatus,
          cloudflareReadyToStream: payload.readyToStream ?? false,
          cloudflarePlaybackId: payload.uid,
          videoUrl: playbackManifestUrl(payload.uid),
          ...(payload.thumbnail !== undefined ? { thumbnailUrl: payload.thumbnail } : {}),
          ...(nextStatus === "ready" ? readyProviderMetadata(payload) : {}),
        },
      });
      return updated.count === 1;
    },
    // A row re-pointed to another UID reads as missing, so the retry stops.
    readLatest: async (id) => {
      const latest = await db.video.findFirst({
        where: { id, vendorId, ...uidMatch },
        select: {
          id: true,
          vendorId: true,
          status: true,
          cloudflareReadyToStream: true,
          cloudflarePlaybackId: true,
          videoUrl: true,
          thumbnailUrl: true,
          durationSec: true,
          estimatedMinutes: true,
        },
      });
      latestReady = latest?.status === "ready" ? latest : null;
      return latest;
    },
  });

  if (transition.outcome === "contention_exhausted") {
    return { outcome: "contention_exhausted", status, updated: 0 };
  }
  if (transition.outcome === "applied" && !settledWithoutWrite) return { outcome: "updated", status, updated: 1 };
  return { outcome: "unchanged", status, updated: 0 };
}
