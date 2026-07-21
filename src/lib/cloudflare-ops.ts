import { z } from "zod";
import { CloudflareStreamError, createDirectCreatorUpload, createLiveInput } from "@/lib/cloudflare-stream";
import { getDb } from "@/lib/db";

export const DirectUploadRequest = z.object({
  vendorId: z.string().min(1),
  videoId: z.string().min(1).optional(),
  title: z.string().min(1).max(160).default("Cloudflare Stream 上傳"),
  maxDurationSeconds: z.number().int().positive().max(60 * 60 * 6).default(60 * 60),
});

export const LiveInputRequest = z.object({
  vendorId: z.string().min(1),
  videoId: z.string().min(1).optional(),
  liveId: z.string().min(1).optional(),
  name: z.string().min(1).max(120),
});

type CloudflareResourceErrorCode = "vendor_not_found" | "video_not_found" | "live_not_found";

export class CloudflareResourceError extends Error {
  constructor(public readonly code: CloudflareResourceErrorCode) {
    super(`Cloudflare mapping resource failed validation (${code}).`);
    this.name = "CloudflareResourceError";
  }
}

export function classifyCloudflareOperationError(error: unknown) {
  if (error instanceof CloudflareResourceError) {
    return { code: error.code, providerStatus: null, status: 404 };
  }
  if (error instanceof CloudflareStreamError) {
    return {
      code: error.code,
      providerStatus: error.providerStatus,
      status: error.code === "configuration" ? 503 : 502,
    };
  }
  return { code: "internal_failure", providerStatus: null, status: 500 };
}

async function requireCloudflareMappingResources({
  vendorId,
  videoId,
  liveId,
}: {
  vendorId: string;
  videoId?: string;
  liveId?: string;
}) {
  const db = getDb();
  const [vendor, video, live] = await Promise.all([
    db.vendor.findUnique({ where: { id: vendorId }, select: { id: true } }),
    videoId
      ? db.video.findFirst({ where: { id: videoId, vendorId }, select: { id: true } })
      : null,
    liveId
      ? db.live.findFirst({ where: { id: liveId, vendorId }, select: { id: true } })
      : null,
  ]);

  if (!vendor) throw new CloudflareResourceError("vendor_not_found");
  if (videoId && !video) throw new CloudflareResourceError("video_not_found");
  if (liveId && !live) throw new CloudflareResourceError("live_not_found");
  return { db, video, live };
}

export async function createDirectUploadMapping(input: z.infer<typeof DirectUploadRequest>) {
  const { db, video: existingVideo } = await requireCloudflareMappingResources(input);
  const upload = await createDirectCreatorUpload(input.maxDurationSeconds);
  const videoUrl = `https://videodelivery.net/${upload.uid}/manifest/video.m3u8`;
  const video = existingVideo
    ? await db.video.update({
        where: { id: existingVideo.id, vendorId: input.vendorId },
        data: {
          title: input.title,
          sourceType: "cloudflare_stream",
          videoUrl,
          status: "processing",
          cloudflareStreamUid: upload.uid,
          cloudflarePlaybackId: upload.uid,
          cloudflareReadyToStream: false,
          estimatedMinutes: Math.ceil(input.maxDurationSeconds / 60),
        },
      })
    : await db.video.create({
        data: {
          vendorId: input.vendorId,
          title: input.title,
          sourceType: "cloudflare_stream",
          videoUrl,
          status: "processing",
          cloudflareStreamUid: upload.uid,
          cloudflarePlaybackId: upload.uid,
          cloudflareReadyToStream: false,
          estimatedMinutes: Math.ceil(input.maxDurationSeconds / 60),
        },
      });

  return { video, upload, videoUrl };
}

export async function createLiveInputMapping(input: z.infer<typeof LiveInputRequest>) {
  const { db, video: existingVideo } = await requireCloudflareMappingResources(input);
  const liveInput = await createLiveInput(input.name);
  const videoUrl = `https://videodelivery.net/${liveInput.uid}/manifest/video.m3u8`;
  const video = existingVideo
    ? await db.video.update({
        where: { id: existingVideo.id, vendorId: input.vendorId },
        data: {
          title: input.name,
          sourceType: "cloudflare_live",
          videoUrl,
          status: "processing",
          cloudflareLiveInputUid: liveInput.uid,
          cloudflarePlaybackId: liveInput.uid,
          liveStreamKey: liveInput.rtmps?.streamKey ?? null,
          liveInputStatus: "created",
        },
      })
    : await db.video.create({
        data: {
          vendorId: input.vendorId,
          title: input.name,
          sourceType: "cloudflare_live",
          videoUrl,
          status: "processing",
          cloudflareLiveInputUid: liveInput.uid,
          cloudflarePlaybackId: liveInput.uid,
          liveStreamKey: liveInput.rtmps?.streamKey ?? null,
          liveInputStatus: "created",
        },
      });

  if (input.liveId) {
    await db.live.updateMany({
      where: { id: input.liveId, vendorId: input.vendorId },
      data: {
        videoId: video.id,
        streamMode: "live",
        cloudflareLiveInputUid: liveInput.uid,
      },
    });
  }

  return { video, liveInput, videoUrl };
}
