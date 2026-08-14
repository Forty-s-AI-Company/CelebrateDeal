import { NextResponse } from "next/server";
import { z } from "zod";
import { readJsonBody } from "@/lib/api-security";
import {
  CloudflareResourceError,
  CloudflareUploadFailedError,
  CloudflareUploadNotCompleteError,
  CloudflareUploadTicketError,
  completeResumableUploadMapping,
} from "@/lib/cloudflare-ops";
import { requireMerchantApiActor } from "@/lib/merchant-api-security";

export const runtime = "nodejs";

const requestSchema = z.object({
  uploadTicket: z.string().trim().min(20).max(4_096),
}).strict();

export async function POST(request: Request) {
  const authorization = await requireMerchantApiActor(request);
  if (authorization.response) return authorization.response;

  const parsed = requestSchema.safeParse(await readJsonBody(request, 8 * 1024));
  if (!parsed.success) return error("INVALID_RESUMABLE_UPLOAD_COMPLETE", 400);

  try {
    const { video } = await completeResumableUploadMapping({
      vendorId: authorization.actor.vendorId,
      uploadTicket: parsed.data.uploadTicket,
    });
    return NextResponse.json({ videoId: video.id, status: "processing" });
  } catch (reason) {
    if (reason instanceof CloudflareUploadTicketError) return error("INVALID_UPLOAD_TICKET", 400);
    if (reason instanceof CloudflareUploadNotCompleteError) return error("VIDEO_UPLOAD_NOT_COMPLETE", 409);
    if (reason instanceof CloudflareUploadFailedError) return error("VIDEO_UPLOAD_FAILED", 409);
    if (reason instanceof CloudflareResourceError) return error("VIDEO_NOT_FOUND", 404);
    return error("VIDEO_UPLOAD_COMPLETE_FAILED", 502);
  }
}

function error(code: string, status: number) {
  return NextResponse.json({ error: { code } }, { status });
}
