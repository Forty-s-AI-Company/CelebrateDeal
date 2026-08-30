import { NextResponse } from "next/server";
import { z } from "zod";
import { readJsonBody } from "@/lib/api-security";
import {
  CloudflareResourceError,
  createResumableUploadSession,
} from "@/lib/cloudflare-ops";
import { requireMerchantApiActor } from "@/lib/merchant-api-security";
import {
  MAX_BASIC_VIDEO_UPLOAD_BYTES,
  MAX_CLOUDFLARE_VIDEO_BYTES,
} from "@/lib/media-upload-limits";

export const runtime = "nodejs";

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
  title: z.string().trim().min(1).max(160),
  fileName: z.string().trim().min(1).max(255).refine((value) => !/[\u0000-\u001f]/.test(value)),
  mimeType: z.enum(cloudflareVideoMimeTypes),
  sizeBytes: z.number().int().min(MAX_BASIC_VIDEO_UPLOAD_BYTES + 1).max(MAX_CLOUDFLARE_VIDEO_BYTES),
  maxDurationSeconds: z.number().int().positive().max(60 * 60 * 6).default(60 * 60),
}).strict();

export async function POST(request: Request) {
  const authorization = await requireMerchantApiActor(request);
  if (authorization.response) return authorization.response;

  const parsed = requestSchema.safeParse(await readJsonBody(request, 8 * 1024));
  if (!parsed.success) return error("INVALID_RESUMABLE_VIDEO_UPLOAD", 400);

  try {
    const session = await createResumableUploadSession({
      vendorId: authorization.actor.vendorId,
      ...parsed.data,
    });
    return NextResponse.json({
      videoId: session.videoId,
      uploadUrl: session.uploadURL,
      uploadTicket: session.uploadTicket,
      method: "TUS",
      maxBytes: MAX_CLOUDFLARE_VIDEO_BYTES,
    });
  } catch (reason) {
    if (reason instanceof CloudflareResourceError) {
      return reason.code === "video_archived"
        ? error("VIDEO_ARCHIVED", 409)
        : error("VIDEO_NOT_FOUND", 404);
    }
    return error("VIDEO_RESUMABLE_UPLOAD_SETUP_FAILED", 502);
  }
}

function error(code: string, status: number) {
  return NextResponse.json({ error: { code } }, { status });
}
