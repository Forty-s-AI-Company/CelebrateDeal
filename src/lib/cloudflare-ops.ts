import { z } from "zod";
import { createDirectCreatorUpload, createLiveInput } from "@/lib/cloudflare-stream";
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

export async function createDirectUploadMapping(input: z.infer<typeof DirectUploadRequest>) {
  const upload = await createDirectCreatorUpload(input.maxDurationSeconds);
  const db = getDb();
  const videoUrl = `https://videodelivery.net/${upload.uid}/manifest/video.m3u8`;
  const existingVideo = input.videoId
    ? await db.video.findFirst({ where: { id: input.videoId, vendorId: input.vendorId }, select: { id: true } })
    : null;
  const video = existingVideo
    ? await db.video.update({
        where: { id: existingVideo.id },
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
  const liveInput = await createLiveInput(input.name);
  const db = getDb();
  const existingVideo = input.videoId
    ? await db.video.findFirst({ where: { id: input.videoId, vendorId: input.vendorId }, select: { id: true } })
    : null;
  const videoUrl = `https://videodelivery.net/${liveInput.uid}/manifest/video.m3u8`;
  const video = existingVideo
    ? await db.video.update({
        where: { id: existingVideo.id },
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
