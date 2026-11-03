import { z } from "zod";
import {
  CloudflareStreamError,
  updateLiveInputRecordingSecurity,
  updateStreamVideoPlaybackSecurity,
} from "@/lib/cloudflare-stream";
import {
  getStreamPlaybackSecurity,
  parseCloudflareStreamPlaybackUrl,
  type StreamPlaybackSecurity,
} from "@/lib/cloudflare-stream-signing";
import { getDb } from "@/lib/db";

/**
 * F-093 §4：對既有 Cloudflare Stream 影片與 live input 錄影批次開啟
 * `requireSignedURLs`＋`allowedOrigins`。
 *
 * - 一次只處理一個 vendor，所有影片都以 `vendorId` 篩選；不接受 uid 清單。
 * - 預設 dry-run；`apply: true` 才呼叫 Cloudflare，且必須已設定簽章金鑰，
 *   否則開啟後應用程式簽不出 token，影片會全部無法播放。
 * - 以 `id` 游標分頁，每批最多 10 支，逐支依序呼叫（每次請求 15 秒逾時）。
 */
export const SIGNED_URL_BACKFILL_MAX_BATCH = 10;

export const SignedUrlBackfillRequest = z.object({
  vendorId: z.string().trim().min(1).max(128),
  cursor: z.string().trim().min(1).max(128).optional(),
  limit: z.number().int().min(1).max(SIGNED_URL_BACKFILL_MAX_BATCH).default(5),
  apply: z.boolean().default(false),
}).strict();

export type SignedUrlBackfillInput = z.infer<typeof SignedUrlBackfillRequest>;

const STREAM_UID_PATTERN = /^[a-f0-9]{32}$/i;

type BackfillTarget = { videoId: string; kind: "video" | "live_input"; uid: string };

export type SignedUrlBackfillResult = BackfillTarget & {
  status: "pending" | "updated" | "not_found" | "failed";
  diagnostic?: string;
  providerStatus?: number | null;
};

export class SignedUrlBackfillNotConfiguredError extends Error {
  constructor() {
    super("Cloudflare Stream signing is not configured.");
    this.name = "SignedUrlBackfillNotConfiguredError";
  }
}

type BackfillVideo = {
  id: string;
  videoUrl: string;
  cloudflareStreamUid: string | null;
  cloudflarePlaybackId: string | null;
  cloudflareLiveInputUid: string | null;
};

function validUid(value: string | null | undefined) {
  const uid = value?.trim();
  return uid && STREAM_UID_PATTERN.test(uid) ? uid.toLowerCase() : null;
}

/** 一列 Video 對應的 Cloudflare 資源：live input 本身，以及所有已知的影片 uid。 */
export function backfillTargetsForVideo(video: BackfillVideo): BackfillTarget[] {
  const liveInputUid = validUid(video.cloudflareLiveInputUid);
  const videoUids = new Set<string>();
  for (const candidate of [
    validUid(video.cloudflareStreamUid),
    validUid(video.cloudflarePlaybackId),
    validUid(parseCloudflareStreamPlaybackUrl(video.videoUrl)?.uid),
  ]) {
    // 直播尚未錄影前 videoUrl 指向 live input uid；那不是影片，由 live input 更新涵蓋。
    if (candidate && candidate !== liveInputUid) videoUids.add(candidate);
  }
  return [
    ...(liveInputUid ? [{ videoId: video.id, kind: "live_input" as const, uid: liveInputUid }] : []),
    ...[...videoUids].map((uid) => ({ videoId: video.id, kind: "video" as const, uid })),
  ];
}

async function applyTarget(target: BackfillTarget, security: StreamPlaybackSecurity): Promise<SignedUrlBackfillResult> {
  try {
    if (target.kind === "live_input") await updateLiveInputRecordingSecurity(target.uid, security);
    else await updateStreamVideoPlaybackSecurity(target.uid, security);
    return { ...target, status: "updated" };
  } catch (error) {
    if (error instanceof CloudflareStreamError) {
      if (error.code === "provider_rejected" && error.providerStatus === 404) {
        return { ...target, status: "not_found", providerStatus: 404 };
      }
      if (error.code === "configuration") throw error;
      return { ...target, status: "failed", diagnostic: error.code, providerStatus: error.providerStatus };
    }
    return { ...target, status: "failed", diagnostic: "unexpected" };
  }
}

export async function backfillStreamSignedUrls(
  input: SignedUrlBackfillInput,
  db: Pick<ReturnType<typeof getDb>, "video"> = getDb(),
) {
  const security = getStreamPlaybackSecurity();
  if (input.apply && !security) throw new SignedUrlBackfillNotConfiguredError();

  const videos = await db.video.findMany({
    where: {
      vendorId: input.vendorId,
      ...(input.cursor ? { id: { gt: input.cursor } } : {}),
      OR: [
        { cloudflareStreamUid: { not: null } },
        { cloudflarePlaybackId: { not: null } },
        { cloudflareLiveInputUid: { not: null } },
        { videoUrl: { startsWith: "https://videodelivery.net/" } },
        { videoUrl: { contains: ".cloudflarestream.com/" } },
      ],
    },
    orderBy: { id: "asc" },
    take: input.limit,
    select: {
      id: true,
      videoUrl: true,
      cloudflareStreamUid: true,
      cloudflarePlaybackId: true,
      cloudflareLiveInputUid: true,
    },
  });

  const results: SignedUrlBackfillResult[] = [];
  for (const target of videos.flatMap(backfillTargetsForVideo)) {
    results.push(input.apply && security ? await applyTarget(target, security) : { ...target, status: "pending" });
  }

  return {
    apply: input.apply,
    allowedOrigins: security?.allowedOrigins ?? null,
    scannedVideos: videos.length,
    results,
    nextCursor: videos.length === input.limit ? videos[videos.length - 1]!.id : null,
  };
}
