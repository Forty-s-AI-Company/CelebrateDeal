import { NextResponse } from "next/server";
import { z } from "zod";
import { readJsonBody, requireJobSecret, unauthorizedJson } from "@/lib/api-security";
import { classifyCloudflareOperationError, createDirectUploadMapping, DirectUploadRequest } from "@/lib/cloudflare-ops";
import { getDb } from "@/lib/db";
import { withPreviewSmokeVendorId } from "@/lib/preview-smoke-config";

const VideoStatusQuery = z.string().trim().min(1).max(128);

export async function GET(request: Request) {
  if (!requireJobSecret(request)) {
    return unauthorizedJson();
  }

  const videoId = VideoStatusQuery.safeParse(new URL(request.url).searchParams.get("videoId"));
  if (!videoId.success) {
    return NextResponse.json({ error: "Invalid video status request" }, { status: 400 });
  }

  const video = await getDb().video.findUnique({
    where: { id: videoId.data },
    select: {
      status: true,
      cloudflareReadyToStream: true,
      durationSec: true,
    },
  });
  if (!video) {
    return NextResponse.json({ error: "Video not found" }, { status: 404 });
  }

  return NextResponse.json({
    ok: true,
    video: {
      status: video.status,
      readyToStream: video.cloudflareReadyToStream,
      durationSec: video.durationSec,
    },
  });
}

export async function POST(request: Request) {
  if (!requireJobSecret(request)) {
    return unauthorizedJson();
  }

  const parsed = DirectUploadRequest.safeParse(withPreviewSmokeVendorId(await readJsonBody(request)));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid upload request" }, { status: 400 });
  }

  try {
    const { video, upload } = await createDirectUploadMapping(parsed.data);
    return NextResponse.json({
      ok: true,
      helper: "admin_ops_cloudflare_direct_upload",
      videoId: video.id,
      status: video.status,
      playbackUrl: video.videoUrl,
      upload: {
        uid: upload.uid,
        uploadURL: upload.uploadURL,
      },
    });
  } catch (error) {
    const diagnostic = classifyCloudflareOperationError(error);
    return NextResponse.json(
      {
        ok: false,
        error: "Cloudflare direct upload failed",
        diagnostic: diagnostic.code,
        providerStatus: diagnostic.providerStatus,
      },
      { status: diagnostic.status },
    );
  }
}
