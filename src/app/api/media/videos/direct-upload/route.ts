import { NextResponse } from "next/server";
import { z } from "zod";
import { readJsonBody } from "@/lib/api-security";
import {
  CloudflareResourceError,
  createDirectUploadMapping,
} from "@/lib/cloudflare-ops";
import { requireMerchantApiActor } from "@/lib/merchant-api-security";
import { MAX_BASIC_VIDEO_UPLOAD_BYTES } from "@/lib/media-upload-limits";

export const runtime = "nodejs";
const MAX_CLOUDFLARE_VIDEO_BYTES = 30 * 1024 * 1024 * 1024;

const cloudflareVideoMimeTypes = [
  "video/mp4",
  "video/webm",
  "video/quicktime",
  "video/x-matroska",
  "video/x-msvideo",
  "video/x-flv",
  "video/mpeg",
  "video/mp2t",
  "video/3gpp",
] as const;

const requestSchema = z.object({
  videoId: z.string().trim().min(1).max(100).optional(),
  title: z.string().trim().min(1).max(160).default("Cloudflare Stream 上傳"),
  fileName: z.string().trim().min(1).max(255).refine((value) => !/[\u0000-\u001f]/.test(value)),
  mimeType: z.enum(cloudflareVideoMimeTypes),
  sizeBytes: z.number().int().positive().max(MAX_CLOUDFLARE_VIDEO_BYTES),
  maxDurationSeconds: z.number().int().positive().max(60 * 60 * 6).default(60 * 60),
}).strict();

export async function POST(request: Request) {
  const authorization = await requireMerchantApiActor(request);
  if (authorization.response) return authorization.response;

  const parsed = requestSchema.safeParse(await readJsonBody(request, 8 * 1024));
  if (!parsed.success) return error("INVALID_VIDEO_UPLOAD", 400);
  if (parsed.data.sizeBytes > MAX_BASIC_VIDEO_UPLOAD_BYTES) {
    return error("REQUIRES_RESUMABLE", 400);
  }

  try {
    const { video, upload } = await createDirectUploadMapping({
      vendorId: authorization.actor.vendorId,
      videoId: parsed.data.videoId,
      title: parsed.data.title,
      maxDurationSeconds: parsed.data.maxDurationSeconds,
    });
    return NextResponse.json({
      videoId: video.id,
      uploadUrl: upload.uploadURL,
      method: "POST",
      maxBytes: MAX_BASIC_VIDEO_UPLOAD_BYTES,
    });
  } catch (reason) {
    if (reason instanceof CloudflareResourceError && reason.code === "video_not_found") {
      return error("VIDEO_NOT_FOUND", 404);
    }
    return error("VIDEO_UPLOAD_SETUP_FAILED", 502);
  }
}

function error(code: string, status: number) {
  return NextResponse.json({ error: { code } }, { status });
}
