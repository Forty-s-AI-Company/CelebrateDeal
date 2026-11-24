import { NextResponse } from "next/server";
import { z } from "zod";
import { readJsonBody, requireOpsSmokeSecret, unauthorizedJson } from "@/lib/api-security";
import { classifyCloudflareOperationError, createDirectUploadMapping, DirectUploadRequest } from "@/lib/cloudflare-ops";
import { syncStreamVideoReadyForOps, type StreamReadyOpsCheck } from "@/lib/cloudflare-stream-ready-sync";
import { SIGNABLE_VIDEO_SELECT, signVideoUrl } from "@/lib/cloudflare-stream-signing";
import { getDb } from "@/lib/db";
import { bindOpsSmokeVendor, opsSmokeVendorId, opsSmokeVendorUnavailable } from "@/lib/ops-smoke";

const VideoStatusQuery = z.string().trim().min(1).max(128);

export async function GET(request: Request) {
  if (!requireOpsSmokeSecret(request)) {
    return unauthorizedJson();
  }

  const videoId = VideoStatusQuery.safeParse(new URL(request.url).searchParams.get("videoId"));
  if (!videoId.success) {
    return NextResponse.json({ error: "Invalid video status request" }, { status: 400 });
  }
  const vendorId = opsSmokeVendorId();
  if (!vendorId) return opsSmokeVendorUnavailable();

  // Only a video owned by the configured smoke vendor is visible here.
  const readVideo = () => getDb().video.findFirst({
    where: { id: videoId.data, vendorId },
    select: {
      ...SIGNABLE_VIDEO_SELECT,
      status: true,
      cloudflareReadyToStream: true,
      durationSec: true,
    },
  });
  let video = await readVideo();
  if (!video) {
    return NextResponse.json({ error: "Video not found" }, { status: 404 });
  }

  // A4-04: the ready webhook is the primary path, but a Cloudflare account has
  // one webhook URL, so staging may never receive it. A not-ready upload is
  // checked against Cloudflare here (rate limited per video and overall) and a
  // ready answer goes through the webhook's own transition code.
  let providerCheck: StreamReadyOpsCheck["outcome"] | undefined;
  if (
    !video.cloudflareReadyToStream
    && video.status === "processing"
    && video.sourceType === "cloudflare_stream"
    && video.cloudflareStreamUid
  ) {
    const check = await syncStreamVideoReadyForOps({
      video: { id: videoId.data, vendorId, cloudflareStreamUid: video.cloudflareStreamUid },
    });
    providerCheck = check.outcome;
    if (check.outcome === "updated") video = (await readVideo()) ?? video;
  }

  // F-093: once ready and signing is configured, the smoke check plays a
  // short-lived token URL from the same signing path as viewers. Unsigned
  // stored URLs (which carry the provider UID) are still never returned here.
  const signed = video.cloudflareReadyToStream
    ? signVideoUrl(video, { vendorId: video.vendorId, now: new Date(), ttlSeconds: 10 * 60 })
    : null;
  const playbackUrl = signed?.signed ? signed.url : null;
  return NextResponse.json({
    ok: true,
    video: {
      status: video.status,
      readyToStream: video.cloudflareReadyToStream,
      durationSec: video.durationSec,
      ...(playbackUrl ? { playbackUrl } : {}),
    },
    // A fixed category only; never a provider message, UID or URL.
    ...(providerCheck ? { providerCheck } : {}),
  }, { headers: { "Cache-Control": "private, no-store" } });
}

export async function POST(request: Request) {
  if (!requireOpsSmokeSecret(request)) {
    return unauthorizedJson();
  }

  const bound = bindOpsSmokeVendor(await readJsonBody(request));
  if (!bound.ok) return bound.response;
  const parsed = DirectUploadRequest.safeParse(bound.payload);
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
