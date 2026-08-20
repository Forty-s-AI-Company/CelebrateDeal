import { NextResponse } from "next/server";
import { z } from "zod";
import { requireSameOriginRequest } from "@/lib/api-security";
import { getCurrentAuth } from "@/lib/auth";
import { getDb } from "@/lib/db";

export const runtime = "nodejs";

const querySchema = z.object({
  id: z.string().trim().min(1).max(128),
}).strict();

/**
 * Returns only the provider state needed by the merchant editor. The video
 * lookup is tenant-scoped so a foreign id is indistinguishable from missing.
 */
export async function GET(request: Request) {
  const sameOrigin = requireSameOriginRequest(request, { requireClientHeader: true });
  if (sameOrigin) return sameOrigin;

  const auth = await getCurrentAuth();
  if (!auth) return error("UNAUTHORIZED", 401);
  if (
    !auth.vendor
    || !auth.member
    || auth.member.status !== "active"
    || !["owner", "admin", "manager"].includes(auth.member.role)
  ) {
    return error("FORBIDDEN", 403);
  }

  const parsed = querySchema.safeParse({ id: new URL(request.url).searchParams.get("id") });
  if (!parsed.success) return error("INVALID_VIDEO", 400);

  const video = await getDb().video.findFirst({
    where: { id: parsed.data.id, vendorId: auth.vendor.id },
    select: {
      id: true,
      status: true,
      cloudflareReadyToStream: true,
      durationSec: true,
      estimatedMinutes: true,
      thumbnailUrl: true,
      videoUrl: true,
    },
  });
  if (!video) return error("VIDEO_NOT_FOUND", 404);

  return NextResponse.json({
    video: {
      resourceId: video.id,
      status: video.status,
      cloudflareReadyToStream: video.cloudflareReadyToStream,
      durationSec: video.durationSec ?? 0,
      estimatedMinutes: video.estimatedMinutes ?? 0,
      thumbnailUrl: video.thumbnailUrl,
      videoUrl: video.videoUrl,
    },
  }, { headers: { "Cache-Control": "private, no-store" } });
}

function error(code: string, status: number) {
  return NextResponse.json({ error: { code } }, { status, headers: { "Cache-Control": "private, no-store" } });
}
